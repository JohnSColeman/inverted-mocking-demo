# Inverted Mocking in TypeScript

This project demonstrates the "inverted mocking" pattern from [Matt Parsons' article](https://www.parsonsmatt.org/2017/07/27/inverted_mocking.html), applied to TypeScript
as well using [Temporal](https://temporal.io/) to assure effects are durable so processes can recover and complete.

## The Problem

Consider order processing code that interleaves effects with business logic:

```typescript
async function processOrder(orderId: string): Promise<void> {
  const order = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  const customer = await db.query('SELECT * FROM customers WHERE id = ?', [order.customerId]);
  const discountRules = await httpClient.get('https://pricing-service/api/rules');
  
  // Business logic mixed with effects...
  let subtotal = 0;
  for (const item of order.items) {
    const product = await db.query('SELECT * FROM products WHERE id = ?', [item.productId]);
    subtotal += item.quantity * item.pricePerUnit;
    await db.execute('UPDATE products SET stock = stock - ?', [item.quantity]);
  }
  
  // More calculations and effects interleaved...
  await cache.set(`order:${orderId}`, result);
  await emailService.send(customer.email, 'Order confirmed', body);
}
```

To test this, you'd need to mock:
- Database (with SQL parsing!)
- HTTP client
- Cache
- Email service

Each mock must replicate complex behavior. Bugs in mocks cause test/prod mismatches.

## The Solution: Invert Your Mocks

Instead of mocking effects, **extract the logic so it doesn't need effects**.

### 1. Pure Business Logic (No Effects)

```typescript
// businessLogic.ts - trivially testable
export function calculateDiscount(subtotal: number, rule: DiscountRule | null): number {
  if (!rule) return 0;
  return subtotal * (rule.discountPercent / 100);
}

export function calculateLoyaltyPoints(total: number, tier: CustomerTier): number {
  const base = Math.floor(total / 10);
  return tier === 'vip' ? base * 2 : tier === 'premium' ? Math.floor(base * 1.5) : base;
}

export function buildConfirmationEmail(customer: Customer, order: ProcessedOrder): EmailPayload {
  return {
    to: customer.email,
    subject: `Order ${order.orderId} Confirmed`,
    body: `Total: $${order.total.toFixed(2)}\nPoints: ${order.loyaltyPointsEarned}`,
  };
}
```

Test these with simple assertions - no mocks needed:

```typescript
test('VIP gets double points', () => {
  expect(calculateLoyaltyPoints(100, 'vip')).toBe(20);
});
```

### 2. Weaker Abstractions for Effects

Instead of mocking SQL, create simple interfaces:

```typescript
// effects.d.ts
interface OrderRepository {
  getById(id: string): Promise<Order | null>;
}

interface CustomerRepository {
  getById(id: string): Promise<Customer | null>;
  updateTotalPurchases(id: string, amount: number): Promise<void>;
}
```

These are vastly easier to mock than a full database!

### 3. Thin Coordinator (Just Plumbing)

```typescript
// orderProcessing.ts
export function processOrder(
    orderId: string
): (appEffects: AppEffects) => Promise<Either<unknown[], ProcessedOrder>> {
    return async (appEffects: AppEffects) => {
        // ========== GATHER INPUTS (Effects) ==========

        const order = await appEffects.orders.getById(orderId);
        if (!order) {
            return Left([`Order ${orderId} not found`]);
        }

        const customer = await appEffects.customers.getById(order.customerId);
        if (!customer) {
            return Left([`Customer ${order.customerId} not found`]);
        }

        const productIds = order.items.map(item => item.productId);
        const [products, discountRules] = await Promise.all([
            appEffects.products.getByIds(productIds),
            appEffects.pricing.getDiscountRules(),
        ]);

        // ========== PURE BUSINESS LOGIC (No Effects) ==========

        // Calculate line items and identify missing products
        const {items: lineItems, missingProductIds} = calculateLineItems(order, products);

        // Find applicable discount
        const discountRule = findApplicableDiscount(
            discountRules,
            customer.tier,
            lineItems.reduce((sum, item) => sum + item.lineTotal, 0)
        );

        // Build the processed order (all the core calculations happen here)
        const processedOrder = toProcessedOrder(order, customer, lineItems, discountRule);

        // Prepare all output data
        const inventoryUpdates = calculateInventoryUpdates(lineItems);
        const emailPayload = buildConfirmationEmail(customer, processedOrder);
        const cacheEntry = buildCacheEntry(processedOrder);
        const analyticsEvent = buildAnalyticsEvent(processedOrder, customer.tier);
        const missingProductAlerts = missingProductIds
            .map(ids => buildMissingProductAlerts(orderId, ids));

        // ========== PERFORM OUTPUTS (Effects) ==========

        const effects = [
            () => appEffects.products.updateInventory(inventoryUpdates),
            () => appEffects.customers.updateTotalPurchases(customer.id, processedOrder.total),
            () => appEffects.cache.set(cacheEntry),
            () => appEffects.notifications.sendEmail(emailPayload),
            () => appEffects.analytics.trackEvent(analyticsEvent),
            ...missingProductAlerts
                .map(alerts => [() => appEffects.monitoring.sendAlerts(alerts)])
                .orDefault([])
        ];

        // Execute all effects and return either the failures or the processed order
        const results = await Promise.all(effects.map(e => EitherAsync(e).run()));
        const errors = Either.lefts(results);
        return errors.length > 0 ? Left(errors)
            : Right(processedOrder);
    };
}

// Usage:
const result = await processOrder('order-123')(effects);
result.ifRight(order => console.log('Success:', order));
result.ifLeft(errors => console.error('Error:', errors));
```
Note that the project code is more structured and segregates effect failures from business logic failures by
throwing for effect failures and using the left Either condition to handle business logic errors. NonEmptyList
allows for multiple business logic failures to return and is useful for form validation, although in this case it
is only conventional and not exploited.

## Running the Tests

```bash
npm install
npm test
```

## Key Benefits

| Aspect | Before (Traditional) | After (Inverted) |
|--------|---------------------|------------------|
| **Business logic tests** | Need DB, HTTP, cache mocks | No mocks at all |
| **Mock complexity** | High (SQL semantics, etc.) | Low (return values) |
| **Test reliability** | Mock bugs cause failures | Logic tested directly |
| **Code clarity** | Effects scattered throughout | Clear input→process→output |
| **Testable surface** | Large effectful function | Small pure functions |

## The Core Insight

> "Instead of mocking effects, extract the logic so it doesn't need effects at all."

When you find yourself building complex mocks, ask: "Can I restructure this so the logic I care about is a pure function?"

Most of the time, the answer is yes.

## Avoiding Unwieldy Lambda Abstraction

Parsons mentions you can make functions abstract by taking all dependencies as parameters:

```typescript
// Gets unwieldy with many effects
function processOrder(
  getOrder: (id: string) => Promise<Order>,
  getCustomer: (id: string) => Promise<Customer>,
  getProducts: (ids: string[]) => Promise<Product[]>,
  // ... 5 more parameters
) { ... }
```

Instead, group related effects into interfaces (`AppEffects`) and pass that single object. This gives you the same 
testability without the parameter explosion.

## Further Reading

- [Original article by Matt Parsons](https://www.parsonsmatt.org/2017/07/27/inverted_mocking.html)
- [Gary Bernhardt on Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)
