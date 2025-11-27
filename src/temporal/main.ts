/**
 * WORKER STARTUP SCRIPT
 * 
 * This script starts:
 * 1. A Temporal worker that executes order processing workflows
 * 2. An HTTP API server to trigger order processing
 * 
 * Run this with: npm run worker
 */
import {makeAppEffects} from '../effects/EffectsFactory';
import {runWorker} from './worker';
import {getOrderProcessingStatus, processOrderAsync} from './client';
import express from 'express';

async function main() {
  console.log('🚀 Starting Temporal worker and API server...\n');
  
  try {
    const appEffects = await makeAppEffects();
    
    console.log('📋 Configuration:');
    console.log('   - Temporal Server:', process.env.TEMPORAL_ADDRESS || 'localhost:7233');
    console.log('   - Namespace:', process.env.TEMPORAL_NAMESPACE || 'default');
    console.log('   - Task Queue: order-processing');
    console.log('   - Workflows: processOrderWorkflow');
    console.log('');

    // Start the Express API server
    await startApiServer();

    // Start the worker (runs indefinitely)
    await runWorker(appEffects);
    
  } catch (error) {
    console.error('❌ Failed to start worker:', error);
    process.exit(1);
  }
}

/**
 * Start the Express API server
 * 
 * This provides HTTP endpoints to:
 * - Trigger order processing asynchronously
 * - Check order processing status
 */
async function startApiServer(): Promise<void> {
  const app = express();
  const port = process.env.API_PORT || 3000;
  
  // Parse JSON bodies
  app.use(express.json());
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'order-processing-worker' });
  });
  
  /**
   * POST /api/orders/:orderId/process
   * 
   * Triggers order processing asynchronously
   * Returns immediately with workflow ID
   */
  app.post('/api/orders/:orderId/process', async (req, res) => {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ 
        error: 'Missing orderId parameter',
      });
    }
    
    try {
      console.log(`📨 Received request to process order: ${orderId}`);
      
      // Start the workflow asynchronously
      const result = await processOrderAsync(orderId);
      
      console.log(`✅ Order processing started for ${orderId} (workflow: ${result.workflowId})`);
      
      res.status(202).json({
        message: 'Order processing started',
        orderId,
        workflowId: result.workflowId,
        runId: result.runId,
        statusUrl: `/api/orders/${orderId}/status`,
      });
    } catch (error: any) {
      console.error(`❌ Failed to start order processing for ${orderId}:`, error);
      
      // Check if it's a duplicate execution error
      if (error.message?.includes('already started')) {
        return res.status(409).json({
          error: 'Order is already being processed',
          orderId,
          statusUrl: `/api/orders/${orderId}/status`,
        });
      }
      
      res.status(500).json({ 
        error: 'Failed to start order processing',
        details: error.message,
      });
    }
  });
  
  /**
   * GET /api/orders/:orderId/status
   * 
   * Checks the status of an order processing workflow
   */
  app.get('/api/orders/:orderId/status', async (req, res) => {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({ 
        error: 'Missing orderId parameter',
      });
    }
    
    try {
      const status = await getOrderProcessingStatus(orderId);
      
      res.json({
        orderId,
        ...status,
      });
    } catch (error: any) {
      console.error(`❌ Failed to get status for ${orderId}:`, error);
      res.status(500).json({ 
        error: 'Failed to get order status',
        details: error.message,
      });
    }
  });
  
  // Start the server
  return new Promise((resolve) => {
    app.listen(port, () => {
      console.log(`🌐 API server started on port ${port}`);
      console.log(`   - Process order: POST http://localhost:${port}/api/orders/:orderId/process`);
      console.log(`   - Check status: GET http://localhost:${port}/api/orders/:orderId/status`);
      console.log(`   - Health check: GET http://localhost:${port}/health`);
      console.log('');
      resolve();
    });
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏸️  Received SIGINT, shutting down gracefully...');
  console.log('   (In-progress workflows will complete)');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n⏸️  Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Start the worker
main().catch((error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});
