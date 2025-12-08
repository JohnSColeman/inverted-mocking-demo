// Non domain types

export type NotificationPayload = {
    readonly to: string;
    readonly subject: string;
    readonly body: string;
};

export type CacheEntry = {
    readonly key: string;
    readonly value: string;
    readonly ttlSeconds: number;
};