/**
 * TEMPORAL WORKFLOW - Flattened Activities Version
 * 
 * This version uses flattened activity names that match the worker registration.
 * Activities are registered as individual methods (e.g., getOrderById, getCustomerById)
 * rather than namespaced methods (e.g., orders.getById, customers.getById).
 * 
 * This approach:
 * 1. Avoids namespace conflicts in activity registration
 * 2. Makes activity names explicit and unique
 * 3. Simplifies the worker registration code
 */
import { ProcessedOrder } from '../domain';
import { processOrder } from '../pure/orderProcessing';
import type { AppEffects } from '../pure/effects';
import { Activities } from './activities';
import { ActivityOptions, proxyActivities } from '@temporalio/workflow';
import { Either } from 'purify-ts';

const databaseActivityOptions: ActivityOptions = {
  startToCloseTimeout: '120s',
  retry: {
    initialInterval: 500,
    backoffCoefficient: 2,
    maximumAttempts: 9,
    maximumInterval: 1600,
  },
}

const apiActivityOptions: ActivityOptions = {
  startToCloseTimeout: '150s',
  retry: {
    initialInterval: 500,
    backoffCoefficient: 2,
    maximumAttempts: 10,
    maximumInterval: 3000,
  },
}

const cacheActivityOptions: ActivityOptions = {
  startToCloseTimeout: '120s',
  retry: {
    initialInterval: 250,
    backoffCoefficient: 2,
    maximumAttempts: 10,
    maximumInterval: 10000,
  },
}

const defaultActivityOptions: ActivityOptions = {
  startToCloseTimeout: '120s',
  retry: {
    initialInterval: 1000,
    backoffCoefficient: 2,
    maximumAttempts: 10,
    maximumInterval: 30000,
  },
}

// Create separate proxies for different activity groups with specific retry policies

// Database activities (orders, customers, products)
const {
  getOrderById,
  getCustomerById,
  updateTotalPurchases,
  getProductsByIds,
  updateInventory,
} = proxyActivities<Pick<Activities, 
  'getOrderById' | 
  'getCustomerById' | 
  'updateTotalPurchases' | 
  'getProductsByIds' | 
  'updateInventory'
>>(databaseActivityOptions);

// API activities (pricing)
const {
  getDiscountRules,
} = proxyActivities<Pick<Activities, 'getDiscountRules'>>(apiActivityOptions);

// Cache activities
const {
  setCacheEntry,
} = proxyActivities<Pick<Activities, 'setCacheEntry'>>(cacheActivityOptions);

// Default activities (notifications, monitoring, analytics)
const {
  sendEmail,
  sendAlerts,
  trackEvent,
} = proxyActivities<Pick<Activities, 'sendEmail' | 'sendAlerts' | 'trackEvent'>>(defaultActivityOptions);

/**
 * Main workflow for processing an order with full durability
 * 
 * This workflow adapts the flattened activities back to the AppEffects structure
 * expected by the pure business logic.
 */
export async function processOrderWorkflow(orderId: string): Promise<Either<unknown[], ProcessedOrder>> {
  // Adapt flattened activities back to the AppEffects structure
  // This maintains the separation between business logic and Temporal specifics
  // Each activity uses its appropriate retry policy based on the proxy it came from
  const temporalEffects: AppEffects = {
    orders: {
      getById: getOrderById,
    },
    customers: {
      getById: getCustomerById,
      updateTotalPurchases: updateTotalPurchases,
    },
    products: {
      getByIds: getProductsByIds,
      updateInventory: updateInventory,
    },
    pricing: {
      getDiscountRules: getDiscountRules,
    },
    cache: {
      set: setCacheEntry,
    },
    notifications: {
      sendEmail: sendEmail,
    },
    monitoring: {
      sendAlerts: sendAlerts,
    },
    analytics: {
      trackEvent: trackEvent,
    },
  };

  return await processOrder(orderId)(temporalEffects);
}
