/**
 * TESTS FOR PURE BUSINESS LOGIC
 * 
 * Notice: NO MOCKS ANYWHERE. These are just function calls with inputs and outputs.
 * This is the "inverted mocking" approach - instead of mocking effects,
 * we extracted the logic so it doesn't need effects at all.
 */

import {Customer, DiscountRule, Order, Product} from '../domain';
import {
  buildConfirmationEmail,
  buildMissingProductAlerts,
  calculateDiscount,
  calculateInventoryUpdates,
  calculateLineItems,
  calculateLoyaltyPoints,
  calculateSubtotal,
  findApplicableDiscount,
  toProcessedOrder,
} from '../after/businessLogic';


describe('calculateLineItems', () => {
  const products = new Map<string, Product>([
    ['prod-1', { id: 'prod-1', name: 'Widget', stock: 100, category: 'electronics' }],
    ['prod-2', { id: 'prod-2', name: 'Gadget', stock: 50, category: 'electronics' }],
  ]);

  it('calculates line totals correctly', () => {
    const order: Order = {
      id: 'order-1',
      customerId: 'cust-1',
      createdAt: new Date(),
      items: [
        { productId: 'prod-1', quantity: 2, pricePerUnit: 10 },
        { productId: 'prod-2', quantity: 3, pricePerUnit: 20 },
      ],
    };

    const { items, missingProductIds } = calculateLineItems(order, products);

    expect(items).toHaveLength(2);
    expect(items[0].lineTotal).toBe(20); // 2 * 10
    expect(items[1].lineTotal).toBe(60); // 3 * 20
    expect(missingProductIds).toHaveLength(0);
  });

  it('identifies missing products', () => {
    const order: Order = {
      id: 'order-1',
      customerId: 'cust-1',
      createdAt: new Date(),
      items: [
        { productId: 'prod-1', quantity: 1, pricePerUnit: 10 },
        { productId: 'missing-prod', quantity: 1, pricePerUnit: 100 },
      ],
    };

    const { items, missingProductIds } = calculateLineItems(order, products);

    expect(items).toHaveLength(1);
    expect(missingProductIds).toEqual(['missing-prod']);
  });

  it('handles empty orders', () => {
    const order: Order = {
      id: 'order-1',
      customerId: 'cust-1',
      createdAt: new Date(),
      items: [],
    };

    const { items, missingProductIds } = calculateLineItems(order, products);

    expect(items).toHaveLength(0);
    expect(missingProductIds).toHaveLength(0);
  });
});

describe('calculateSubtotal', () => {
  it('sums all line totals', () => {
    const lineItems = [
      { productId: 'p1', productName: 'A', quantity: 1, pricePerUnit: 10, lineTotal: 10 },
      { productId: 'p2', productName: 'B', quantity: 2, pricePerUnit: 20, lineTotal: 40 },
      { productId: 'p3', productName: 'C', quantity: 3, pricePerUnit: 5, lineTotal: 15 },
    ];

    expect(calculateSubtotal(lineItems)).toBe(65);
  });

  it('returns 0 for empty list', () => {
    expect(calculateSubtotal([])).toBe(0);
  });
});

describe('findApplicableDiscount', () => {
  const rules: DiscountRule[] = [
    { tier: 'standard', minPurchase: 100, discountPercent: 5 },
    { tier: 'premium', minPurchase: 50, discountPercent: 10 },
    { tier: 'premium', minPurchase: 200, discountPercent: 15 },
    { tier: 'vip', minPurchase: 0, discountPercent: 20 },
  ];

  it('finds matching rule for tier and amount', () => {
    const rule = findApplicableDiscount(rules, 'premium', 100);
    expect(rule?.discountPercent).toBe(10);
  });

  it('returns null when no rule matches', () => {
    const rule = findApplicableDiscount(rules, 'standard', 50);
    expect(rule).toBeNull();
  });

  it('VIP always gets discount', () => {
    const rule = findApplicableDiscount(rules, 'vip', 1);
    expect(rule?.discountPercent).toBe(20);
  });
});

describe('calculateDiscount', () => {
  it('applies discount percentage', () => {
    const rule: DiscountRule = { tier: 'premium', minPurchase: 50, discountPercent: 10 };
    expect(calculateDiscount(100, rule)).toBe(10);
  });

  it('returns 0 when no rule', () => {
    expect(calculateDiscount(100, null)).toBe(0);
  });

  it('handles fractional discounts', () => {
    const rule: DiscountRule = { tier: 'vip', minPurchase: 0, discountPercent: 15 };
    expect(calculateDiscount(33, rule)).toBeCloseTo(4.95);
  });
});

describe('calculateLoyaltyPoints', () => {
  it('standard tier gets base points', () => {
    expect(calculateLoyaltyPoints(100, 'standard')).toBe(10);
  });

  it('premium tier gets 1.5x points', () => {
    expect(calculateLoyaltyPoints(100, 'premium')).toBe(15);
  });

  it('VIP tier gets 2x points', () => {
    expect(calculateLoyaltyPoints(100, 'vip')).toBe(20);
  });

  it('floors fractional points', () => {
    expect(calculateLoyaltyPoints(55, 'standard')).toBe(5);
    expect(calculateLoyaltyPoints(55, 'premium')).toBe(7); // floor(5 * 1.5)
  });
});

describe('toProcessedOrder', () => {
  const order: Order = {
    id: 'order-123',
    customerId: 'cust-456',
    createdAt: new Date(),
    items: [],
  };

  const customer: Customer = {
    id: 'cust-456',
    email: 'test@example.com',
    tier: 'premium',
    totalPurchases: 500,
  };

  const lineItems = [
    { productId: 'p1', productName: 'Widget', quantity: 2, pricePerUnit: 50, lineTotal: 100 },
  ];

  it('assembles processed order correctly', () => {
    const discountRule: DiscountRule = { tier: 'premium', minPurchase: 50, discountPercent: 10 };
    
    const processed = toProcessedOrder(order, customer, lineItems, discountRule);

    expect(processed.orderId).toBe('order-123');
    expect(processed.customerId).toBe('cust-456');
    expect(processed.subtotal).toBe(100);
    expect(processed.discount).toBe(10);
    expect(processed.total).toBe(90);
    expect(processed.loyaltyPointsEarned).toBe(13); // floor(90/10 * 1.5)
  });

  it('handles no discount', () => {
    const processed = toProcessedOrder(order, customer, lineItems, null);

    expect(processed.subtotal).toBe(100);
    expect(processed.discount).toBe(0);
    expect(processed.total).toBe(100);
  });
});

describe('buildConfirmationEmail', () => {
  it('formats email with correct amounts', () => {
    const customer: Customer = {
      id: 'cust-1',
      email: 'customer@example.com',
      tier: 'premium',
      totalPurchases: 1000,
    };

    const processed = {
      orderId: 'order-999',
      customerId: 'cust-1',
      subtotal: 150,
      discount: 15,
      total: 135,
      loyaltyPointsEarned: 20,
      itemsSummary: [],
    };

    const email = buildConfirmationEmail(customer, processed);

    expect(email.to).toBe('customer@example.com');
    expect(email.subject).toContain('order-999');
    expect(email.body).toContain('$150.00');
    expect(email.body).toContain('$15.00');
    expect(email.body).toContain('$135.00');
    expect(email.body).toContain('20 loyalty points');
  });
});

describe('calculateInventoryUpdates', () => {
  it('creates negative quantity changes for each item', () => {
    const lineItems = [
      { productId: 'p1', productName: 'A', quantity: 5, pricePerUnit: 10, lineTotal: 50 },
      { productId: 'p2', productName: 'B', quantity: 3, pricePerUnit: 20, lineTotal: 60 },
    ];

    const updates = calculateInventoryUpdates(lineItems);

    expect(updates).toEqual([
      { productId: 'p1', quantityChange: -5 },
      { productId: 'p2', quantityChange: -3 },
    ]);
  });
});

describe('buildMissingProductAlerts', () => {
  it('creates alert for each missing product', () => {
    const alerts = buildMissingProductAlerts('order-1', ['prod-a', 'prod-b']);

    expect(alerts).toEqual([
      { type: 'missing_product', productId: 'prod-a', orderId: 'order-1' },
      { type: 'missing_product', productId: 'prod-b', orderId: 'order-1' },
    ]);
  });

  it('returns empty array when no missing products', () => {
    const alerts = buildMissingProductAlerts('order-1', []);
    expect(alerts).toEqual([]);
  });
});
