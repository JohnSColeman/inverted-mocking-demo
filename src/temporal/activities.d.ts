/**
 * TEMPORAL ACTIVITIES TYPE DEFINITIONS
 * 
 * These type definitions map the flattened activity methods registered in worker.ts
 * to types that can be used with proxyActivities in workflows.
 * 
 * Note: Activity names have been made unique to avoid conflicts
 * (e.g., getOrderById, getCustomerById instead of just getById)
 */

import {CacheEntry, Customer, DiscountRule, NotificationPayload, Order, Product} from '../domain';
import {AnalyticsEvent, InventoryUpdate, MissingProductAlert} from '../pure/types';

// Flattened activities interface that matches worker.ts registration
export interface Activities {
  // OrderRepository methods
  readonly getOrderById(id: string): Promise<Order | null>;
  
  // CustomerRepository methods
  readonly getCustomerById(id: string): Promise<Customer | null>;
  readonly updateTotalPurchases(customerId: string, amount: number): Promise<void>;
  
  // ProductRepository methods
  readonly getProductsByIds(ids: string[]): Promise<Record<string, Product>>;
  readonly updateInventory(updates: InventoryUpdate[]): Promise<void>;
  
  // PricingService methods
  readonly getDiscountRules(): Promise<DiscountRule[]>;
  
  // CacheService methods
  readonly setCacheEntry(entry: CacheEntry): Promise<void>;
  
  // NotificationService methods
  readonly sendEmail(payload: NotificationPayload): Promise<void>;
  
  // MonitoringService methods
  readonly sendAlerts(alerts: MissingProductAlert[]): Promise<void>;
  
  // AnalyticsService methods
  readonly trackEvent(event: AnalyticsEvent): Promise<void>;
}
