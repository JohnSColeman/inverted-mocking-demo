// Module product types

import {Customer} from "../domain";

export type LineItem = {
    readonly productId: string;
    readonly productName: string;
    readonly quantity: number;
    readonly pricePerUnit: number;
    readonly lineTotal: number;
};

export type InventoryUpdate = {
    readonly productId: string;
    readonly quantityChange: number;
};

export type AnalyticsEvent = {
    readonly event: string;
    readonly orderId: string;
    readonly total: number;
    readonly customerTier: Customer['tier'];
};

export type MissingProductAlert = {
    readonly type: 'missing_product';
    readonly productId: string;
    readonly orderId: string;
};