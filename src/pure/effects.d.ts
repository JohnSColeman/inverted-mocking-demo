/**
 * EFFECTS LAYER
 * 
 * This layer handles all external IO. Functions here are thin wrappers
 * that just move data in/out. No business logic whatsoever.
 * 
 * Following Parsons' advice: instead of mocking the database directly
 * (which would require implementing SQL semantics), we create weaker
 * abstractions at the right level - like "getOrderById" rather than
 * "execute arbitrary SQL".
 */

import {CacheEntry, Customer, DiscountRule, NotificationPayload, Order, Product,} from '../domain';
import {AnalyticsEvent, InventoryUpdate, MissingProductAlert,} from './businessLogic';

// ============================================================================
// Effect Interfaces
// 
// These are the "weaker abstractions" Parsons recommends. Instead of mocking
// a full database, you implement these simple interfaces. Much easier!
// ============================================================================

export interface OrderRepository {
  readonly getById(id: string): Promise<Order | null>;
}

export interface CustomerRepository {
  readonly getById(id: string): Promise<Customer | null>;
  readonly updateTotalPurchases(customerId: string, amount: number): Promise<void>;
}

export interface ProductRepository {
  readonly getByIds(ids: string[]): Promise<Record<string, Product>>;
  readonly updateInventory(updates: InventoryUpdate[]): Promise<void>;
}

export interface PricingService {
  readonly getDiscountRules(): Promise<DiscountRule[]>;
}

export interface CacheService {
  readonly set(entry: CacheEntry): Promise<void>;
}

export interface NotificationService {
  readonly sendEmail(payload: NotificationPayload): Promise<void>;
}

export interface MonitoringService {
  readonly sendAlerts(alerts: MissingProductAlert[]): Promise<void>;
}

export interface AnalyticsService {
  readonly trackEvent(event: AnalyticsEvent): Promise<void>;
}

// ============================================================================
// Combined Dependencies
// 
// Group all effects together. This makes it easy to provide real or test
// implementations. No complex DI framework needed - just an object.
// ============================================================================

export type AppEffects = {
  readonly orders: OrderRepository;
  readonly customers: CustomerRepository;
  readonly products: ProductRepository;
  readonly pricing: PricingService;
  readonly cache: CacheService;
  readonly notifications: NotificationService;
  readonly monitoring: MonitoringService;
  readonly analytics: AnalyticsService;
}
