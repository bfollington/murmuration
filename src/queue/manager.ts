/**
 * Queue Manager for process queuing and priority-based execution
 */

import { EventEmitter } from "../shared/event-emitter.ts";
import {
  BatchOperation,
  BatchResult,
  createQueueEntry,
  DEFAULT_QUEUE_CONFIG,
  isValidQueuedProcess,
  QueueConfig,
  QueuedProcess,
  QueueEntry,
  QueueEvent,
  QueueEventType,
  queueComparator,
  QueuePriority,
  QueueStatistics,
  QueueStatus,
} from "./types.ts";

/**
 * Queue event map for type-safe event handling
 */
export interface QueueEventMap {
  entry_added: QueueEvent;
  entry_started: QueueEvent;
  entry_completed: QueueEvent;
  entry_failed: QueueEvent;
  entry_cancelled: QueueEvent;
  entry_retried: QueueEvent;
  batch_started: QueueEvent;
  batch_completed: QueueEvent;
  queue_full: QueueEvent;
  concurrency_limit_reached: QueueEvent;
  [key: string]: unknown;  // Index signature for EventEmitter constraint
}

/**
 * Queue Manager implementation with priority queue and concurrency control
 */
export class QueueManager extends EventEmitter<QueueEventMap> {
  private readonly config: QueueConfig;
  private readonly queue: QueueEntry[] = [];
  private readonly processing: Map<string, QueueEntry> = new Map();
  private readonly completed: Map<string, QueueEntry> = new Map();
  private readonly failed: Map<string, QueueEntry> = new Map();
  private readonly cancelled: Map<string, QueueEntry> = new Map();
  
  // Statistics tracking
  private totalProcessed = 0;
  private totalWaitTime = 0;
  private totalProcessingTime = 0;
  private lastThroughputUpdate = Date.now();
  private throughputCount = 0;
  
  constructor(config: Partial<QueueConfig> = {}) {
    super();
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }
  
  /**
   * Add a process to the queue
   */
  addToQueue(process: QueuedProcess): string {
    if (!isValidQueuedProcess(process)) {
      throw new Error("Invalid queued process");
    }
    
    if (this.queue.length >= this.config.maxQueueSize) {
      this.emitEvent('queue_full', {});
      throw new Error(`Queue is full (max size: ${this.config.maxQueueSize})`);
    }
    
    const entry = createQueueEntry(process, this.config);
    this.queue.push(entry);
    this.queue.sort(queueComparator);
    
    this.emitEvent('entry_added', { queueId: entry.id, entry });
    
    return entry.id;
  }
  
  /**
   * Add multiple processes as a batch
   */
  addBatch(processes: QueuedProcess[]): BatchResult {
    const batchId = crypto.randomUUID();
    const successful: string[] = [];
    const failed: Array<{id: string; error: string}> = [];
    
    for (const process of processes) {
      try {
        // Add batch ID to process
        const batchedProcess = { ...process, batchId };
        const id = this.addToQueue(batchedProcess);
        successful.push(id);
      } catch (error) {
        failed.push({ 
          id: process.title, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
    
    const result: BatchResult = {
      batchId,
      successful,
      failed,
      totalCount: processes.length,
      successCount: successful.length,
      failureCount: failed.length,
    };
    
    if (successful.length > 0) {
      this.emitEvent('batch_started', { batchId, metadata: result });
    }
    
    return result;
  }
  
  /**
   * Get the next process to run based on priority and concurrency limits
   */
  getNext(): QueueEntry | undefined {
    if (this.processing.size >= this.config.maxConcurrentProcesses) {
      this.emitEvent('concurrency_limit_reached', {
        metadata: { 
          current: this.processing.size, 
          limit: this.config.maxConcurrentProcesses 
        }
      });
      return undefined;
    }
    
    if (this.queue.length === 0) {
      return undefined;
    }
    
    // Queue is already sorted, take the first entry
    const entry = this.queue.shift()!;
    entry.status = QueueStatus.processing;
    entry.startedAt = new Date();
    
    this.processing.set(entry.id, entry);
    this.emitEvent('entry_started', { queueId: entry.id, entry });
    
    // Update wait time statistics
    const waitTime = entry.startedAt.getTime() - entry.queuedAt.getTime();
    this.totalWaitTime += waitTime;
    
    return entry;
  }
  
  /**
   * Mark an entry as completed
   */
  markCompleted(id: string, processId: string): void {
    const entry = this.processing.get(id);
    if (!entry) {
      throw new Error(`Queue entry ${id} not found in processing`);
    }
    
    entry.status = QueueStatus.completed;
    entry.completedAt = new Date();
    entry.processId = processId;
    
    this.processing.delete(id);
    this.completed.set(id, entry);
    
    // Update statistics
    const processingTime = entry.completedAt.getTime() - entry.startedAt!.getTime();
    this.totalProcessingTime += processingTime;
    this.totalProcessed++;
    this.throughputCount++;
    
    this.emitEvent('entry_completed', { queueId: id, processId, entry });
    
    // Check if this completes a batch
    if (entry.process.batchId) {
      this.checkBatchCompletion(entry.process.batchId);
    }
  }
  
  /**
   * Mark an entry as failed
   */
  markFailed(id: string, error: string): void {
    const entry = this.processing.get(id);
    if (!entry) {
      throw new Error(`Queue entry ${id} not found in processing`);
    }
    
    entry.error = error;
    
    if (this.config.retryFailedProcesses && entry.retryCount < entry.maxRetries) {
      // Return to queue for retry
      entry.status = QueueStatus.pending;
      entry.startedAt = undefined;
      entry.retryCount++; // Increment retry count after the check
      this.processing.delete(id);
      this.queue.push(entry);
      this.queue.sort(queueComparator);
      
      this.emitEvent('entry_retried', { 
        queueId: id, 
        entry,
        metadata: { retryCount: entry.retryCount, maxRetries: entry.maxRetries }
      });
    } else {
      // Max retries reached or retries disabled
      entry.status = QueueStatus.failed;
      entry.completedAt = new Date();
      entry.retryCount++; // Increment for consistency
      
      this.processing.delete(id);
      this.failed.set(id, entry);
      
      this.totalProcessed++;
      this.emitEvent('entry_failed', { queueId: id, entry, error });
      
      // Check if this affects a batch
      if (entry.process.batchId) {
        this.checkBatchCompletion(entry.process.batchId);
      }
    }
  }
  
  /**
   * Cancel a queued entry
   */
  cancel(id: string): boolean {
    // Check if in queue
    const queueIndex = this.queue.findIndex(e => e.id === id);
    if (queueIndex !== -1) {
      const entry = this.queue.splice(queueIndex, 1)[0];
      entry.status = QueueStatus.cancelled;
      entry.completedAt = new Date();
      this.cancelled.set(id, entry);
      
      this.emitEvent('entry_cancelled', { queueId: id, entry });
      return true;
    }
    
    // Check if processing
    const entry = this.processing.get(id);
    if (entry) {
      // Can't cancel while processing, must stop the process instead
      return false;
    }
    
    return false;
  }
  
  /**
   * Cancel multiple entries
   */
  cancelBatch(ids: string[]): BatchResult {
    const batchId = crypto.randomUUID();
    const successful: string[] = [];
    const failed: Array<{id: string; error: string}> = [];
    
    for (const id of ids) {
      if (this.cancel(id)) {
        successful.push(id);
      } else {
        failed.push({ id, error: "Entry not found or cannot be cancelled" });
      }
    }
    
    return {
      batchId,
      successful,
      failed,
      totalCount: ids.length,
      successCount: successful.length,
      failureCount: failed.length,
    };
  }
  
  /**
   * Get queue statistics
   */
  getStatistics(): QueueStatistics {
    // Calculate queue by priority
    const queuedByPriority = new Map<QueuePriority, number>();
    for (let i = 1; i <= 10; i++) {
      queuedByPriority.set(i as QueuePriority, 0);
    }
    
    for (const entry of this.queue) {
      const count = queuedByPriority.get(entry.priority) || 0;
      queuedByPriority.set(entry.priority, count + 1);
    }
    
    // Calculate throughput
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastThroughputUpdate;
    const throughput = timeSinceLastUpdate > 0 
      ? (this.throughputCount / timeSinceLastUpdate) * 60000 // per minute
      : 0;
    
    // Update throughput tracking
    if (timeSinceLastUpdate > 60000) { // Reset every minute
      this.lastThroughputUpdate = now;
      this.throughputCount = 0;
    }
    
    return {
      totalQueued: this.queue.length,
      queuedByPriority,
      processing: this.processing.size,
      completed: this.completed.size,
      failed: this.failed.size,
      cancelled: this.cancelled.size,
      averageWaitTime: this.totalProcessed > 0 ? this.totalWaitTime / this.totalProcessed : 0,
      averageProcessingTime: this.totalProcessed > 0 ? this.totalProcessingTime / this.totalProcessed : 0,
      throughput,
      lastUpdated: new Date(),
    };
  }
  
  /**
   * Get entry by ID
   */
  getEntry(id: string): QueueEntry | undefined {
    // Check all collections
    const inQueue = this.queue.find(e => e.id === id);
    if (inQueue) return inQueue;
    
    return (
      this.processing.get(id) ||
      this.completed.get(id) ||
      this.failed.get(id) ||
      this.cancelled.get(id)
    );
  }
  
  /**
   * Get all entries
   */
  getAllEntries(): QueueEntry[] {
    return [
      ...this.queue,
      ...Array.from(this.processing.values()),
      ...Array.from(this.completed.values()),
      ...Array.from(this.failed.values()),
      ...Array.from(this.cancelled.values()),
    ];
  }
  
  /**
   * Clear completed and failed entries
   */
  clearHistory(): void {
    this.completed.clear();
    this.failed.clear();
    this.cancelled.clear();
  }
  
  /**
   * Get current configuration
   */
  getConfig(): QueueConfig {
    return { ...this.config };
  }
  
  /**
   * Update configuration
   */
  updateConfig(updates: Partial<QueueConfig>): void {
    Object.assign(this.config, updates);
  }
  
  /**
   * Check if a batch is complete
   */
  private checkBatchCompletion(batchId: string): void {
    const batchEntries = this.getAllEntries().filter(e => e.process.batchId === batchId);
    const allComplete = batchEntries.every(e => 
      e.status === QueueStatus.completed || 
      e.status === QueueStatus.failed ||
      e.status === QueueStatus.cancelled
    );
    
    if (allComplete) {
      const result: BatchResult = {
        batchId,
        successful: batchEntries.filter(e => e.status === QueueStatus.completed).map(e => e.id),
        failed: batchEntries
          .filter(e => e.status === QueueStatus.failed)
          .map(e => ({ id: e.id, error: e.error || "Unknown error" })),
        totalCount: batchEntries.length,
        successCount: batchEntries.filter(e => e.status === QueueStatus.completed).length,
        failureCount: batchEntries.filter(e => e.status === QueueStatus.failed).length,
      };
      
      this.emitEvent('batch_completed', { batchId, metadata: result });
    }
  }
  
  /**
   * Emit a queue event
   */
  private emitEvent(type: QueueEventType, data: QueueEvent['data']): void {
    const event: QueueEvent = {
      type,
      timestamp: new Date(),
      data,
    };
    
    this.emit(type as keyof QueueEventMap, event);
  }
}