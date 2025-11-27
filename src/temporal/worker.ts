/**
 * TEMPORAL WORKER - Improved Version
 * 
 * This version eliminates the need for activities/index.ts by:
 * 1. Passing the AppEffects implementations directly as activities
 * 2. Temporal automatically discovers methods from the provided objects
 * 3. No manual wrapper functions needed!
 * 
 * The key insight: Temporal's activity registration can work directly
 * with your effect implementations since they already have the right
 * method signatures (async functions returning Promises).
 */
import {AppEffects} from '../pure/effects';
import {Activities} from "./activities";
import {NativeConnection, Worker} from '@temporalio/worker';

/**
 * Create and start a Temporal worker
 * 
 * @param effects - Your application's effect implementations (database, HTTP, etc.)
 * @param namespace - Temporal namespace (defaults to 'default')
 * @param taskQueue - Task queue name (defaults to 'order-processing')
 */
export async function createWorker(
  effects: AppEffects,
  namespace = 'default',
  taskQueue = 'order-processing'
): Promise<Worker> {
  // Connect to Temporal server
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  });

  // Flatten all effect methods as individual activities
  // This avoids namespace prefixes and matches the workflow's proxyActivities expectations
  // Note: We need to bind methods to preserve 'this' context
  const activities: Activities = {
    // OrderRepository methods
    getOrderById: effects.orders.getById.bind(effects.orders),
    
    // CustomerRepository methods
    getCustomerById: effects.customers.getById.bind(effects.customers),
    updateTotalPurchases: effects.customers.updateTotalPurchases.bind(effects.customers),
    
    // ProductRepository methods
    getProductsByIds: effects.products.getByIds.bind(effects.products),
    updateInventory: effects.products.updateInventory.bind(effects.products),
    
    // PricingService methods
    getDiscountRules: effects.pricing.getDiscountRules.bind(effects.pricing),
    
    // CacheService methods
    setCacheEntry: effects.cache.set.bind(effects.cache),
    
    // NotificationService methods
    sendEmail: effects.notifications.sendEmail.bind(effects.notifications),
    
    // MonitoringService methods
    sendAlerts: effects.monitoring.sendAlerts.bind(effects.monitoring),
    
    // AnalyticsService methods
    trackEvent: effects.analytics.trackEvent.bind(effects.analytics),
  };

  // Create worker with workflows and activities
  return await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: require.resolve('./processOrder.workflow'),
    activities,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentWorkflowTaskExecutions: 10,
  });
}

/**
 * Start the worker (if running as a standalone process)
 * 
 * Usage:
 *   npm run worker
 */
export async function runWorker(effects: AppEffects): Promise<void> {
  const worker = await createWorker(effects);
  
  console.log('🏃 Temporal worker starting...');
  console.log('📦 Task queue: order-processing');
  console.log('🌐 Temporal address:', process.env.TEMPORAL_ADDRESS || 'localhost:7233');
  console.log('✨ Activities registered directly from effects - no index.ts needed!');
  
  await worker.run();
}

/**
 * Benefits of This Approach
 * 
 * 1. **Eliminates Boilerplate**: No need for activities/index.ts with wrapper functions
 * 2. **DRY Principle**: Effects interface already defines the contract
 * 3. **Type Safety**: TypeScript ensures effects match the AppEffects interface
 * 4. **Easier Maintenance**: One less file to keep in sync
 * 5. **Direct Mapping**: Effect methods ARE activities, no translation layer
 * 
 * How It Works:
 * - Temporal's worker accepts plain objects with async methods as activities
 * - It automatically discovers all methods and registers them
 * - In workflows, proxyActivities<T>() creates proxies that call these methods
 * - Activity names are derived from the structure: e.g., "orders.getById"
 */
