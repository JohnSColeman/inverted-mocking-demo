/**
 * INTEGRATION TESTS
 * 
 * Here we test the coordinator with mocked effects. Notice how simple
 * these mocks are compared to mocking a full database!
 * 
 * We're not testing business logic here - that's already covered by
 * the pure function tests. We're just testing that the plumbing works.
 */

import {Customer, DiscountRule, Order, Product} from '../domain';
import {processOrder} from '../pure/orderProcessing';
import {AppEffects} from '../pure/effects';

// Simple test data
const testOrder: Order = {
  id: 'order-123',
  customerId: 'cust-456',
  createdAt: new Date('2024-01-15'),
  items: [
    { productId: 'prod-1', quantity: 2, pricePerUnit: 25 },
    { productId: 'prod-2', quantity: 1, pricePerUnit: 50 },
  ],
};

const testCustomer: Customer = {
  id: 'cust-456',
  email: 'test@example.com',
  tier: 'premium',
  totalPurchases: 500,
};

const testProducts: Record<string, Product> = {
  'prod-1': { id: 'prod-1', name: 'Widget', stock: 100, category: 'electronics' },
  'prod-2': { id: 'prod-2', name: 'Gadget', stock: 50, category: 'electronics' },
};

const testDiscountRules: DiscountRule[] = [
  { tier: 'premium', minPurchase: 50, discountPercent: 10 },
];

/**
 * Create mock effects - this is SO much simpler than mocking a database!
 * We just return the data we want. No SQL parsing, no query matching.
 */
function createMockEffects(overrides: Partial<AppEffects> = {}): AppEffects {
  return {
    orders: {
      getById: jest.fn().mockResolvedValue(testOrder),
    },
    customers: {
      getById: jest.fn().mockResolvedValue(testCustomer),
      updateTotalPurchases: jest.fn().mockResolvedValue(undefined),
    },
    products: {
      getByIds: jest.fn().mockResolvedValue(testProducts),
      updateInventory: jest.fn().mockResolvedValue(undefined),
    },
    pricing: {
      getDiscountRules: jest.fn().mockResolvedValue(testDiscountRules),
    },
    cache: {
      set: jest.fn().mockResolvedValue(undefined),
    },
    notifications: {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    },
    monitoring: {
      sendAlerts: jest.fn().mockResolvedValue(undefined),
    },
    analytics: {
      trackEvent: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

describe('processOrder integration', () => {
  it('processes order and returns correct result', async () => {
    const effects = createMockEffects();
    
    const result = await processOrder('order-123')(effects);

    // Subtotal: (2 * 25) + (1 * 50) = 100
    // Discount: 100 * 0.10 = 10
    // Total: 90
    expect(result.isRight()).toBe(true);
    result.ifRight(order => {
      expect(order.subtotal).toBe(100);
      expect(order.discount).toBe(10);
      expect(order.total).toBe(90);
    });
  });

  it('calls all required effects', async () => {
    const effects = createMockEffects();
    
    await processOrder('order-123')(effects);

    expect(effects.orders.getById).toHaveBeenCalledWith('order-123');
    expect(effects.customers.getById).toHaveBeenCalledWith('cust-456');
    expect(effects.products.getByIds).toHaveBeenCalledWith(['prod-1', 'prod-2']);
    expect(effects.pricing.getDiscountRules).toHaveBeenCalled();
    expect(effects.cache.set).toHaveBeenCalled();
    expect(effects.notifications.sendEmail).toHaveBeenCalled();
    expect(effects.analytics.trackEvent).toHaveBeenCalled();
  });

  it('updates customer total purchases with correct amount', async () => {
    const effects = createMockEffects();
    
    await processOrder('order-123')(effects);

    expect(effects.customers.updateTotalPurchases).toHaveBeenCalledWith('cust-456', 90);
  });

  it('sends email to correct address', async () => {
    const effects = createMockEffects();
    
    await processOrder('order-123')(effects);

    expect(effects.notifications.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
        subject: expect.stringContaining('order-123'),
      })
    );
  });

  it('returns Left when order not found', async () => {
    const effects = createMockEffects({
      orders: {
        getById: jest.fn().mockResolvedValue(null),
      },
    });

    const result = await processOrder('missing-order')(effects);
    
    expect(result.isLeft()).toBe(true);
    result.ifLeft(errors => {
      expect(errors).toContain('Order missing-order not found');
    });
  });

  it('returns Left when customer not found', async () => {
    const effects = createMockEffects({
      customers: {
        getById: jest.fn().mockResolvedValue(null),
        updateTotalPurchases: jest.fn(),
      },
    });

    const result = await processOrder('order-123')(effects);
    
    expect(result.isLeft()).toBe(true);
    result.ifLeft(errors => {
      expect(errors).toContain('Customer cust-456 not found');
    });
  });

  it('handles missing products gracefully', async () => {
    // Only one product exists
    const partialProducts: Record<string, Product> = {
      'prod-1': { id: 'prod-1', name: 'Widget', stock: 100, category: 'electronics' },
    };

    const effects = createMockEffects({
      products: {
        getByIds: jest.fn().mockResolvedValue(partialProducts),
        updateInventory: jest.fn().mockResolvedValue(undefined),
      },
    });

    const result = await processOrder('order-123')(effects);

    expect(result.isRight()).toBe(true);
    result.ifRight(order => {
      // Only prod-1 should be in the result
      expect(order.itemsSummary).toHaveLength(1);
      expect(order.itemsSummary[0]!.productId).toBe('prod-1');
    });
    
    // Should send alert for missing product
    expect(effects.monitoring.sendAlerts).toHaveBeenCalledWith([
      { type: 'missing_product', productId: 'prod-2', orderId: 'order-123' },
    ]);
  });

  it('updates inventory correctly', async () => {
    const effects = createMockEffects();
    
    await processOrder('order-123')(effects);

    expect(effects.products.updateInventory).toHaveBeenCalledWith([
      { productId: 'prod-1', quantityChange: -2 },
      { productId: 'prod-2', quantityChange: -1 },
    ]);
  });

  it('returns Left when inventory update fails', async () => {
    const effects = createMockEffects({
      products: {
        getByIds: jest.fn().mockResolvedValue(testProducts),
        updateInventory: jest.fn().mockRejectedValue(new Error('Inventory service unavailable')),
      },
    });

    const result = await processOrder('order-123')(effects);
    
    expect(result.isLeft()).toBe(true);
    // Error is returned - specific message format may vary
    expect(result.extract()).toBeTruthy();
  });

  it('returns Left when customer update fails', async () => {
    const effects = createMockEffects({
      customers: {
        getById: jest.fn().mockResolvedValue(testCustomer),
        updateTotalPurchases: jest.fn().mockRejectedValue(new Error('Customer service down')),
      },
    });

    const result = await processOrder('order-123')(effects);
    
    expect(result.isLeft()).toBe(true);
    // Error is returned - specific message format may vary
    expect(result.extract()).toBeTruthy();
  });

  it('returns Left when email sending fails', async () => {
    const effects = createMockEffects({
      notifications: {
        sendEmail: jest.fn().mockRejectedValue(new Error('Email service down')),
      },
    });

    const result = await processOrder('order-123')(effects);
    
    // All effects must succeed
    expect(result.isLeft()).toBe(true);
    // Error is returned - specific message format may vary
    expect(result.extract()).toBeTruthy();
  });

  it('returns Left when cache operation fails', async () => {
    const effects = createMockEffects({
      cache: {
        set: jest.fn().mockRejectedValue(new Error('Cache unavailable')),
      },
    });

    const result = await processOrder('order-123')(effects);
    
    // All effects must succeed
    expect(result.isLeft()).toBe(true);
    // Error is returned - specific message format may vary
    expect(result.extract()).toBeTruthy();
  });
});

/**
 * Notice how these tests are:
 * 
 * 1. Easy to write - just return the data you want
 * 2. Fast - no database, no network
 * 3. Reliable - no flaky external dependencies
 * 4. Focused - we're testing the plumbing, not the logic
 * 
 * The business logic tests (in businessLogic.test.ts) don't need ANY
 * of this mocking. That's where the real complexity lives, and it's
 * tested with simple input/output assertions.
 * 
 * Note: All effects must succeed for the operation to complete.
 * In the Temporal workflow version, they will be automatically retried
 * until they succeed or max attempts is reached, providing durability
 * and reliability.
 */
