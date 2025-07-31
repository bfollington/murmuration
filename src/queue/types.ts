/**
 * Queue types for process queuing and batching functionality
 */

import { ProcessEntry } from "../shared/types.ts";

/**
 * Queue entry status enumeration
 */
export enum QueueStatus {
  pending = 'pending',
  processing = 'processing',
  completed = 'completed',
  failed = 'failed',
  cancelled = 'cancelled'
}

/**
 * Priority levels for queue entries (1-10, where 10 is highest priority)
 */
export type QueuePriority = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Queued process request with all necessary information to start a process
 */
export interface QueuedProcess {
  script_name: string;
  title: string;
  args?: string[];
  env_vars?: Record<string, string>;
  name?: string;
  priority: QueuePriority;
  batchId?: string;  // For grouping related processes
  metadata?: Record<string, unknown>;
}

/**
 * Queue entry representing a queued process
 */
export interface QueueEntry {
  id: string;
  process: QueuedProcess;
  status: QueueStatus;
  priority: QueuePriority;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  processId?: string;  // ID of the spawned ProcessEntry
  error?: string;
  retryCount: number;
  maxRetries: number;
}

/**
 * Queue configuration options
 */
export interface QueueConfig {
  maxConcurrentProcesses: number;  // Maximum processes running simultaneously
  defaultPriority: QueuePriority;  // Default priority for new entries
  maxQueueSize: number;            // Maximum number of queued entries
  persistQueue: boolean;           // Whether to persist queue to disk
  persistPath?: string;            // Path for queue persistence
  retryFailedProcesses: boolean;   // Whether to retry failed processes
  defaultMaxRetries: number;       // Default max retries for failed processes
  batchProcessingEnabled: boolean; // Whether to enable batch processing
  maxBatchSize: number;           // Maximum size for batch operations
}

/**
 * Default queue configuration
 */
export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxConcurrentProcesses: 5,
  defaultPriority: 5,
  maxQueueSize: 1000,
  persistQueue: true,
  persistPath: "./queue-state.json",
  retryFailedProcesses: true,
  defaultMaxRetries: 3,
  batchProcessingEnabled: true,
  maxBatchSize: 10
};

/**
 * Queue statistics for monitoring
 */
export interface QueueStatistics {
  totalQueued: number;
  queuedByPriority: Map<QueuePriority, number>;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  averageWaitTime: number;  // milliseconds
  averageProcessingTime: number;  // milliseconds
  throughput: number;  // processes per minute
  lastUpdated: Date;
}

/**
 * Batch operation request
 */
export interface BatchOperation {
  id: string;
  type: 'start' | 'stop' | 'cancel';
  processIds?: string[];  // For stop operations
  queueIds?: string[];    // For cancel operations
  processes?: QueuedProcess[];  // For start operations
  metadata?: Record<string, unknown>;
}

/**
 * Batch operation result
 */
export interface BatchResult {
  batchId: string;
  successful: string[];  // IDs of successful operations
  failed: Array<{id: string; error: string}>;
  totalCount: number;
  successCount: number;
  failureCount: number;
  [key: string]: unknown;  // Index signature for Record<string, unknown> compatibility
}

/**
 * Queue event types for monitoring and integration
 */
export type QueueEventType = 
  | 'entry_added'
  | 'entry_started'
  | 'entry_completed'
  | 'entry_failed'
  | 'entry_cancelled'
  | 'entry_retried'
  | 'batch_started'
  | 'batch_completed'
  | 'queue_full'
  | 'concurrency_limit_reached';

/**
 * Queue event payload
 */
export interface QueueEvent {
  type: QueueEventType;
  timestamp: Date;
  data: {
    queueId?: string;
    processId?: string;
    batchId?: string;
    entry?: QueueEntry;
    statistics?: QueueStatistics;
    error?: string;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Type guard for QueuePriority
 */
export function isValidQueuePriority(priority: number): priority is QueuePriority {
  return priority >= 1 && priority <= 10 && Number.isInteger(priority);
}

/**
 * Type guard for QueuedProcess
 */
export function isValidQueuedProcess(obj: unknown): obj is QueuedProcess {
  if (typeof obj !== 'object' || obj === null) return false;
  
  const process = obj as Record<string, unknown>;
  
  return (
    typeof process.script_name === 'string' &&
    typeof process.title === 'string' &&
    isValidQueuePriority(process.priority as number) &&
    (process.args === undefined || Array.isArray(process.args)) &&
    (process.env_vars === undefined || typeof process.env_vars === 'object') &&
    (process.name === undefined || typeof process.name === 'string') &&
    (process.batchId === undefined || typeof process.batchId === 'string') &&
    (process.metadata === undefined || typeof process.metadata === 'object')
  );
}

/**
 * Helper to create a queue entry
 */
export function createQueueEntry(
  process: QueuedProcess,
  config: QueueConfig = DEFAULT_QUEUE_CONFIG
): QueueEntry {
  return {
    id: crypto.randomUUID(),
    process,
    status: QueueStatus.pending,
    priority: process.priority,
    queuedAt: new Date(),
    retryCount: 0,
    maxRetries: config.defaultMaxRetries
  };
}

/**
 * Queue sorting comparator (higher priority first, then FIFO)
 */
export function queueComparator(a: QueueEntry, b: QueueEntry): number {
  // First sort by priority (descending)
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }
  // Then by queue time (ascending - FIFO)
  return a.queuedAt.getTime() - b.queuedAt.getTime();
}