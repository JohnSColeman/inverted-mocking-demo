// Module product types

import {Customer} from "../domain";

export type LineItem = {
    productId: string;
    productName: string;
    quantity: number;
    pricePerUnit: number;
    lineTotal: number;
};

export type InventoryUpdate = {
    productId: string;
    quantityChange: number;
};

export type AnalyticsEvent = {
    event: string;
    orderId: string;
    total: number;
    customerTier: Customer['tier'];
};

export type MissingProductAlert = {
    type: 'missing_product';
    productId: string;
    orderId: string;
};