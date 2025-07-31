/**
 * Queue persistence module for saving and restoring queue state
 */

import { QueueEntry, QueueStatus } from "./types.ts";

/**
 * Serializable queue state
 */
export interface QueueState {
  version: string;
  timestamp: Date;
  entries: SerializedQueueEntry[];
}

/**
 * Serializable queue entry (without non-serializable fields)
 */
export interface SerializedQueueEntry {
  id: string;
  process: {
    script_name: string;
    title: string;
    args?: string[];
    env_vars?: Record<string, string>;
    name?: string;
    priority: number;
    batchId?: string;
    metadata?: Record<string, unknown>;
  };
  status: QueueStatus;
  priority: number;
  queuedAt: string; // ISO date string
  startedAt?: string;
  completedAt?: string;
  processId?: string;
  error?: string;
  retryCount: number;
  maxRetries: number;
}

/**
 * Queue persistence class for saving and loading queue state
 */
export class QueuePersistence {
  private static readonly VERSION = "1.0.0";
  
  constructor(private readonly filePath: string) {}
  
  /**
   * Save queue state to disk
   */
  async save(entries: QueueEntry[]): Promise<void> {
    try {
      const state: QueueState = {
        version: QueuePersistence.VERSION,
        timestamp: new Date(),
        entries: entries.map(this.serializeEntry),
      };
      
      const json = JSON.stringify(state, null, 2);
      await Deno.writeTextFile(this.filePath, json);
    } catch (error) {
      throw new Error(`Failed to save queue state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Load queue state from disk
   */
  async load(): Promise<QueueEntry[]> {
    try {
      const json = await Deno.readTextFile(this.filePath);
      const state = JSON.parse(json) as QueueState;
      
      // Validate version
      if (state.version !== QueuePersistence.VERSION) {
        // Version mismatch, but continue
      }
      
      return state.entries.map(this.deserializeEntry);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // File doesn't exist, return empty array
        return [];
      }
      throw new Error(`Failed to load queue state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Check if persistence file exists
   */
  async exists(): Promise<boolean> {
    try {
      await Deno.stat(this.filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Delete persistence file
   */
  async delete(): Promise<void> {
    try {
      await Deno.remove(this.filePath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw new Error(`Failed to delete queue state: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  /**
   * Validate queue state integrity
   */
  async validate(): Promise<boolean> {
    try {
      const entries = await this.load();
      
      // Check for basic integrity
      for (const entry of entries) {
        if (!entry.id || !entry.process || !entry.status) {
          return false;
        }
      }
      
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Serialize a queue entry
   */
  private serializeEntry(entry: QueueEntry): SerializedQueueEntry {
    return {
      id: entry.id,
      process: {
        script_name: entry.process.script_name,
        title: entry.process.title,
        args: entry.process.args,
        env_vars: entry.process.env_vars,
        name: entry.process.name,
        priority: entry.process.priority,
        batchId: entry.process.batchId,
        metadata: entry.process.metadata,
      },
      status: entry.status,
      priority: entry.priority,
      queuedAt: entry.queuedAt.toISOString(),
      startedAt: entry.startedAt?.toISOString(),
      completedAt: entry.completedAt?.toISOString(),
      processId: entry.processId,
      error: entry.error,
      retryCount: entry.retryCount,
      maxRetries: entry.maxRetries,
    };
  }
  
  /**
   * Deserialize a queue entry
   */
  private deserializeEntry(serialized: SerializedQueueEntry): QueueEntry {
    return {
      id: serialized.id,
      process: {
        script_name: serialized.process.script_name,
        title: serialized.process.title,
        args: serialized.process.args,
        env_vars: serialized.process.env_vars,
        name: serialized.process.name,
        priority: serialized.process.priority as any, // Trust the serialized data
        batchId: serialized.process.batchId,
        metadata: serialized.process.metadata,
      },
      status: serialized.status,
      priority: serialized.priority as any, // Trust the serialized data
      queuedAt: new Date(serialized.queuedAt),
      startedAt: serialized.startedAt ? new Date(serialized.startedAt) : undefined,
      completedAt: serialized.completedAt ? new Date(serialized.completedAt) : undefined,
      processId: serialized.processId,
      error: serialized.error,
      retryCount: serialized.retryCount,
      maxRetries: serialized.maxRetries,
    };
  }
  
  /**
   * Create a backup of the current state
   */
  async backup(): Promise<string> {
    const backupPath = `${this.filePath}.backup-${Date.now()}`;
    
    try {
      if (await this.exists()) {
        await Deno.copyFile(this.filePath, backupPath);
        return backupPath;
      }
      return "";
    } catch (error) {
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Restore from a backup
   */
  async restore(backupPath: string): Promise<void> {
    try {
      await Deno.copyFile(backupPath, this.filePath);
    } catch (error) {
      throw new Error(`Failed to restore from backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}