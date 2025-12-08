/**
 * PURE BUSINESS LOGIC
 * 
 * These functions take values and return values. No effects whatsoever.
 * They are trivial to test - just call them with inputs and check outputs.
 * No mocking required at all.
 *
 * Note that for simplicity currency and correct decimal precision are not
 * integrated into calculations with prices.
 */

import {Customer, CustomerTier, DiscountRule, ItemSummary, Order, ProcessedOrder, Product,} from '../domain';
import {CacheEntry, NotificationPayload} from "../types";
import {AnalyticsEvent, InventoryUpdate, LineItem, MissingProductAlert} from "./types";
import {Maybe} from "purify-ts";

// ============================================================================
// Core Calculations
// ============================================================================

export function calculateLineItems(
  order: Order,
  products: Record<string, Product>
): { items: LineItem[]; missingProductIds: Maybe<string[]> } {
  const result = order.items.reduce(
    (acc, orderItem) => {
      const product = products[orderItem.productId];
      
      if (!product) {
        return {
          ...acc,
          missingProductIds: [...acc.missingProductIds, orderItem.productId]
        };
      }

      return {
        ...acc,
        items: [...acc.items, {
          productId: orderItem.productId,
          productName: product.name,
          quantity: orderItem.quantity,
          pricePerUnit: orderItem.pricePerUnit,
          lineTotal: orderItem.quantity * orderItem.pricePerUnit,
        }]
      };
    },
    { items: [] as LineItem[], missingProductIds: [] as string[] }
  );
  
  return {
    items: result.items,
    missingProductIds: Maybe.fromPredicate(a => a.length > 0, result.missingProductIds)
  };
}

export function calculateSubtotal(lineItems: LineItem[]): number {
  return lineItems.reduce((sum, item) => sum + item.lineTotal, 0);
}

export function findApplicableDiscount(
  rules: DiscountRule[],
  customerTier: CustomerTier,
  subtotal: number
): DiscountRule | null {
  return rules
    .filter(rule => rule.tier === customerTier)
    .find(rule => subtotal >= rule.minPurchase) ?? null;
}

export function calculateDiscount(
  subtotal: number,
  rule: DiscountRule | null
): number {
  if (!rule) return 0;
  return subtotal * (rule.discountPercent / 100);
}

const loyaltyPointsStrategies: Record<CustomerTier, (basePoints: number) => number> = {
  vip: (basePoints) => basePoints * 2,
  premium: (basePoints) => Math.floor(basePoints * 1.5),
  standard: (basePoints) => basePoints,
};

export function calculateLoyaltyPoints(
  total: number,
  customerTier: CustomerTier
): number {
  const basePoints = Math.floor(total / 10);
  return loyaltyPointsStrategies[customerTier](basePoints);
}

// ============================================================================
// Data Transformations
// ============================================================================

export function toItemsSummary(lineItems: LineItem[]): ItemSummary[] {
  return lineItems.map(item => ({
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
  }));
}

export function toProcessedOrder(
  order: Order,
  customer: Customer,
  lineItems: LineItem[],
  discountRule: DiscountRule | null
): ProcessedOrder {
  const subtotal = calculateSubtotal(lineItems);
  const discount = calculateDiscount(subtotal, discountRule);
  const total = subtotal - discount;
  const loyaltyPointsEarned = calculateLoyaltyPoints(total, customer.tier);

  return {
    orderId: order.id,
    customerId: customer.id,
    subtotal,
    discount,
    total,
    loyaltyPointsEarned,
    itemsSummary: toItemsSummary(lineItems),
  };
}

// ============================================================================
// Inventory Updates
// ============================================================================

export function calculateInventoryUpdates(lineItems: LineItem[]): InventoryUpdate[] {
  return lineItems.map(item => ({
    productId: item.productId,
    quantityChange: -item.quantity, // Negative because we're removing stock
  }));
}

// ============================================================================
// Notifications & External Data Preparation
// ============================================================================

export function buildConfirmationEmail(
  customer: Customer,
  processed: ProcessedOrder
): NotificationPayload {
  return {
    to: customer.email,
    subject: `Order ${processed.orderId} Confirmed`,
    body: `
Thank you for your order!

Subtotal: $${processed.subtotal.toFixed(2)}
Discount: -$${processed.discount.toFixed(2)}
Total: $${processed.total.toFixed(2)}

You earned ${processed.loyaltyPointsEarned} loyalty points!
    `.trim(),
  };
}

export function buildCacheEntry(processed: ProcessedOrder): CacheEntry {
  return {
    key: `processed-order:${processed.orderId}`,
    value: JSON.stringify(processed),
    ttlSeconds: 3600,
  };
}

export function buildAnalyticsEvent(
  processed: ProcessedOrder,
  customerTier: Customer['tier']
): AnalyticsEvent {
  return {
    event: 'order_processed',
    orderId: processed.orderId,
    total: processed.total,
    customerTier,
  };
}

export function buildMissingProductAlerts(
  orderId: string,
  missingProductIds: string[]
): MissingProductAlert[] {
  return missingProductIds.map(productId => ({
    type: 'missing_product' as const,
    productId,
    orderId,
  }));
}
