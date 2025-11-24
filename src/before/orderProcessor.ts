/**
 * BEFORE: The Traditional Approach
 * 
 * This code interleaves effects (HTTP, database, cache, notifications) with
 * business logic. To test this, you'd need to mock:
 * - Database connections
 * - HTTP clients
 * - Redis/cache clients
 * - Email services
 * 
 * Each mock needs to replicate complex behavior, and bugs in mocks
 * lead to test/prod mismatches.
 */

import {Customer, DiscountRule, Order, ProcessedOrder, Product,} from '../domain';

// Simulated external dependencies (in real code, these would be actual clients)
import {cache, db, emailService, httpClient} from './fakeDeps';

export async function processOrder(orderId: string): Promise<void> {
  // Effect: Database read
  const order = await db.query<Order>(
    `SELECT * FROM orders WHERE id = $1`,
    [orderId]
  );
  
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Effect: Database read
  const customer = await db.query<Customer>(
    `SELECT * FROM customers WHERE id = $1`,
    [order.customerId]
  );

  if (!customer) {
    throw new Error(`Customer ${order.customerId} not found`);
  }

  // Effect: HTTP call to pricing service
  const discountRules = await httpClient.get<DiscountRule[]>(
    'https://pricing-service/api/discount-rules'
  );

  // Effect: Database reads for each product
  const products: Product[] = [];
  for (const item of order.items) {
    const product = await db.query<Product>(
      `SELECT * FROM products WHERE id = $1`,
      [item.productId]
    );
    if (product) {
      products.push(product);
    }
  }

  // Business logic interleaved with effects
  let subtotal = 0;
  const itemsSummary = [];

  for (const item of order.items) {
    const product = products.find(p => p.id === item.productId);
    if (!product) {
      // Effect: Log to monitoring service
      await httpClient.post('https://monitoring/api/alerts', {
        type: 'missing_product',
        productId: item.productId,
        orderId: order.id,
      });
      continue;
    }

    const lineTotal = item.quantity * item.pricePerUnit;
    subtotal += lineTotal;

    itemsSummary.push({
      productId: item.productId,
      productName: product.name,
      quantity: item.quantity,
      lineTotal,
    });

    // Effect: Update inventory
    await db.execute(
      `UPDATE products SET stock = stock - $1 WHERE id = $2`,
      [item.quantity, item.productId]
    );
  }

  // More business logic
  let discount = 0;
  const applicableRule = discountRules
    .filter(rule => rule.tier === customer.tier)
    .find(rule => subtotal >= rule.minPurchase);

  if (applicableRule) {
    discount = subtotal * (applicableRule.discountPercent / 100);
  }

  const total = subtotal - discount;

  // Loyalty points calculation
  let loyaltyPointsEarned = Math.floor(total / 10);
  if (customer.tier === 'vip') {
    loyaltyPointsEarned *= 2;
  } else if (customer.tier === 'premium') {
    loyaltyPointsEarned = Math.floor(loyaltyPointsEarned * 1.5);
  }

  const processedOrder: ProcessedOrder = {
    orderId: order.id,
    customerId: customer.id,
    subtotal,
    discount,
    total,
    loyaltyPointsEarned,
    itemsSummary,
  };

  // Effect: Cache the processed order
  await cache.set(
    `processed-order:${order.id}`,
    JSON.stringify(processedOrder),
    3600
  );

  // Effect: Update customer stats
  await db.execute(
    `UPDATE customers SET total_purchases = total_purchases + $1 WHERE id = $2`,
    [total, customer.id]
  );

  // Effect: Send confirmation email
  await emailService.send({
    to: customer.email,
    subject: `Order ${order.id} Confirmed`,
    body: `
      Thank you for your order!
      
      Subtotal: $${subtotal.toFixed(2)}
      Discount: -$${discount.toFixed(2)}
      Total: $${total.toFixed(2)}
      
      You earned ${loyaltyPointsEarned} loyalty points!
    `,
  });

  // Effect: Notify analytics service
  await httpClient.post('https://analytics/api/events', {
    event: 'order_processed',
    orderId: order.id,
    total,
    customerTier: customer.tier,
  });
}

/**
 * Problems with this approach:
 * 
 * 1. To test calculateDiscount logic, you need to mock the HTTP client
 * 2. To test loyalty points, you need a full customer mock from DB
 * 3. To test the email content, you need to mock everything else first
 * 4. Business logic is scattered throughout - hard to verify correctness
 * 5. Each test requires complex setup of multiple mock systems
 * 6. If any mock behavior differs from production, tests pass but prod fails
 */
