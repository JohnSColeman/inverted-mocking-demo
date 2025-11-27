#!/bin/bash

# ============================================================================
# LocalStack Monitoring Service Initialization
# ============================================================================
# This script initializes AWS CloudWatch and SNS for monitoring alerts
# ============================================================================

echo "Initializing Monitoring Service (CloudWatch + SNS)..."

# Wait for LocalStack to be ready
sleep 5

# Create SNS topic for alerts
aws --endpoint-url=http://localhost:4566 \
    --region=us-east-1 \
    sns create-topic \
    --name order-processing-alerts \
    || echo "SNS topic already exists"

# Subscribe an email endpoint to the SNS topic (for testing)
aws --endpoint-url=http://localhost:4566 \
    --region=us-east-1 \
    sns subscribe \
    --topic-arn arn:aws:sns:us-east-1:000000000000:order-processing-alerts \
    --protocol email \
    --notification-endpoint alerts@example.com \
    || echo "SNS subscription already exists"

# Create CloudWatch Log Group
aws --endpoint-url=http://localhost:4566 \
    --region=us-east-1 \
    logs create-log-group \
    --log-group-name /aws/order-processing/monitoring \
    || echo "CloudWatch log group already exists"

# Create CloudWatch metric alarm (example)
aws --endpoint-url=http://localhost:4566 \
    --region=us-east-1 \
    cloudwatch put-metric-alarm \
    --alarm-name order-processing-errors \
    --alarm-description "Alert when order processing errors occur" \
    --metric-name ErrorCount \
    --namespace OrderProcessing \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --threshold 5 \
    --comparison-operator GreaterThanThreshold \
    --alarm-actions arn:aws:sns:us-east-1:000000000000:order-processing-alerts \
    || echo "CloudWatch alarm already exists"

echo "✅ Monitoring Service initialized successfully!"
echo "   - SNS Topic: order-processing-alerts"
echo "   - CloudWatch Log Group: /aws/order-processing/monitoring"
echo "   - CloudWatch Alarm: order-processing-errors"
