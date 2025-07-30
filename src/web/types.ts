import { ProcessEntry, ProcessStatus, LogEntry } from '../shared/types.ts';
import { StartProcessRequest, ProcessQuery, ProcessTerminationOptions } from '../process/types.ts';

/**
 * WebSocket message types for bidirectional communication
 */

// ============================================================================
// Client to Server Messages
// ============================================================================

/**
 * Request to list all processes with optional filtering
 */
export interface ListProcessesMessage {
  type: 'list_processes';
  payload?: ProcessQuery;
}

/**
 * Request to start a new process
 */
export interface StartProcessMessage {
  type: 'start_process';
  payload: StartProcessRequest;
}

/**
 * Request to stop a running process
 */
export interface StopProcessMessage {
  type: 'stop_process';
  payload: {
    id: string;
    options?: ProcessTerminationOptions;
  };
}

/**
 * Request to get logs for a specific process
 */
export interface GetLogsMessage {
  type: 'get_logs';
  payload: {
    id: string;
    lines?: number;
    since?: Date;
  };
}

/**
 * Subscribe to real-time updates for a specific process
 */
export interface SubscribeMessage {
  type: 'subscribe';
  payload: {
    processId: string;
  };
}

/**
 * Unsubscribe from process updates
 */
export interface UnsubscribeMessage {
  type: 'unsubscribe';
  payload: {
    processId: string;
  };
}

/**
 * Subscribe to all process events
 */
export interface SubscribeAllMessage {
  type: 'subscribe_all';
}

/**
 * Unsubscribe from all process events
 */
export interface UnsubscribeAllMessage {
  type: 'unsubscribe_all';
}

/**
 * Union type for all client-to-server messages
 */
export type ClientMessage =
  | ListProcessesMessage
  | StartProcessMessage
  | StopProcessMessage
  | GetLogsMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | SubscribeAllMessage
  | UnsubscribeAllMessage;

// ============================================================================
// Server to Client Messages
// ============================================================================

/**
 * Response with list of processes
 */
export interface ProcessListMessage {
  type: 'process_list';
  payload: ProcessEntry[];
}

/**
 * Notification when a process is started
 */
export interface ProcessStartedMessage {
  type: 'process_started';
  payload: ProcessEntry;
}

/**
 * Notification when a process is updated (status change, new logs, etc.)
 */
export interface ProcessUpdatedMessage {
  type: 'process_updated';
  payload: ProcessEntry;
}

/**
 * Notification when a process ends (stopped or failed)
 */
export interface ProcessEndedMessage {
  type: 'process_ended';
  payload: ProcessEntry;
}

/**
 * Log update for a specific process
 */
export interface LogUpdateMessage {
  type: 'log_update';
  payload: {
    id: string;
    logs: LogEntry[];
  };
}

/**
 * Error message from server
 */
export interface ErrorMessage {
  type: 'error';
  payload: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

/**
 * Success confirmation for operations
 */
export interface SuccessMessage {
  type: 'success';
  payload: {
    message: string;
    operation?: string;
    data?: unknown;
  };
}

/**
 * Connection established confirmation
 */
export interface ConnectedMessage {
  type: 'connected';
  payload: {
    sessionId: string;
    serverVersion?: string;
  };
}

/**
 * Heartbeat/ping message for connection health
 */
export interface PingMessage {
  type: 'ping';
  payload: {
    timestamp: number;
  };
}

/**
 * Heartbeat/pong response
 */
export interface PongMessage {
  type: 'pong';
  payload: {
    timestamp: number;
  };
}

/**
 * Union type for all server-to-client messages
 */
export type ServerMessage =
  | ProcessListMessage
  | ProcessStartedMessage
  | ProcessUpdatedMessage
  | ProcessEndedMessage
  | LogUpdateMessage
  | ErrorMessage
  | SuccessMessage
  | ConnectedMessage
  | PingMessage
  | PongMessage;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a message is a valid ClientMessage
 */
export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (!msg || typeof msg !== 'object') return false;
  
  const message = msg as Record<string, unknown>;
  if (typeof message.type !== 'string') return false;
  
  switch (message.type) {
    case 'list_processes':
      return isListProcessesMessage(message);
    case 'start_process':
      return isStartProcessMessage(message);
    case 'stop_process':
      return isStopProcessMessage(message);
    case 'get_logs':
      return isGetLogsMessage(message);
    case 'subscribe':
      return isSubscribeMessage(message);
    case 'unsubscribe':
      return isUnsubscribeMessage(message);
    case 'subscribe_all':
      return true; // No payload required
    case 'unsubscribe_all':
      return true; // No payload required
    default:
      return false;
  }
}

/**
 * Type guard for ListProcessesMessage
 */
export function isListProcessesMessage(msg: unknown): msg is ListProcessesMessage {
  if (!msg || typeof msg !== 'object') return false;
  const message = msg as Record<string, unknown>;
  return message.type === 'list_processes';
  // payload is optional, so no further validation needed
}

/**
 * Type guard for StartProcessMessage
 */
export function isStartProcessMessage(msg: unknown): msg is StartProcessMessage {
  if (!msg || typeof msg !== 'object') return false;
  const message = msg as Record<string, unknown>;
  
  if (message.type !== 'start_process') return false;
  if (!message.payload || typeof message.payload !== 'object') return false;
  
  const payload = message.payload as Record<string, unknown>;
  
  // Inline validation instead of importing to keep it synchronous
  // script_name is required and must be a string
  if (typeof payload.script_name !== 'string' || payload.script_name.length === 0) {
    return false;
  }
  
  // title is required and must be a string
  if (typeof payload.title !== 'string' || payload.title.length === 0) {
    return false;
  }
  
  // args is optional but must be string array if present
  if (payload.args !== undefined && (!Array.isArray(payload.args) || !payload.args.every(arg => typeof arg === 'string'))) {
    return false;
  }
  
  // env_vars is optional but must be string record if present
  if (payload.env_vars !== undefined && 
      (typeof payload.env_vars !== 'object' || payload.env_vars === null || Array.isArray(payload.env_vars))) {
    return false;
  }
  
  // name is optional but must be string if present
  if (payload.name !== undefined && typeof payload.name !== 'string') {
    return false;
  }
  
  return true;
}

/**
 * Type guard for StopProcessMessage
 */
export function isStopProcessMessage(msg: unknown): msg is StopProcessMessage {
  if (!msg || typeof msg !== 'object') return false;
  const message = msg as Record<string, unknown>;
  
  if (message.type !== 'stop_process') return false;
  if (!message.payload || typeof message.payload !== 'object') return false;
  
  const payload = message.payload as Record<string, unknown>;
  if (typeof payload.id !== 'string' || payload.id.length === 0) return false;
  
  // options is optional
  if (payload.options !== undefined) {
    if (typeof payload.options !== 'object' || payload.options === null) return false;
    const options = payload.options as Record<string, unknown>;
    if (options.force !== undefined && typeof options.force !== 'boolean') return false;
    if (options.timeout !== undefined && typeof options.timeout !== 'number') return false;
  }
  
  return true;
}

/**
 * Type guard for GetLogsMessage
 */
export function isGetLogsMessage(msg: unknown): msg is GetLogsMessage {
  if (!msg || typeof msg !== 'object') return false;
  const message = msg as Record<string, unknown>;
  
  if (message.type !== 'get_logs') return false;
  if (!message.payload || typeof message.payload !== 'object') return false;
  
  const payload = message.payload as Record<string, unknown>;
  if (typeof payload.id !== 'string' || payload.id.length === 0) return false;
  
  // lines and since are optional
  if (payload.lines !== undefined && typeof payload.lines !== 'number') return false;
  if (payload.since !== undefined && !(payload.since instanceof Date)) return false;
  
  return true;
}

/**
 * Type guard for SubscribeMessage
 */
export function isSubscribeMessage(msg: unknown): msg is SubscribeMessage {
  if (!msg || typeof msg !== 'object') return false;
  const message = msg as Record<string, unknown>;
  
  if (message.type !== 'subscribe') return false;
  if (!message.payload || typeof message.payload !== 'object') return false;
  
  const payload = message.payload as Record<string, unknown>;
  return typeof payload.processId === 'string' && payload.processId.length > 0;
}

/**
 * Type guard for UnsubscribeMessage
 */
export function isUnsubscribeMessage(msg: unknown): msg is UnsubscribeMessage {
  if (!msg || typeof msg !== 'object') return false;
  const message = msg as Record<string, unknown>;
  
  if (message.type !== 'unsubscribe') return false;
  if (!message.payload || typeof message.payload !== 'object') return false;
  
  const payload = message.payload as Record<string, unknown>;
  return typeof payload.processId === 'string' && payload.processId.length > 0;
}

// ============================================================================
// WebSocket Connection State
// ============================================================================

/**
 * WebSocket connection states
 */
export enum WebSocketState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

/**
 * WebSocket connection configuration
 */
export interface WebSocketConfig {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  messageTimeout?: number;
}

/**
 * WebSocket client subscription state
 */
export interface ClientSubscriptions {
  processIds: Set<string>;
  allProcesses: boolean;
}

// ============================================================================
// Connection Management
// ============================================================================

/**
 * Represents a single WebSocket connection with its metadata and subscriptions
 */
export interface WebSocketConnection {
  /** Unique session identifier for this connection */
  sessionId: string;
  
  /** The actual WebSocket instance */
  socket: WebSocket;
  
  /** Current connection state */
  state: WebSocketState;
  
  /** When the connection was established */
  connectedAt: Date;
  
  /** Last activity timestamp (message sent or received) */
  lastActivity: Date;
  
  /** Client subscription state */
  subscriptions: ClientSubscriptions;
  
  /** Optional client metadata (e.g., user agent, IP address) */
  metadata?: Record<string, unknown>;
}

/**
 * Event emitted when a connection state changes
 */
export interface ConnectionEvent {
  type: 'connected' | 'disconnected' | 'error' | 'subscribed' | 'unsubscribed';
  sessionId: string;
  timestamp: Date;
  details?: unknown;
}

/**
 * Options for sending messages
 */
export interface SendOptions {
  /** Skip subscription filtering and force send */
  force?: boolean;
  
  /** Timeout for send operation in milliseconds */
  timeout?: number;
  
  /** Whether to wait for acknowledgment */
  requireAck?: boolean;
}

/**
 * Filter criteria for selecting connections
 */
export interface ConnectionFilter {
  /** Filter by subscription to specific process IDs */
  processIds?: string[];
  
  /** Only connections subscribed to all processes */
  subscribedToAll?: boolean;
  
  /** Filter by connection state */
  states?: WebSocketState[];
  
  /** Filter by session IDs */
  sessionIds?: string[];
  
  /** Connections inactive for more than this duration (ms) */
  inactiveSince?: number;
}

/**
 * Statistics about current connections
 */
export interface ConnectionStats {
  total: number;
  connected: number;
  disconnected: number;
  error: number;
  subscribedToAll: number;
  averageSubscriptionsPerConnection: number;
  oldestConnection?: Date;
  newestConnection?: Date;
}

/**
 * Manages WebSocket connections, subscriptions, and message routing
 */
export interface ConnectionManager {
  /**
   * Add a new WebSocket connection
   * @param socket The WebSocket instance to manage
   * @param metadata Optional metadata about the connection
   * @returns The session ID assigned to this connection
   */
  addConnection(socket: WebSocket, metadata?: Record<string, unknown>): string;
  
  /**
   * Remove a connection by session ID
   * @param sessionId The session ID of the connection to remove
   * @returns True if the connection was found and removed
   */
  removeConnection(sessionId: string): boolean;
  
  /**
   * Get a specific connection by session ID
   * @param sessionId The session ID to look up
   * @returns The connection if found, undefined otherwise
   */
  getConnection(sessionId: string): WebSocketConnection | undefined;
  
  /**
   * Get all connections matching the filter criteria
   * @param filter Optional filter criteria
   * @returns Array of matching connections
   */
  getConnections(filter?: ConnectionFilter): WebSocketConnection[];
  
  /**
   * Send a message to a specific connection
   * @param sessionId The target session ID
   * @param message The message to send
   * @param options Optional send options
   * @returns Promise resolving to true if sent successfully
   */
  sendToConnection(sessionId: string, message: ServerMessage, options?: SendOptions): Promise<boolean>;
  
  /**
   * Broadcast a message to all connections matching the filter
   * @param message The message to broadcast
   * @param filter Optional filter to limit recipients
   * @returns Promise resolving to number of successful sends
   */
  broadcast(message: ServerMessage, filter?: ConnectionFilter): Promise<number>;
  
  /**
   * Broadcast a message to connections subscribed to a specific process
   * @param processId The process ID to target
   * @param message The message to send
   * @returns Promise resolving to number of successful sends
   */
  broadcastToProcess(processId: string, message: ServerMessage): Promise<number>;
  
  /**
   * Update subscriptions for a connection
   * @param sessionId The session ID to update
   * @param action The subscription action
   * @param processId Optional process ID for subscribe/unsubscribe
   * @returns True if the subscription was updated
   */
  updateSubscription(
    sessionId: string, 
    action: 'subscribe' | 'unsubscribe' | 'subscribe_all' | 'unsubscribe_all',
    processId?: string
  ): boolean;
  
  /**
   * Get subscription state for a connection
   * @param sessionId The session ID to query
   * @returns The subscription state if connection exists
   */
  getSubscriptions(sessionId: string): ClientSubscriptions | undefined;
  
  /**
   * Check if a connection is subscribed to a process
   * @param sessionId The session ID to check
   * @param processId The process ID to check
   * @returns True if subscribed (directly or via subscribe_all)
   */
  isSubscribedToProcess(sessionId: string, processId: string): boolean;
  
  /**
   * Update the last activity timestamp for a connection
   * @param sessionId The session ID to update
   */
  updateActivity(sessionId: string): void;
  
  /**
   * Clean up inactive or errored connections
   * @param maxInactiveMs Maximum inactivity duration in milliseconds
   * @returns Number of connections cleaned up
   */
  cleanupInactive(maxInactiveMs: number): number;
  
  /**
   * Get statistics about current connections
   * @returns Connection statistics
   */
  getStats(): ConnectionStats;
  
  /**
   * Close all connections gracefully
   * @param code Optional close code
   * @param reason Optional close reason
   * @returns Promise resolving when all connections are closed
   */
  closeAll(code?: number, reason?: string): Promise<void>;
  
  /**
   * Register a callback for connection events
   * @param callback The callback to invoke on events
   * @returns Cleanup function to unregister the callback
   */
  onConnectionEvent(callback: (event: ConnectionEvent) => void): () => void;
}

/**
 * Factory function to create a ConnectionManager instance
 */
export interface ConnectionManagerFactory {
  (): ConnectionManager;
}

/**
 * Generic WebSocket message structure
 */
export interface WebSocketMessage {
  type: string;
  data?: unknown;
}

/**
 * WebSocket error structure
 */
export interface WebSocketError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Type guard for WebSocket messages
 */
export function isWebSocketMessage(value: unknown): value is WebSocketMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const msg = value as Record<string, unknown>;
  return typeof msg.type === 'string';
}