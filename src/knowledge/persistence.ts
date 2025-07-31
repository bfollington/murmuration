import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { KnowledgeEntry, Question, Answer, Note, KnowledgeType } from './types.ts';
import { KnowledgeRegistry } from './registry.ts';

/**
 * Knowledge Persistence - File-based storage for knowledge entries
 * 
 * Provides persistence for the knowledge base using JSON files
 * in a dedicated directory with atomic writes and backup support.
 */
export class KnowledgePersistence {
  private readonly storageDir: string;
  private readonly dataFile: string;
  private readonly backupFile: string;
  private readonly lockFile: string;
  private isLocked = false;

  constructor(storageDir = '.knowledge') {
    this.storageDir = storageDir;
    this.dataFile = `${storageDir}/knowledge.json`;
    this.backupFile = `${storageDir}/knowledge.backup.json`;
    this.lockFile = `${storageDir}/.lock`;
  }

  /**
   * Initialize storage directory
   */
  async initialize(): Promise<void> {
    try {
      await ensureDir(this.storageDir);
    } catch (error) {
      throw new Error(`Failed to initialize storage directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Save knowledge entries to disk
   */
  async save(entries: KnowledgeEntry[]): Promise<void> {
    await this.initialize();
    
    // Acquire lock
    await this.acquireLock();
    
    try {
      // Create backup of existing data
      await this.createBackup();
      
      // Prepare data for serialization
      const data = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        entries: entries.map(entry => this.serializeEntry(entry))
      };
      
      // Write to temporary file first (atomic write)
      const tempFile = `${this.dataFile}.tmp`;
      const json = JSON.stringify(data, null, 2);
      
      await Deno.writeTextFile(tempFile, json);
      
      // Rename temp file to actual file (atomic operation)
      await Deno.rename(tempFile, this.dataFile);
      
    } finally {
      // Release lock
      await this.releaseLock();
    }
  }

  /**
   * Load knowledge entries from disk
   */
  async load(): Promise<KnowledgeEntry[]> {
    await this.initialize();
    
    try {
      const json = await Deno.readTextFile(this.dataFile);
      const data = JSON.parse(json);
      
      // Validate version
      if (data.version !== "1.0") {
        throw new Error(`Unsupported data version: ${data.version}`);
      }
      
      // Deserialize entries
      return data.entries.map((entry: any) => this.deserializeEntry(entry));
      
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // No data file exists yet
        return [];
      }
      
      // Try to load from backup
      try {
        // Silently try backup
        return await this.loadFromBackup();
      } catch (backupError) {
        // Both files failed
        throw new Error(`Failed to load knowledge data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Load registry from persistence
   */
  async loadIntoRegistry(registry: KnowledgeRegistry): Promise<void> {
    const entries = await this.load();
    
    // Clear existing data
    registry.clear();
    
    // Add all loaded entries
    for (const entry of entries) {
      registry.addEntry(entry);
      
      // Re-establish question-answer links
      if (entry.type === KnowledgeType.ANSWER) {
        const answer = entry as Answer;
        registry.linkAnswerToQuestion(answer.id, answer.questionId);
      }
    }
  }

  /**
   * Save registry to persistence
   */
  async saveFromRegistry(registry: KnowledgeRegistry): Promise<void> {
    const entries = registry.getAllEntries();
    await this.save(entries);
  }

  /**
   * Create backup of current data file
   */
  private async createBackup(): Promise<void> {
    try {
      await Deno.copyFile(this.dataFile, this.backupFile);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        // Backup failed, but continue with main save
      }
      // Continue even if backup fails
    }
  }

  /**
   * Load from backup file
   */
  private async loadFromBackup(): Promise<KnowledgeEntry[]> {
    const json = await Deno.readTextFile(this.backupFile);
    const data = JSON.parse(json);
    
    if (data.version !== "1.0") {
      throw new Error(`Unsupported backup version: ${data.version}`);
    }
    
    return data.entries.map((entry: any) => this.deserializeEntry(entry));
  }

  /**
   * Acquire file lock for atomic operations
   */
  private async acquireLock(maxRetries = 10, retryDelay = 100): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Try to create lock file exclusively
        await Deno.writeTextFile(this.lockFile, String(Deno.pid), { 
          createNew: true 
        });
        this.isLocked = true;
        return;
      } catch (error) {
        if (error instanceof Deno.errors.AlreadyExists) {
          // Lock file exists, wait and retry
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        throw error;
      }
    }
    
    throw new Error("Failed to acquire lock: timeout");
  }

  /**
   * Release file lock
   */
  private async releaseLock(): Promise<void> {
    if (this.isLocked) {
      try {
        await Deno.remove(this.lockFile);
        this.isLocked = false;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          // Failed to release lock, ignore
        }
      }
    }
  }

  /**
   * Serialize entry for storage
   */
  private serializeEntry(entry: KnowledgeEntry): any {
    const serialized: any = {
      ...entry,
      timestamp: entry.timestamp.toISOString(),
      lastUpdated: entry.lastUpdated.toISOString()
    };
    
    // Remove undefined values
    Object.keys(serialized).forEach(key => {
      if (serialized[key] === undefined) {
        delete serialized[key];
      }
    });
    
    return serialized;
  }

  /**
   * Deserialize entry from storage
   */
  private deserializeEntry(data: any): KnowledgeEntry {
    const base = {
      ...data,
      timestamp: new Date(data.timestamp),
      lastUpdated: new Date(data.lastUpdated)
    };
    
    // Ensure arrays are initialized
    base.tags = base.tags || [];
    base.metadata = base.metadata || {};
    
    // Type-specific deserialization
    switch (data.type) {
      case KnowledgeType.QUESTION:
        const question = base as Question;
        question.answerIds = question.answerIds || [];
        return question;
        
      case KnowledgeType.ANSWER:
        const answer = base as Answer;
        answer.votes = answer.votes || 0;
        return answer;
        
      case KnowledgeType.NOTE:
        const note = base as Note;
        note.relatedIds = note.relatedIds || [];
        return note;
        
      default:
        throw new Error(`Unknown knowledge type: ${data.type}`);
    }
  }

  /**
   * Export entries to a specific file
   */
  async exportToFile(filePath: string, entries: KnowledgeEntry[]): Promise<void> {
    const data = {
      version: "1.0",
      timestamp: new Date().toISOString(),
      entries: entries.map(entry => this.serializeEntry(entry))
    };
    
    const json = JSON.stringify(data, null, 2);
    await Deno.writeTextFile(filePath, json);
  }

  /**
   * Import entries from a specific file
   */
  async importFromFile(filePath: string): Promise<KnowledgeEntry[]> {
    const json = await Deno.readTextFile(filePath);
    const data = JSON.parse(json);
    
    if (data.version !== "1.0") {
      throw new Error(`Unsupported import version: ${data.version}`);
    }
    
    return data.entries.map((entry: any) => this.deserializeEntry(entry));
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<{
    dataFileSize?: number;
    backupFileSize?: number;
    lastModified?: Date;
  }> {
    const stats: any = {};
    
    try {
      const dataInfo = await Deno.stat(this.dataFile);
      stats.dataFileSize = dataInfo.size;
      stats.lastModified = dataInfo.mtime || undefined;
    } catch (error) {
      // File doesn't exist yet
    }
    
    try {
      const backupInfo = await Deno.stat(this.backupFile);
      stats.backupFileSize = backupInfo.size;
    } catch (error) {
      // Backup doesn't exist yet
    }
    
    return stats;
  }
}

// Export default instance for convenience
export const knowledgePersistence = new KnowledgePersistence();