// Domain types shared across the application

export type Order = {
  id: string;
  customerId: string;
  items: OrderItem[];
  createdAt: Date;
};

export type OrderItem = {
  productId: string;
  quantity: number;
  pricePerUnit: number;
};

export type Customer = {
  id: string;
  email: string;
  tier: 'standard' | 'premium' | 'vip';
  totalPurchases: number;
};

export type Product = {
  id: string;
  name: string;
  stock: number;
  category: string;
};

export type DiscountRule = {
  tier: Customer['tier'];
  minPurchase: number;
  discountPercent: number;
};

export type ProcessedOrder = {
  orderId: string;
  customerId: string;
  subtotal: number;
  discount: number;
  total: number;
  loyaltyPointsEarned: number;
  itemsSummary: ItemSummary[];
};

export type ItemSummary = {
  productId: string;
  productName: string;
  quantity: number;
  lineTotal: number;
};

export type NotificationPayload = {
  to: string;
  subject: string;
  body: string;
};

export type CacheEntry = {
  key: string;
  value: string;
  ttlSeconds: number;
};
