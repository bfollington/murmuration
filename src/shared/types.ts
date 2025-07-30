/**
 * Process status enumeration
 */
export enum ProcessStatus {
  starting = 'starting',
  running = 'running',
  stopping = 'stopping',
  stopped = 'stopped',
  failed = 'failed'
}

/**
 * Log entry interface for capturing process output and system messages
 */
export interface LogEntry {
  timestamp: Date;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
}

/**
 * Process entry interface representing a managed process
 */
export interface ProcessEntry {
  id: string;
  name: string;
  command: string[];
  status: ProcessStatus;
  startTime: Date;
  endTime?: Date;
  pid?: number;
  child?: Deno.ChildProcess;
  logs: LogEntry[];
  metadata: Record<string, unknown>;
  exitCode?: number;
  exitSignal?: string;
}