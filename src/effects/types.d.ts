// ============================================================================
// Configuration
// ============================================================================

export type DatabaseConfig = {
    readonly host: string;
    readonly port: number;
    readonly user: string;
    readonly password: string;
    readonly database: string;
}

export type RedisConfig = {
    readonly host: string;
    readonly port: number;
}

export type PricingConfig = {
    readonly baseUrl: string;
}

export type EmailConfig = {
    readonly host: string;
    readonly port: number;
}

export type AwsConfig = {
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly monitoringEndpoint: string;
    readonly analyticsEndpoint: string;
}

export type ProductionConfig = {
    readonly database: DatabaseConfig;
    readonly redis: RedisConfig;
    readonly pricing: PricingConfig;
    readonly email: EmailConfig;
    readonly aws: AwsConfig;
}