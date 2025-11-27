/**
 * TEMPORAL CLIENT
 * 
 * The client is used to start workflows from your application code.
 * Unlike the worker (which executes workflows), the client just
 * sends workflow execution requests to Temporal.
 * 
 * Think of it like:
 * - Client = HTTP request sender
 * - Worker = HTTP server
 * - Temporal server = Load balancer/coordinator
 */

import {Client, Connection} from '@temporalio/client';
import {Either} from 'purify-ts';
import {ProcessedOrder} from '../domain';
import {processOrderWorkflow} from './processOrder.workflow';

let client: Client | null = null;

/**
 * Get or create a Temporal client
 * 
 * The client is lightweight and can be reused across requests
 */
export async function getTemporalClient(): Promise<Client> {
  if (!client) {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    
    client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    });
  }
  
  return client;
}

/**
 * Start a durable order processing workflow
 * 
 * This function starts the workflow and can be called from:
 * - HTTP API endpoints
 * - Message queue consumers
 * - Scheduled jobs
 * - Anywhere in your application
 * 
 * @param orderId - The order ID to process
 * @param options - Workflow execution options
 * @returns WorkflowHandle that can be used to query/signal the workflow
 */
export async function startOrderProcessing(
  orderId: string,
  options?: {
    // Optional: Custom workflow ID (defaults to order-{orderId})
    workflowId?: string;
    
    // Optional: Workflow timeout in milliseconds (defaults to no timeout)
    workflowExecutionTimeoutMs?: number;
    
    // Optional: Task queue (defaults to 'order-processing')
    taskQueue?: string;
  }
) {
  const temporalClient = await getTemporalClient();
  
  // Start the workflow
  return await temporalClient.workflow.start(processOrderWorkflow, {
    // Unique ID for this workflow execution
    // Using orderId ensures we don't process the same order twice
    workflowId: options?.workflowId || `order-${orderId}`,

    // Task queue where workers will pick this up
    taskQueue: options?.taskQueue || 'order-processing',

    // Workflow arguments
    args: [orderId],

    // Optional: Set a timeout for the entire workflow
    workflowExecutionTimeout: options?.workflowExecutionTimeoutMs,
  });
}

/**
 * Start order processing and wait for result
 * 
 * Use this when you need the result immediately (e.g., in a synchronous API)
 * 
 * @param orderId - The order ID to process
 * @returns Either with validation error message (Left) or processed order (Right)
 */
export async function processOrderSync(orderId: string): Promise<Either<unknown, ProcessedOrder>> {
  const handle = await startOrderProcessing(orderId);
  
  // Wait for the workflow to complete and return the result
  return await handle.result();
}

/**
 * Start order processing asynchronously
 * 
 * Use this when you don't need to wait for the result (e.g., queue consumers)
 * The workflow will run in the background and complete eventually
 * 
 * @param orderId - The order ID to process
 * @returns Workflow handle (can be used to query status later)
 */
export async function processOrderAsync(orderId: string) {
  const handle = await startOrderProcessing(orderId);
  
  // Return immediately without waiting
  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId,
  };
}

/**
 * Check the status of an order processing workflow
 * 
 * @param orderId - The order ID
 * @returns Workflow status and result (if complete)
 */
export async function getOrderProcessingStatus(orderId: string): Promise<{
  status: 'running' | 'completed' | 'failed' | 'not_found';
  result?: Either<string, ProcessedOrder>;
  error?: string;
}> {
  const temporalClient = await getTemporalClient();
  
  try {
    const handle = temporalClient.workflow.getHandle(`order-${orderId}`);
    
    // Describe gives us the current status without waiting
    const description = await handle.describe();
    
    if (description.status.name === 'COMPLETED') {
      const result = await handle.result();
      return { status: 'completed', result };
    } else if (description.status.name === 'FAILED') {
      return { 
        status: 'failed', 
        error: 'Workflow failed - check Temporal UI for details',
      };
    } else {
      return { status: 'running' };
    }
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      return { status: 'not_found' };
    }
    throw error;
  }
}

/**
 * Cancel an order processing workflow
 * 
 * This can be used if the customer cancels their order while processing
 * 
 * @param orderId - The order ID
 */
export async function cancelOrderProcessing(orderId: string): Promise<void> {
  const temporalClient = await getTemporalClient();
  const handle = temporalClient.workflow.getHandle(`order-${orderId}`);
  
  await handle.cancel();
}

/**
 * Durability Benefits Summary
 * 
 * Using Temporal client to start workflows gives you:
 * 
 * 1. **Deduplication**: Using orderId as workflowId prevents duplicate processing
 *    - If you call startOrderProcessing('order-123') twice, second call fails
 *    - No need for manual deduplication logic
 * 
 * 2. **Async by Default**: Start a workflow and return immediately
 *    - Client doesn't need to wait for processing to complete
 *    - Scales better than synchronous processing
 * 
 * 3. **Built-in Status Tracking**: Query workflow status anytime
 *    - No need to maintain separate "job status" table
 *    - Full execution history in Temporal UI
 * 
 * 4. **Fault Tolerance**: Client crashes don't affect workflows
 *    - Once workflow is started, it runs to completion
 *    - Workers handle execution, not the client
 * 
 * 5. **Cancellation Support**: Cancel running workflows gracefully
 *    - Useful for order cancellations, timeouts, etc.
 *    - Workflow code can handle cancellation events
 */
