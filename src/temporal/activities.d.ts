/**
 * TEMPORAL ACTIVITIES TYPE DEFINITIONS
 * 
 * These type definitions map the flattened activity methods registered in worker.ts
 * to types that can be used with proxyActivities in workflows.
 * 
 * Note: Activity names have been made unique to avoid conflicts
 * (e.g., getOrderById, getCustomerById instead of just getById)
 */

import { Order, Customer, Product, DiscountRule, CacheEntry, NotificationPayload } from '../domain';
import { AnalyticsEvent, InventoryUpdate, MissingProductAlert } from '../pure/types';

// Flattened activities interface that matches worker.ts registration
export interface Activities {
  // OrderRepository methods
  getOrderById(id: string): Promise<Order | null>;
  
  // CustomerRepository methods
  getCustomerById(id: string): Promise<Customer | null>;
  updateTotalPurchases(customerId: string, amount: number): Promise<void>;
  
  // ProductRepository methods
  getProductsByIds(ids: string[]): Promise<Record<string, Product>>;
  updateInventory(updates: InventoryUpdate[]): Promise<void>;
  
  // PricingService methods
  getDiscountRules(): Promise<DiscountRule[]>;
  
  // CacheService methods
  setCacheEntry(entry: CacheEntry): Promise<void>;
  
  // NotificationService methods
  sendEmail(payload: NotificationPayload): Promise<void>;
  
  // MonitoringService methods
  sendAlerts(alerts: MissingProductAlert[]): Promise<void>;
  
  // AnalyticsService methods
  trackEvent(event: AnalyticsEvent): Promise<void>;
}
