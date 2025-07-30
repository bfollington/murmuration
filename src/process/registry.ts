import { ProcessEntry, ProcessStatus } from '../shared/types.ts';

/**
 * ProcessRegistry - Core data layer for process management
 * 
 * Provides a Map-based store for ProcessEntry objects with CRUD operations
 * and utility methods for process management. Thread-safe for async operations.
 */
export class ProcessRegistry {
  private readonly processes: Map<string, ProcessEntry> = new Map();

  /**
   * Deep copy a ProcessEntry to prevent mutations
   * @param process - The ProcessEntry to copy
   * @returns A deep copy of the ProcessEntry
   */
  private deepCopyProcess(process: ProcessEntry): ProcessEntry {
    return {
      ...process,
      logs: process.logs.map(log => ({ ...log, timestamp: new Date(log.timestamp) })),
      command: [...process.command],
      metadata: { ...process.metadata },
      startTime: new Date(process.startTime),
      endTime: process.endTime ? new Date(process.endTime) : undefined,
    };
  }

  /**
   * Add a new process to the registry
   * @param process - The ProcessEntry to add
   * @throws Error if process ID already exists
   */
  addProcess(process: ProcessEntry): void {
    if (this.processes.has(process.id)) {
      throw new Error(`Process with ID ${process.id} already exists`);
    }
    this.processes.set(process.id, this.deepCopyProcess(process));
  }

  /**
   * Retrieve a process by ID
   * @param id - The process ID to look up
   * @returns ProcessEntry if found, undefined otherwise
   */
  getProcess(id: string): ProcessEntry | undefined {
    const process = this.processes.get(id);
    return process ? this.deepCopyProcess(process) : undefined;
  }

  /**
   * Get all processes in the registry
   * @returns Array of all ProcessEntry objects
   */
  getAllProcesses(): ProcessEntry[] {
    return Array.from(this.processes.values()).map(process => this.deepCopyProcess(process));
  }

  /**
   * Update a process with partial data
   * @param id - The process ID to update
   * @param updates - Partial ProcessEntry with fields to update
   * @returns true if update succeeded, false if process not found
   */
  updateProcess(id: string, updates: Partial<ProcessEntry>): boolean {
    const existing = this.processes.get(id);
    if (!existing) {
      return false;
    }

    // Create updated process entry, preserving existing data
    const updated: ProcessEntry = {
      ...existing,
      ...updates,
      // Preserve ID to prevent accidental overwrites
      id: existing.id,
      // Deep copy arrays to prevent mutations
      logs: updates.logs ? [...updates.logs] : existing.logs,
      command: updates.command ? [...updates.command] : existing.command,
      // Shallow copy metadata to prevent mutations
      metadata: updates.metadata ? { ...updates.metadata } : existing.metadata,
    };

    this.processes.set(id, updated);
    return true;
  }

  /**
   * Remove a process from the registry
   * @param id - The process ID to remove
   * @returns true if removal succeeded, false if process not found
   */
  removeProcess(id: string): boolean {
    return this.processes.delete(id);
  }

  /**
   * Get all processes matching a specific status
   * @param status - The ProcessStatus to filter by
   * @returns Array of ProcessEntry objects with matching status
   */
  getProcessesByStatus(status: ProcessStatus): ProcessEntry[] {
    return Array.from(this.processes.values())
      .filter(process => process.status === status)
      .map(process => this.deepCopyProcess(process));
  }

  /**
   * Get the total number of processes in the registry
   * @returns Number of processes
   */
  getProcessCount(): number {
    return this.processes.size;
  }

  /**
   * Check if a process exists in the registry
   * @param id - The process ID to check
   * @returns true if process exists, false otherwise
   */
  hasProcess(id: string): boolean {
    return this.processes.has(id);
  }

  /**
   * Generate a new unique process ID using crypto.randomUUID
   * @returns A new UUID string
   */
  static generateProcessId(): string {
    return crypto.randomUUID();
  }

  /**
   * Clear all processes from the registry (primarily for testing)
   */
  clear(): void {
    this.processes.clear();
  }

  /**
   * Get process IDs matching a specific status
   * @param status - The ProcessStatus to filter by
   * @returns Array of process IDs with matching status
   */
  getProcessIdsByStatus(status: ProcessStatus): string[] {
    return Array.from(this.processes.entries())
      .filter(([_, process]) => process.status === status)
      .map(([id, _]) => id);
  }
}

/**
 * Default singleton instance of ProcessRegistry for convenience
 * Can be used directly or extended with custom instances
 */
export const processRegistry = new ProcessRegistry();

/**
 * Export default instance for ease of use
 */
export default processRegistry;