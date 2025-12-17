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
import {LineItem} from "./types";
import {EffectsError} from "../effects/EffectsError";
import {Either, EitherAsync, Left, Maybe, NonEmptyList, Right} from 'purify-ts';

type OrderDetails = {
    readonly order: Order;
    readonly customer: Customer;
    readonly products: Record<string, Product>;
    readonly discountRules: DiscountRule[];
};

type ProcessedOrderWithLineItems = ProcessedOrder & {lineItems: LineItem[], missingProductIds: Maybe<string[]>}

/**
 * Process the given order ID.
 * Orchestrates the three main steps:
 * 1. Fetch order details (effects)
 * 2. Process order (pure business logic)
 * 3. Finalise order (effects)
 *
 * @param orderId
 * @return a function to process the order using the given app effects returning
 * either the business logic errors or the successfully processed order
 * @throws EffectsError
 */
export function processOrder(
    orderId: string
): (appEffects: AppEffects) => Promise<Either<NonEmptyList<string>, ProcessedOrder>> {
    return async (appEffects: AppEffects) => {
        // synchronously perform the initial steps - this can fail fast when effects throw
        const orderDetails = await fetchOrderDetails(orderId)(appEffects);
        const processedOrder = orderDetails.map(details => ({
            ...details,
            processedOrder: doProcessOrder(details)
        }));
        // return either lifting business logic failures into Promise or lifting final effect into Right
        return processedOrder.caseOf({
            Left: (errors) => Promise.resolve(Left(errors)),
            Right: async (result) => {
                const processedOrder = await finaliseOrder(result.customer, result.processedOrder)(appEffects)
                return Right(processedOrder);
            }
        });
    };
}

/**
 * Fetch the order details required for order processing.
 * @param orderId
 * @return either the failures or the gathered input data
 */
function fetchOrderDetails(
    orderId: string
): (appEffects: AppEffects) => Promise<Either<NonEmptyList<string>, OrderDetails>> {
    return async (appEffects: AppEffects) => {
        // ========== GATHER INPUTS (Effects) ==========

        const order = await appEffects.orders.getById(orderId);
        if (!order) {
            return Left(NonEmptyList([`Order ${orderId} not found`]));
        }

        const customer = await appEffects.customers.getById(order.customerId);
        if (!customer) {
            return Left(NonEmptyList([`Customer ${order.customerId} not found`]));
        }

        const productIds = order.items.map(item => item.productId);
        const [products, discountRules] = await Promise.all([
            appEffects.products.getByIds(productIds),
            appEffects.pricing.getDiscountRules(),
        ]);

        return Right({order, customer, products, discountRules});
    };
}

/**
 * Process order using pure business logic.
 * Calculates line items, discounts, and builds the processed order.
 * This function is completely pure - no effects at all.
 * @return the processed order
 */
function doProcessOrder(
    orderDetails: OrderDetails
): ProcessedOrderWithLineItems {
    // ========== PURE BUSINESS LOGIC (No Effects) ==========

    // Calculate line items and identify missing products
    const {lineItems, missingProductIds} = calculateLineItems(orderDetails.order, orderDetails.products);

    // Find applicable discount
    const discountRule = findApplicableDiscount(
        orderDetails.discountRules,
        orderDetails.customer.tier,
        lineItems.reduce((sum, item) => sum + item.lineTotal, 0)
    );

    // Build the processed order (all the core calculations happen here)
    return {
        ...toProcessedOrder(orderDetails.order, orderDetails.customer, lineItems, discountRule),
        lineItems,
        missingProductIds
    }
}

/**
 * Perform all output effects for a processed order.
 * Executes inventory updates, customer updates, caching, notifications, analytics, and monitoring.
 * @return the processed order
 */
function finaliseOrder(
    customer: Customer,
    processedOrder: ProcessedOrder & { lineItems: LineItem[], missingProductIds: Maybe<string[]> },
): (appEffects: AppEffects) => Promise<ProcessedOrder> {
    return async (appEffects: AppEffects) => {
        // ========== PREPARE ALL OUTPUT DATA ==========

        const inventoryUpdates = calculateInventoryUpdates(processedOrder.lineItems);
        const emailPayload = buildConfirmationEmail(customer, processedOrder);
        const cacheEntry = buildCacheEntry(processedOrder);
        const analyticsEvent = buildAnalyticsEvent(processedOrder, customer.tier);
        const missingProductAlerts = processedOrder.missingProductIds
            .map(ids => buildMissingProductAlerts(processedOrder.orderId, ids));

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

        // Execute all effects and throw the failures or return the processed order
        const results = await Promise.all(effects.map(e => EitherAsync(e).run()));
        const errors = Either.lefts(results)
            .map(err => (err instanceof Error) ? err : new Error(String(err)));
        if (errors.length) throw new EffectsError(errors);
        return processedOrder;
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
