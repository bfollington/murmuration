/**
 * Integrated Queue Manager that combines queue functionality with process management
 */

import { ProcessManager } from "../process/manager.ts";
import { ProcessRegistry } from "../process/registry.ts";
import { StartProcessRequest, ProcessCreationResult } from "../process/types.ts";
import { EventEmitter } from "../shared/event-emitter.ts";
import { logger } from "../shared/logger.ts";
import {
  QueueConfig,
  QueuedProcess,
  QueueEntry,
  QueueEvent,
  QueueStatistics,
  QueueStatus,
  DEFAULT_QUEUE_CONFIG,
  BatchResult,
  isValidQueuedProcess,
} from "./types.ts";
import { QueueManager, QueueEventMap } from "./manager.ts";
import { QueuePersistence } from "./persistence.ts";

/**
 * Extended queue configuration with process management options
 */
export interface IntegratedQueueConfig extends QueueConfig {
  processRegistry?: ProcessRegistry;
  autoStart: boolean;  // Whether to automatically start processing queue
  persistInterval: number;  // How often to persist queue state (ms)
  restoreOnStartup: boolean;  // Whether to restore queue from disk on startup
}

/**
 * Default integrated queue configuration
 */
export const DEFAULT_INTEGRATED_CONFIG: IntegratedQueueConfig = {
  ...DEFAULT_QUEUE_CONFIG,
  autoStart: true,
  persistInterval: 30000, // 30 seconds
  restoreOnStartup: true,
};

/**
 * Integrated event map combining queue and process events
 */
export interface IntegratedEventMap extends QueueEventMap {
  process_started: { queueId: string; processId: string };
  process_failed: { queueId: string; error: string };
  queue_restored: { count: number };
  queue_persisted: { count: number };
  [key: string]: unknown;  // Index signature for EventEmitter constraint
}

/**
 * Integrated Queue Manager
 */
export class IntegratedQueueManager extends EventEmitter<IntegratedEventMap> {
  private readonly config: IntegratedQueueConfig;
  private readonly queueManager: QueueManager;
  private readonly processManager: ProcessManager;
  private readonly persistence?: QueuePersistence;
  private processingTimer?: number;
  private persistTimer?: number;
  private isProcessing = false;
  
  constructor(
    processManager: ProcessManager,
    config: Partial<IntegratedQueueConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_INTEGRATED_CONFIG, ...config };
    this.processManager = processManager;
    this.queueManager = new QueueManager(this.config);
    
    if (this.config.persistQueue && this.config.persistPath) {
      this.persistence = new QueuePersistence(this.config.persistPath);
    }
    
    // Forward queue events
    this.setupEventForwarding();
    
    // Initialize
    this.initialize();
  }
  
  /**
   * Initialize the integrated manager
   */
  private async initialize(): Promise<void> {
    // Restore queue if configured
    if (this.config.restoreOnStartup && this.persistence) {
      await this.restoreQueue();
    }
    
    // Start processing if configured
    if (this.config.autoStart) {
      this.startProcessing();
    }
    
    // Start persistence timer if configured
    if (this.config.persistQueue && this.config.persistInterval > 0) {
      this.startPersistenceTimer();
    }
  }
  
  /**
   * Add a process to the queue
   */
  addToQueue(process: QueuedProcess): string {
    const id = this.queueManager.addToQueue(process);
    this.triggerProcessing();
    return id;
  }
  
  /**
   * Add multiple processes as a batch
   */
  addBatch(processes: QueuedProcess[]): BatchResult {
    const result = this.queueManager.addBatch(processes);
    this.triggerProcessing();
    return result;
  }
  
  /**
   * Start a process immediately (bypass queue)
   */
  async startProcessImmediately(request: StartProcessRequest): Promise<ProcessCreationResult> {
    return await this.processManager.spawnProcess(request);
  }
  
  /**
   * Start processing the queue
   */
  startProcessing(): void {
    if (!this.processingTimer) {
      this.processingTimer = setInterval(() => {
        this.processQueue();
      }, 1000); // Check every second
      
      // Process immediately
      this.processQueue();
    }
  }
  
  /**
   * Stop processing the queue
   */
  stopProcessing(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = undefined;
    }
  }
  
  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    try {
      // Get next entries up to concurrency limit
      let entry: QueueEntry | undefined;
      
      while ((entry = this.queueManager.getNext()) !== undefined) {
        // Don't await - process entries concurrently
        this.processEntry(entry).catch(error => {
          logger.error("IntegratedQueueManager", `Error processing entry ${entry!.id}:`, error);
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Process a single queue entry
   */
  private async processEntry(entry: QueueEntry): Promise<void> {
    try {
      // Convert QueuedProcess to StartProcessRequest
      const request: StartProcessRequest = {
        script_name: entry.process.script_name,
        title: entry.process.title,
        args: entry.process.args,
        env_vars: entry.process.env_vars,
        name: entry.process.name,
      };
      
      // Start the process
      const result = await this.processManager.spawnProcess(request);
      
      if (result.success && result.processId) {
        this.queueManager.markCompleted(entry.id, result.processId);
        this.emit('process_started', { queueId: entry.id, processId: result.processId });
      } else {
        const error = result.error || "Unknown error";
        this.queueManager.markFailed(entry.id, error);
        this.emit('process_failed', { queueId: entry.id, error });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.queueManager.markFailed(entry.id, errorMessage);
      this.emit('process_failed', { queueId: entry.id, error: errorMessage });
    }
  }
  
  /**
   * Cancel a queued entry
   */
  cancel(id: string): boolean {
    return this.queueManager.cancel(id);
  }
  
  /**
   * Cancel multiple entries
   */
  cancelBatch(ids: string[]): BatchResult {
    return this.queueManager.cancelBatch(ids);
  }
  
  /**
   * Get queue statistics
   */
  getStatistics(): QueueStatistics {
    return this.queueManager.getStatistics();
  }
  
  /**
   * Get a specific queue entry
   */
  getQueueEntry(id: string): QueueEntry | undefined {
    return this.queueManager.getEntry(id);
  }
  
  /**
   * Get all queue entries
   */
  getAllQueueEntries(): QueueEntry[] {
    return this.queueManager.getAllEntries();
  }
  
  /**
   * Clear queue history
   */
  clearHistory(): void {
    this.queueManager.clearHistory();
  }
  
  /**
   * Persist queue to disk
   */
  async persistQueue(): Promise<void> {
    if (!this.persistence) return;
    
    try {
      const entries = this.queueManager.getAllEntries();
      await this.persistence.save(entries);
      
      const count = entries.length;
      this.emit('queue_persisted', { count });
      logger.debug("IntegratedQueueManager", `Persisted ${count} queue entries`);
    } catch (error) {
      logger.error("IntegratedQueueManager", "Failed to persist queue:", error);
    }
  }
  
  /**
   * Restore queue from disk
   */
  private async restoreQueue(): Promise<void> {
    if (!this.persistence) return;
    
    try {
      const entries = await this.persistence.load();
      
      // Re-add entries to queue
      let restored = 0;
      for (const entry of entries) {
        // Only restore pending and processing entries
        if (entry.status === QueueStatus.pending || entry.status === QueueStatus.processing) {
          // Reset processing entries to pending
          if (entry.status === QueueStatus.processing) {
            entry.status = QueueStatus.pending;
            entry.startedAt = undefined;
          }
          
          try {
            this.queueManager.addToQueue(entry.process);
            restored++;
          } catch (error) {
            logger.warn("IntegratedQueueManager", `Failed to restore entry ${entry.id}:`, error);
          }
        }
      }
      
      this.emit('queue_restored', { count: restored });
      logger.info("IntegratedQueueManager", `Restored ${restored} queue entries`);
    } catch (error) {
      logger.error("IntegratedQueueManager", "Failed to restore queue:", error);
    }
  }
  
  /**
   * Trigger immediate processing
   */
  private triggerProcessing(): void {
    if (this.config.autoStart) {
      // Process queue on next tick
      Promise.resolve().then(() => this.processQueue());
    }
  }
  
  /**
   * Setup event forwarding from queue manager
   */
  private setupEventForwarding(): void {
    const eventTypes: (keyof QueueEventMap)[] = [
      'entry_added',
      'entry_started',
      'entry_completed',
      'entry_failed',
      'entry_cancelled',
      'entry_retried',
      'batch_started',
      'batch_completed',
      'queue_full',
      'concurrency_limit_reached',
    ];
    
    for (const eventType of eventTypes) {
      this.queueManager.on(eventType, (event) => {
        this.emit(eventType, event);
      });
    }
  }
  
  /**
   * Start persistence timer
   */
  private startPersistenceTimer(): void {
    if (!this.persistTimer && this.config.persistInterval > 0) {
      this.persistTimer = setInterval(() => {
        this.persistQueue().catch(error => {
          logger.error("IntegratedQueueManager", "Persistence timer error:", error);
        });
      }, this.config.persistInterval);
      
      // Persist immediately
      this.persistQueue();
    }
  }
  
  /**
   * Stop persistence timer
   */
  private stopPersistenceTimer(): void {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = undefined;
    }
  }
  
  /**
   * Shutdown the integrated manager
   */
  async shutdown(): Promise<void> {
    // Stop timers
    this.stopProcessing();
    this.stopPersistenceTimer();
    
    // Final persist
    if (this.persistence) {
      await this.persistQueue();
    }
    
    // Clear event listeners
    this.removeAllListeners();
  }
}