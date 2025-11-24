# Inverted Mocking in TypeScript

This project demonstrates the "inverted mocking" pattern from [Matt Parsons' article](https://www.parsonsmatt.org/2017/07/27/inverted_mocking.html), applied to TypeScript.

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
// effects.ts
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
// orderProcessor.ts
import { Either, EitherAsync, Left, Right } from 'purify-ts';

function processOrder(orderId: string): (effects: AppEffects) => Promise<Either<string, ProcessedOrder>> {
  return async (effects: AppEffects) => {
    // Gather inputs - return Left on error instead of throwing
    const order = await effects.orders.getById(orderId);
    if (!order) {
      return Left(`Order ${orderId} not found`);
    }
    
    const customer = await effects.customers.getById(order.customerId);
    if (!customer) {
      return Left(`Customer ${order.customerId} not found`);
    }
    
    const products = await effects.products.getByIds(productIds);
    const discountRules = await effects.pricing.getDiscountRules();
    
    // Pure business logic - all calculations happen here
    const lineItems = calculateLineItems(order, products);
    const discountRule = findApplicableDiscount(discountRules, customer.tier, subtotal);
    const processedOrder = toProcessedOrder(order, customer, lineItems, discountRule);
    
    // Critical effects - must succeed for order to be processed
    const criticalEffects = await Promise.all([
      EitherAsync(() => effects.products.updateInventory(inventoryUpdates))
        .mapLeft(err => `Failed to update inventory: ${err}`),
      EitherAsync(() => effects.customers.updateTotalPurchases(customer.id, processedOrder.total))
        .mapLeft(err => `Failed to update customer purchases: ${err}`),
    ]);
    
    // Check if any critical effect failed
    const criticalFailure = criticalEffects.find(result => result.isLeft());
    if (criticalFailure) {
      return criticalFailure as Either<string, ProcessedOrder>;
    }
    
    // Optional effects - fire and forget, log but don't fail the order
    const optionalEffects = [
      EitherAsync(() => effects.cache.set(cacheEntry)),
      EitherAsync(() => effects.notifications.sendEmail(emailPayload)),
      EitherAsync(() => effects.analytics.trackEvent(analyticsEvent)),
    ];
    
    // Execute optional effects without blocking
    Promise.all(optionalEffects.map(effect => effect.run())).then(results => {
      results.forEach(result => {
        if (result.isLeft()) {
          console.warn('Optional effect failed:', result.extract());
        }
      });
    });
    
    return Right(processedOrder);
  };
}

// Usage:
const result = await processOrder('order-123')(effects);
result.ifRight(order => console.log('Success:', order));
result.ifLeft(error => console.error('Error:', error));
```

**Key Design Decision: Critical vs Optional Effects**

Not all effects are equal! The code distinguishes between:

- **Critical Effects** (inventory, customer updates): Must succeed or the order fails
- **Optional Effects** (cache, email, analytics): Failures are logged but don't fail the order

This prevents scenarios like "order succeeded but customer didn't get email, so we rolled everything back."

## Project Structure

```
src/
├── types.ts                    # Shared domain types
├── before/
│   ├── orderProcessor.ts       # ❌ The problematic approach
│   └── fakeDeps.ts             # Fake dependencies for compilation
├── after/
│   ├── businessLogic.ts        # ✅ Pure functions - no effects
│   ├── effects.ts              # ✅ Simple effect interfaces
│   └── orderProcessor.ts       # ✅ Thin coordinator
└── tests/
    ├── businessLogic.test.ts   # Pure function tests - NO MOCKS
    └── integration.test.ts     # Coordinator tests - simple mocks
```

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

Instead, group related effects into interfaces (`AppEffects`) and pass that single object. This gives you the same testability without the parameter explosion.

## Further Reading

- [Original article by Matt Parsons](https://www.parsonsmatt.org/2017/07/27/inverted_mocking.html)
- [Gary Bernhardt on Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)
