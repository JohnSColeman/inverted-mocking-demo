// Non domain types

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