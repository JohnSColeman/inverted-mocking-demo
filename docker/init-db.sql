-- ============================================================================
-- Database Initialization Script
-- ============================================================================
-- This script creates the tables for orders, customers, and products
-- It will be automatically executed when the PostgreSQL container starts
-- ============================================================================

-- Create customers table
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    tier VARCHAR(50) NOT NULL CHECK (tier IN ('standard', 'premium', 'vip')),
    total_purchases DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create products table
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0,
    category VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(255) PRIMARY KEY,
    customer_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Create order_items table (to handle the items array in orders)
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id VARCHAR(255) NOT NULL,
    product_id VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL,
    price_per_unit DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ============================================================================
-- Sample Data for Testing
-- ============================================================================

-- Insert sample customers
INSERT INTO customers (id, email, tier, total_purchases) VALUES
    ('cust-001', 'john.doe@example.com', 'standard', 0.00),
    ('cust-002', 'jane.smith@example.com', 'premium', 0.00),
    ('cust-003', 'bob.johnson@example.com', 'vip', 0.00),
    ('cust-004', 'alice.williams@example.com', 'standard', 0.00),
    ('cust-005', 'charlie.brown@example.com', 'premium', 0.00)
ON CONFLICT (id) DO NOTHING;

-- Insert sample products
INSERT INTO products (id, name, stock, category) VALUES
    ('prod-001', 'Laptop Pro 15"', 50, 'electronics'),
    ('prod-002', 'Wireless Mouse', 200, 'electronics'),
    ('prod-003', 'Mechanical Keyboard', 150, 'electronics'),
    ('prod-004', 'USB-C Cable', 500, 'accessories'),
    ('prod-005', 'Monitor 27"', 75, 'electronics'),
    ('prod-006', 'Desk Lamp', 120, 'furniture'),
    ('prod-007', 'Office Chair', 30, 'furniture'),
    ('prod-008', 'Webcam HD', 100, 'electronics'),
    ('prod-009', 'Headphones', 180, 'electronics'),
    ('prod-010', 'Desk Mat', 250, 'accessories')
ON CONFLICT (id) DO NOTHING;

-- Insert sample orders
INSERT INTO orders (id, customer_id, created_at) VALUES
    ('order-001', 'cust-001', CURRENT_TIMESTAMP - INTERVAL '5 days'),
    ('order-002', 'cust-002', CURRENT_TIMESTAMP - INTERVAL '3 days'),
    ('order-003', 'cust-003', CURRENT_TIMESTAMP - INTERVAL '1 day'),
    ('order-004', 'cust-001', CURRENT_TIMESTAMP - INTERVAL '2 hours')
ON CONFLICT (id) DO NOTHING;

-- Insert sample order items
INSERT INTO order_items (order_id, product_id, quantity, price_per_unit) VALUES
    -- Order 1
    ('order-001', 'prod-002', 2, 29.99),
    ('order-001', 'prod-004', 3, 12.99),
    
    -- Order 2
    ('order-002', 'prod-001', 1, 1299.99),
    ('order-002', 'prod-003', 1, 89.99),
    ('order-002', 'prod-004', 2, 12.99),
    
    -- Order 3
    ('order-003', 'prod-005', 2, 399.99),
    ('order-003', 'prod-007', 1, 249.99),
    ('order-003', 'prod-009', 2, 79.99),
    
    -- Order 4
    ('order-004', 'prod-006', 1, 45.99),
    ('order-004', 'prod-010', 1, 24.99)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Utility Functions
-- ============================================================================

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to automatically update updated_at
CREATE TRIGGER update_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Verification
-- ============================================================================

-- Display table counts for verification
DO $$
BEGIN
    RAISE NOTICE 'Database initialization complete!';
    RAISE NOTICE 'Customers: %', (SELECT COUNT(*) FROM customers);
    RAISE NOTICE 'Products: %', (SELECT COUNT(*) FROM products);
    RAISE NOTICE 'Orders: %', (SELECT COUNT(*) FROM orders);
    RAISE NOTICE 'Order Items: %', (SELECT COUNT(*) FROM order_items);
END $$;
