/**
 * PRODUCTION EFFECTS IMPLEMENTATION
 * 
 * This file contains the real implementations that connect to actual services:
 * - PostgreSQL for orders, customers, and products
 * - WireMock API for pricing service
 * - Redis for cache
 * - MailHog SMTP for email notifications
 * - LocalStack CloudWatch/SNS for monitoring
 * - LocalStack Kinesis for analytics
 */
import {Customer, DiscountRule, Order, OrderItem, Product,} from '../domain';
import {CacheEntry, NotificationPayload} from "../types";
import {AnalyticsEvent, InventoryUpdate, MissingProductAlert} from '../pure/types';
import {
  AnalyticsService,
  AppEffects,
  CacheService,
  CustomerRepository,
  MonitoringService,
  NotificationService,
  OrderRepository,
  PricingService,
  ProductRepository,
} from '../pure/effects';
import {Pool} from 'pg';
import {createClient} from 'redis';
import nodemailer, {Transporter} from 'nodemailer';
import axios, {AxiosInstance} from 'axios';
import {CloudWatchClient, PutMetricDataCommand} from '@aws-sdk/client-cloudwatch';
import {PublishCommand, SNSClient} from '@aws-sdk/client-sns';
import {KinesisClient, PutRecordCommand} from '@aws-sdk/client-kinesis';

// ============================================================================
// Configuration
// ============================================================================

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface RedisConfig {
  host: string;
  port: number;
}

interface PricingConfig {
  baseUrl: string;
}

interface EmailConfig {
  host: string;
  port: number;
}

interface AwsConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  monitoringEndpoint: string;
  analyticsEndpoint: string;
}

export interface ProductionConfig {
  database: DatabaseConfig;
  redis: RedisConfig;
  pricing: PricingConfig;
  email: EmailConfig;
  aws: AwsConfig;
}

// Load configuration from environment variables
export function loadConfigFromEnv(): ProductionConfig {
  return {
    database: {
      host: process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      user: process.env.DATABASE_USER || 'appuser',
      password: process.env.DATABASE_PASSWORD || 'apppassword',
      database: process.env.DATABASE_NAME || 'orderdb',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    },
    pricing: {
      baseUrl: process.env.PRICING_API_URL || 'http://localhost:8081',
    },
    email: {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '1025', 10),
    },
    aws: {
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
      monitoringEndpoint: process.env.AWS_ENDPOINT_MONITORING || 'http://localhost:4566',
      analyticsEndpoint: process.env.AWS_ENDPOINT_ANALYTICS || 'http://localhost:4567',
    },
  };
}

// ============================================================================
// PostgreSQL Order Repository
// ============================================================================

class PostgresOrderRepository implements OrderRepository {
  constructor(private pool: Pool) {}

  async getById(id: string): Promise<Order | null> {
    const client = await this.pool.connect();
    try {
      // Get order
      const orderResult = await client.query(
        'SELECT id, customer_id, created_at FROM orders WHERE id = $1',
        [id]
      );

      if (orderResult.rows.length === 0) {
        return null;
      }

      const orderRow = orderResult.rows[0];

      // Get order items
      const itemsResult = await client.query(
        'SELECT product_id, quantity, price_per_unit FROM order_items WHERE order_id = $1',
        [id]
      );

      const items: OrderItem[] = itemsResult.rows.map((row) => ({
        productId: row.product_id,
        quantity: row.quantity,
        pricePerUnit: parseFloat(row.price_per_unit),
      }));

      return {
        id: orderRow.id,
        customerId: orderRow.customer_id,
        items,
        createdAt: orderRow.created_at,
      };
    } finally {
      client.release();
    }
  }
}

// ============================================================================
// PostgreSQL Customer Repository
// ============================================================================

class PostgresCustomerRepository implements CustomerRepository {
  constructor(private pool: Pool) {}

  async getById(id: string): Promise<Customer | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT id, email, tier, total_purchases FROM customers WHERE id = $1',
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        email: row.email,
        tier: row.tier as 'standard' | 'premium' | 'vip',
        totalPurchases: parseFloat(row.total_purchases),
      };
    } finally {
      client.release();
    }
  }

  async updateTotalPurchases(customerId: string, amount: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        'UPDATE customers SET total_purchases = total_purchases + $1 WHERE id = $2',
        [amount, customerId]
      );
    } finally {
      client.release();
    }
  }
}

// ============================================================================
// PostgreSQL Product Repository
// ============================================================================

class PostgresProductRepository implements ProductRepository {
  constructor(private pool: Pool) {}

  async getByIds(ids: string[]): Promise<Record<string, Product>> {
    if (ids.length === 0) {
      return {};
    }

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT id, name, stock, category FROM products WHERE id = ANY($1)',
        [ids]
      );

      const products: Record<string, Product> = {};
      for (const row of result.rows) {
        products[row.id] = {
          id: row.id,
          name: row.name,
          stock: row.stock,
          category: row.category,
        };
      }

      return products;
    } finally {
      client.release();
    }
  }

  async updateInventory(updates: InventoryUpdate[]): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const update of updates) {
        await client.query(
          'UPDATE products SET stock = stock + $1 WHERE id = $2',
          [update.quantityChange, update.productId]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

// ============================================================================
// Axios Pricing Service
// ============================================================================

class AxiosPricingService implements PricingService {
  private client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 5000,
    });
  }

  async getDiscountRules(): Promise<DiscountRule[]> {
    try {
      const response = await this.client.get('/api/discount-rules');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch discount rules:', error);
      throw new Error('Pricing service unavailable');
    }
  }
}

// ============================================================================
// Redis Cache Service
// ============================================================================

class RedisCacheService implements CacheService {
  constructor(private client: ReturnType<typeof createClient>) {}

  async set(entry: CacheEntry): Promise<void> {
    try {
      await this.client.setEx(entry.key, entry.ttlSeconds, entry.value);
    } catch (error) {
      console.error('Failed to set cache entry:', error);
      throw new Error('Cache service unavailable');
    }
  }
}

// ============================================================================
// Nodemailer Notification Service
// ============================================================================

class NodemailerNotificationService implements NotificationService {
  private transporter: Transporter;

  constructor(config: EmailConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: false, // MailHog doesn't use TLS
      ignoreTLS: true,
    });
  }

  async sendEmail(payload: NotificationPayload): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: '"Order Processing System" <noreply@example.com>',
        to: payload.to,
        subject: payload.subject,
        text: payload.body,
        html: `<p>${payload.body.replace(/\n/g, '<br>')}</p>`,
      });
      console.log(`Email sent to ${payload.to}: ${payload.subject}`);
    } catch (error) {
      console.error('Failed to send email:', error);
      throw new Error('Email service unavailable');
    }
  }
}

// ============================================================================
// CloudWatch Monitoring Service (CloudWatch + SNS)
// ============================================================================

class CloudWatchMonitoringService implements MonitoringService {
  private cloudwatch: CloudWatchClient;
  private sns: SNSClient;
  private snsTopicArn: string;

  constructor(config: AwsConfig) {
    this.cloudwatch = new CloudWatchClient({
      region: config.region,
      endpoint: config.monitoringEndpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    this.sns = new SNSClient({
      region: config.region,
      endpoint: config.monitoringEndpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    // SNS topic ARN (created by init script)
    this.snsTopicArn = `arn:aws:sns:${config.region}:000000000000:order-processing-alerts`;
  }

  async sendAlerts(alerts: MissingProductAlert[]): Promise<void> {
    if (alerts.length === 0) {
      return;
    }

    try {
      // Send metric to CloudWatch
      const metricCommand = new PutMetricDataCommand({
        Namespace: 'OrderProcessing',
        MetricData: [
          {
            MetricName: 'MissingProducts',
            Value: alerts.length,
            Unit: 'Count',
            Timestamp: new Date(),
          },
        ],
      });
      await this.cloudwatch.send(metricCommand);

      // Send alert via SNS
      const message = alerts
        .map((alert) => `Missing product: ${alert.productId} (order: ${alert.orderId})`)
        .join('\n');

      const snsCommand = new PublishCommand({
        TopicArn: this.snsTopicArn,
        Subject: 'Order Processing Alert: Missing Products',
        Message: `The following products are missing or out of stock:\n\n${message}`,
      });
      await this.sns.send(snsCommand);

      console.log(`Sent ${alerts.length} missing product alerts to monitoring service`);
    } catch (error) {
      console.error('Failed to send monitoring alerts:', error);
      throw new Error('Monitoring service unavailable');
    }
  }
}

// ============================================================================
// Kinesis Analytics Service (Kinesis)
// ============================================================================

class KinesisAnalyticsService implements AnalyticsService {
  private kinesis: KinesisClient;
  private streamName: string;

  constructor(config: AwsConfig) {
    this.kinesis = new KinesisClient({
      region: config.region,
      endpoint: config.analyticsEndpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    this.streamName = 'order-analytics-stream';
  }

  async trackEvent(event: AnalyticsEvent): Promise<void> {
    try {
      const command = new PutRecordCommand({
        StreamName: this.streamName,
        PartitionKey: event.orderId,
        Data: Buffer.from(JSON.stringify({
          ...event,
          timestamp: new Date().toISOString(),
        })),
      });

      await this.kinesis.send(command);
      console.log(`Tracked analytics event for order: ${event.orderId}`);
    } catch (error) {
      console.error('Failed to track analytics event:', error);
      throw new Error('Analytics service unavailable');
    }
  }
}

// ============================================================================
// Production EffectsFactory
// ============================================================================

class EffectsFactory implements AppEffects {
  private _pool?: Pool;
  private _redisClient?: ReturnType<typeof createClient>;
  private _orderRepository?: OrderRepository;
  private _customerRepository?: CustomerRepository;
  private _productRepository?: ProductRepository;
  private _pricingService?: PricingService;
  private _cacheService?: CacheService;
  private _notificationService?: NotificationService;
  private _monitoringService?: MonitoringService;
  private _analyticsService?: AnalyticsService;

  constructor(private config: ProductionConfig) {}

  private async getPool(): Promise<Pool> {
    if (!this._pool) {
      this._pool = new Pool({
        host: this.config.database.host,
        port: this.config.database.port,
        user: this.config.database.user,
        password: this.config.database.password,
        database: this.config.database.database,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Test database connection
      try {
        const client = await this._pool.connect();
        console.log('✅ Connected to PostgreSQL');
        client.release();
      } catch (error) {
        console.error('❌ Failed to connect to PostgreSQL:', error);
        throw error;
      }
    }
    return this._pool;
  }

  private async getRedisClient(): Promise<ReturnType<typeof createClient>> {
    if (!this._redisClient) {
      this._redisClient = createClient({
        socket: {
          host: this.config.redis.host,
          port: this.config.redis.port,
        },
      });

      this._redisClient.on('error', (err) => console.error('Redis Client Error:', err));

      await this._redisClient.connect();
      console.log('✅ Connected to Redis');
    }
    return this._redisClient;
  }

  get orders(): OrderRepository {
    if (!this._orderRepository) {
      // Synchronous access requires pool to be already initialized
      if (!this._pool) {
        throw new Error('Database pool not initialized. Call initialize() first.');
      }
      this._orderRepository = new PostgresOrderRepository(this._pool);
    }
    return this._orderRepository;
  }

  get customers(): CustomerRepository {
    if (!this._customerRepository) {
      if (!this._pool) {
        throw new Error('Database pool not initialized. Call initialize() first.');
      }
      this._customerRepository = new PostgresCustomerRepository(this._pool);
    }
    return this._customerRepository;
  }

  get products(): ProductRepository {
    if (!this._productRepository) {
      if (!this._pool) {
        throw new Error('Database pool not initialized. Call initialize() first.');
      }
      this._productRepository = new PostgresProductRepository(this._pool);
    }
    return this._productRepository;
  }

  get pricing(): PricingService {
    if (!this._pricingService) {
      this._pricingService = new AxiosPricingService(this.config.pricing.baseUrl);
    }
    return this._pricingService;
  }

  get cache(): CacheService {
    if (!this._cacheService) {
      if (!this._redisClient) {
        throw new Error('Redis client not initialized. Call initialize() first.');
      }
      this._cacheService = new RedisCacheService(this._redisClient);
    }
    return this._cacheService;
  }

  get notifications(): NotificationService {
    if (!this._notificationService) {
      this._notificationService = new NodemailerNotificationService(this.config.email);
    }
    return this._notificationService;
  }

  get monitoring(): MonitoringService {
    if (!this._monitoringService) {
      this._monitoringService = new CloudWatchMonitoringService(this.config.aws);
    }
    return this._monitoringService;
  }

  get analytics(): AnalyticsService {
    if (!this._analyticsService) {
      this._analyticsService = new KinesisAnalyticsService(this.config.aws);
    }
    return this._analyticsService;
  }

  /**
   * Initialize all connections (PostgreSQL, Redis)
   * Must be called before using the effects
   */
  async initialize(): Promise<void> {
    await this.getPool();
    await this.getRedisClient();
    console.log('✅ All production effects initialized');
  }

  /**
   * Static factory method to create and initialize production effects
   */
  static async make(config?: ProductionConfig): Promise<AppEffects> {
    const cfg = config || loadConfigFromEnv();
    const effects = new EffectsFactory(cfg);
    await effects.initialize();
    return effects;
  }
}

// Export a factory function
export async function makeAppEffects(config?: ProductionConfig): Promise<AppEffects> {
  return EffectsFactory.make(config);
}
