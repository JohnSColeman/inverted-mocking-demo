/**
 * ORDER PROCESSOR - The Coordinator
 * 
 * This is the thin "effectful shell" that:
 * 1. Calls effects to get data (inputs)
 * 2. Passes data to pure business logic functions
 * 3. Calls effects to persist results (outputs)
 * 
 * Notice how simple this is - it's just plumbing. All the interesting
 * logic lives in businessLogic.ts where it's trivially testable.
 */

import {Either, EitherAsync, Left, Right} from 'purify-ts';
import {ProcessedOrder} from '../domain';
import {AppEffects} from './effects';
import {
  buildAnalyticsEvent,
  buildCacheEntry,
  buildConfirmationEmail,
  buildMissingProductAlerts,
  calculateInventoryUpdates,
  calculateLineItems,
  findApplicableDiscount,
  toProcessedOrder,
} from './businessLogic';

/**
 * Helper to categorize effects as critical (must succeed) or optional (can fail)
 */
interface EffectResults {
  critical: Either<string, void>[];
  optional: Either<string, void>[];
}

export function processOrder(
  orderId: string
): (effects: AppEffects) => Promise<Either<string, ProcessedOrder>> {
  return async (effects: AppEffects): Promise<Either<string, ProcessedOrder>> => {
  // ========== GATHER INPUTS (Effects) ==========
  
  const order = await effects.orders.getById(orderId);
  if (!order) {
    return Left(`Order ${orderId} not found`);
  }

  const customer = await effects.customers.getById(order.customerId);
  if (!customer) {
    return Left(`Customer ${order.customerId} not found`);
  }

  const productIds = order.items.map(item => item.productId);
  const [products, discountRules] = await Promise.all([
    effects.products.getByIds(productIds),
    effects.pricing.getDiscountRules(),
  ]);

  // ========== PURE BUSINESS LOGIC (No Effects) ==========
  
  // Calculate line items and identify missing products
  const { items: lineItems, missingProductIds } = calculateLineItems(order, products);
  
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
  const missingProductAlerts = buildMissingProductAlerts(orderId, missingProductIds);

  // ========== PERFORM OUTPUTS (Effects) ==========
  
  // Critical effects - must succeed for order to be considered processed
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
  // These run in parallel and we don't wait for them
  const optionalEffects = [
    EitherAsync(() => effects.cache.set(cacheEntry))
      .mapLeft(err => `Cache set failed: ${err}`),
    EitherAsync(() => effects.notifications.sendEmail(emailPayload))
      .mapLeft(err => `Email send failed: ${err}`),
    EitherAsync(() => effects.analytics.trackEvent(analyticsEvent))
      .mapLeft(err => `Analytics tracking failed: ${err}`),
  ];

  if (missingProductAlerts.length > 0) {
    optionalEffects.push(
      EitherAsync(() => effects.monitoring.sendAlerts(missingProductAlerts))
        .mapLeft(err => `Alert send failed: ${err}`)
    );
  }

  // Execute optional effects without blocking the return
  // In a real system, you'd want to log these failures
  Promise.all(optionalEffects.map(effect => effect.run())).then(results => {
    results.forEach(result => {
      if (result.isLeft()) {
        // In production, log to monitoring system
        console.warn('Optional effect failed:', result.extract());
      }
    });
  });

    return Right(processedOrder);
  };
}

/**
 * Benefits of this approach:
 * 
 * 1. All business logic is in pure functions - test without ANY mocks
 * 2. The coordinator is just plumbing - minimal logic to verify
 * 3. Effect interfaces are simple to mock (no SQL semantics to replicate)
 * 4. Easy to see data flow: inputs → processing → outputs
 * 5. Can test email content without setting up database mocks
 * 6. Can test discount calculations without any effects at all
 * 7. Parallelization opportunities are obvious
 */
