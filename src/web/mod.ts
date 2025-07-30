/**
 * Web module - WebSocket server for process management
 * 
 * This module provides real-time process monitoring and control
 * through WebSocket connections.
 */

export { WebSocketServer, type WebSocketServerConfig } from './server.ts';
export { ProcessWebSocketHandlers } from './handlers.ts';
export { DefaultConnectionManager } from './connection-manager.ts';
export type {
  WebSocketConnection,
  WebSocketState,
  WebSocketMessage,
  WebSocketError,
  ConnectionManager,
} from './types.ts';

import { WebSocketServer } from './server.ts';
import { ProcessWebSocketHandlers } from './handlers.ts';
import { ProcessManager } from '../process/manager.ts';
import { logger } from '../shared/logger.ts';

/**
 * Create and configure a WebSocket server for process management
 * @param processManager ProcessManager instance
 * @param config WebSocket server configuration
 * @returns Configured WebSocket server
 */
export function createProcessWebSocketServer(
  processManager: ProcessManager,
  config: { port?: number; hostname?: string; path?: string } = {}
): WebSocketServer {
  // Create WebSocket server
  const server = new WebSocketServer({
    port: config.port || 8080,
    hostname: config.hostname || '0.0.0.0',
    path: config.path || '/ws',
  });

  // Create and register handlers
  const handlers = new ProcessWebSocketHandlers(processManager);
  handlers.registerHandlers(server);

  // Subscribe to process events and broadcast updates
  setupProcessEventBroadcasting(processManager, server);

  return server;
}

/**
 * Set up event broadcasting from ProcessManager to WebSocket clients
 * @param processManager ProcessManager instance
 * @param server WebSocket server instance
 */
function setupProcessEventBroadcasting(
  processManager: ProcessManager,
  server: WebSocketServer
): void {
  // Broadcast process started events
  processManager.on('process:started', (data) => {
    server.broadcast({
      type: 'process_started',
      data: {
        processId: data.processId,
        process: data.process,
      },
    });
    logger.debug('WebSocket', `Broadcast process_started for ${data.processId}`);
  });

  // Broadcast process stopped events
  processManager.on('process:stopped', (data) => {
    server.broadcast({
      type: 'process_stopped',
      data: {
        processId: data.processId,
        process: data.process,
      },
    });
    logger.debug('WebSocket', `Broadcast process_stopped for ${data.processId}`);
  });

  // Broadcast process failed events
  processManager.on('process:failed', (data) => {
    server.broadcast({
      type: 'process_failed',
      data: {
        processId: data.processId,
        process: data.process,
        error: data.error,
      },
    });
    logger.debug('WebSocket', `Broadcast process_failed for ${data.processId}`);
  });

  // Broadcast state changes
  processManager.on('process:state_changed', (data) => {
    server.broadcast({
      type: 'process_state_changed',
      data: {
        processId: data.processId,
        from: data.from,
        to: data.to,
      },
    });
    logger.debug('WebSocket', `Broadcast state change for ${data.processId}: ${data.from} -> ${data.to}`);
  });

  // Broadcast log updates (throttled to avoid overwhelming clients)
  let logBroadcastTimeout: number | undefined;
  const pendingLogBroadcasts = new Map<string, { processId: string; logs: Array<unknown> }>();

  processManager.on('process:log_added', (data) => {
    // Accumulate logs for batch broadcasting
    const existing = pendingLogBroadcasts.get(data.processId) || { processId: data.processId, logs: [] };
    existing.logs.push(data.log);
    pendingLogBroadcasts.set(data.processId, existing);

    // Schedule broadcast
    if (logBroadcastTimeout === undefined) {
      logBroadcastTimeout = setTimeout(() => {
        // Broadcast all pending logs
        for (const [processId, { logs }] of pendingLogBroadcasts) {
          server.broadcast({
            type: 'process_logs_updated',
            data: {
              processId,
              logs,
            },
          });
        }
        
        // Clear pending logs
        pendingLogBroadcasts.clear();
        logBroadcastTimeout = undefined;
      }, 100); // Batch logs every 100ms
    }
  });

  logger.log('WebSocket', 'Process event broadcasting configured');
}