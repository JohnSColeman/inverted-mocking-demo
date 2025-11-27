#!/bin/bash

# ============================================================================
# LocalStack Analytics Service Initialization
# ============================================================================
# This script initializes AWS Kinesis and Firehose for analytics events
# ============================================================================

echo "Initializing Analytics Service (Kinesis + Firehose + S3)..."

# Wait for LocalStack to be ready
sleep 5

# Create S3 bucket for analytics data storage
aws --endpoint-url=http://localhost:4566 \
    --region=us-east-1 \
    s3 mb s3://order-analytics-data \
    || echo "S3 bucket already exists"

# Create Kinesis Data Stream for real-time analytics
aws --endpoint-url=http://localhost:4566 \
    --region=us-east-1 \
    kinesis create-stream \
    --stream-name order-analytics-stream \
    --shard-count 1 \
    || echo "Kinesis stream already exists"

# Wait for stream to be active
sleep 3

# Create Kinesis Firehose delivery stream
aws --endpoint-url=http://localhost:4566 \
    --region=us-east-1 \
    firehose create-delivery-stream \
    --delivery-stream-name order-analytics-firehose \
    --delivery-stream-type DirectPut \
    --s3-destination-configuration \
    "RoleARN=arn:aws:iam::000000000000:role/firehose-role,\
BucketARN=arn:aws:s3:::order-analytics-data,\
Prefix=analytics/,\
ErrorOutputPrefix=analytics-errors/,\
CompressionFormat=GZIP,\
BufferingHints={SizeInMBs=1,IntervalInSeconds=60}" \
    || echo "Firehose delivery stream already exists"

echo "✅ Analytics Service initialized successfully!"
echo "   - S3 Bucket: order-analytics-data"
echo "   - Kinesis Stream: order-analytics-stream"
echo "   - Firehose Stream: order-analytics-firehose"
