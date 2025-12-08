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
import {Customer, DiscountRule, Order, ProcessedOrder, Product} from '../domain';
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
 * Process the given order ID.
 * @param orderId
 * @return a function to process the order using the given app effects returning
 * either the first effect to fail or the processed order
 */
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

        return doProcessOrder(order, customer, products, discountRules)(appEffects);
    };
}

function doProcessOrder(
    order: Order,
    customer: Customer,
    products: Record<string, Product>,
    discountRules: DiscountRule[]
): (appEffects: AppEffects) => Promise<Either<unknown[], ProcessedOrder>> {
    return async (appEffects: AppEffects) => {
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
            .map(ids => buildMissingProductAlerts(order.id, ids));

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
        if (errors.length > 0) return Left(errors);
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
 * 8. All effects are critical - any failure fails the entire operation
 * 9. Works seamlessly with Temporal workflows when effects are activity proxies
 */
