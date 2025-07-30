import { ProcessStatus, ProcessEntry, LogEntry } from '../shared/types.ts';

/**
 * Request interface for starting a new process via MCP tools
 */
export interface StartProcessRequest {
  script_name: string;
  title: string; // Required user-provided title for identification
  args?: string[];
  env_vars?: Record<string, string>;
  name?: string; // Optional display name
}

/**
 * Internal process configuration options for spawning processes
 */
export interface ProcessOptions {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // Timeout in milliseconds
}

/**
 * Valid process state transitions for state machine management
 */
export interface ProcessStateTransition {
  from: ProcessStatus;
  to: ProcessStatus;
  action: string;
}

/**
 * Process state transition rules - defines valid state changes
 */
export const VALID_STATE_TRANSITIONS: ProcessStateTransition[] = [
  { from: ProcessStatus.starting, to: ProcessStatus.running, action: 'spawn_success' },
  { from: ProcessStatus.starting, to: ProcessStatus.failed, action: 'spawn_failure' },
  { from: ProcessStatus.running, to: ProcessStatus.stopping, action: 'terminate_requested' },
  { from: ProcessStatus.running, to: ProcessStatus.failed, action: 'process_error' },
  { from: ProcessStatus.running, to: ProcessStatus.stopped, action: 'process_exit' },
  { from: ProcessStatus.stopping, to: ProcessStatus.stopped, action: 'terminate_success' },
  { from: ProcessStatus.stopping, to: ProcessStatus.failed, action: 'terminate_failure' },
];

/**
 * Process termination options
 */
export interface ProcessTerminationOptions {
  force?: boolean; // Use SIGKILL instead of SIGTERM
  timeout?: number; // Grace period before forcing termination
}

/**
 * Process monitoring configuration
 */
export interface ProcessMonitoringConfig {
  logBufferSize?: number; // Maximum number of log entries to keep in memory
  heartbeatInterval?: number; // Interval for process health checks in milliseconds
  maxRestarts?: number; // Maximum automatic restart attempts
}

/**
 * Process creation result returned by the process manager
 */
export interface ProcessCreationResult {
  success: boolean;
  processId?: string;
  process?: ProcessEntry;
  error?: string;
}

/**
 * Process query filters for listing and searching processes
 */
export interface ProcessQuery {
  status?: ProcessStatus;
  name?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'startTime' | 'name' | 'status';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Process statistics for monitoring and reporting
 */
export interface ProcessStats {
  totalProcesses: number;
  runningProcesses: number;
  failedProcesses: number;
  completedProcesses: number;
  averageRuntime: number; // In milliseconds
  memoryUsage?: number; // If available from system
}

/**
 * Process event types for internal event system
 */
export enum ProcessEventType {
  CREATED = 'created',
  STARTED = 'started',
  OUTPUT = 'output',
  ERROR = 'error',
  STATE_CHANGED = 'state_changed',
  TERMINATED = 'terminated',
  FAILED = 'failed'
}

/**
 * Process event data structure
 */
export interface ProcessEvent {
  type: ProcessEventType;
  processId: string;
  timestamp: Date;
  data?: unknown;
}

/**
 * Type guard to check if a state transition is valid
 */
export function isValidStateTransition(from: ProcessStatus, to: ProcessStatus): boolean {
  return VALID_STATE_TRANSITIONS.some(
    transition => transition.from === from && transition.to === to
  );
}

/**
 * Type guard to validate StartProcessRequest
 */
export function isValidStartProcessRequest(obj: unknown): obj is StartProcessRequest {
  if (!obj || typeof obj !== 'object') return false;
  
  const req = obj as Record<string, unknown>;
  
  // script_name is required and must be a string
  if (typeof req.script_name !== 'string' || req.script_name.length === 0) {
    return false;
  }
  
  // title is required and must be a string
  if (typeof req.title !== 'string' || req.title.length === 0) {
    return false;
  }
  
  // args is optional but must be string array if present
  if (req.args !== undefined && (!Array.isArray(req.args) || !req.args.every(arg => typeof arg === 'string'))) {
    return false;
  }
  
  // env_vars is optional but must be string record if present
  if (req.env_vars !== undefined && 
      (typeof req.env_vars !== 'object' || req.env_vars === null || Array.isArray(req.env_vars))) {
    return false;
  }
  
  // name is optional but must be string if present
  if (req.name !== undefined && typeof req.name !== 'string') {
    return false;
  }
  
  return true;
}

/**
 * Process events emitted by ProcessManager
 */
export interface ProcessEvents extends Record<string, unknown> {
  'process:started': { processId: string; process: ProcessEntry };
  'process:stopped': { processId: string; process: ProcessEntry };
  'process:failed': { processId: string; process: ProcessEntry; error: string };
  'process:state_changed': { processId: string; from: ProcessStatus; to: ProcessStatus };
  'process:log_added': { processId: string; log: LogEntry };
}