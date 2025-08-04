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
  title: string;  // User-provided title for easy identification
  name: string;   // Process/command name
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

/**
 * Extended response format for MCP tool responses that includes web UI URLs
 */
export interface MCPResponseContent {
  [x: string]: unknown;
  type: 'text';
  text: string;
  _meta?: {
    [x: string]: unknown;
  } | undefined;
}

/**
 * MCP tool response with optional web UI URL
 */
export interface MCPToolResponse {
  [x: string]: unknown;
  content: MCPResponseContent[];
  webUrl?: string;
  _meta?: {
    [x: string]: unknown;
  } | undefined;
}