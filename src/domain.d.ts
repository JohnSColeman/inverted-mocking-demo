// Domain types shared across the application

export type Order = {
  readonly id: string;
  readonly customerId: string;
  readonly items: OrderItem[];
  readonly createdAt: Date;
};

export type OrderItem = {
  readonly productId: string;
  readonly quantity: number;
  readonly pricePerUnit: number;
};

export type Customer = {
  readonly id: string;
  readonly email: string;
  readonly tier: 'standard' | 'premium' | 'vip';
  readonly totalPurchases: number;
};

export type Product = {
  readonly id: string;
  readonly name: string;
  readonly stock: number;
  readonly category: string;
};

export type DiscountRule = {
  readonly tier: Customer['tier'];
  readonly minPurchase: number;
  readonly discountPercent: number;
};

export type ProcessedOrder = {
  readonly orderId: string;
  readonly customerId: string;
  readonly subtotal: number;
  readonly discount: number;
  readonly total: number;
  readonly loyaltyPointsEarned: number;
  readonly itemsSummary: ItemSummary[];
};

export type ItemSummary = {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly lineTotal: number;
};

