import { logger } from '../shared/logger.ts';
import { WebSocketMessage, WebSocketError, isWebSocketMessage } from './types.ts';
import { ProcessWebSocketHandlers } from './handlers.ts';
import { ProcessManager } from '../process/manager.ts';

/**
 * Simplified WebSocket server for process management
 * 
 * This is a minimal implementation that works without the complex
 * connection manager integration.
 */
export class SimpleWebSocketServer {
  private server: Deno.HttpServer<Deno.NetAddr> | null = null;
  private connections = new Map<string, WebSocket>();
  private handlers: ProcessWebSocketHandlers;
  private connectionIdCounter = 0;

  constructor(
    private processManager: ProcessManager,
    private config: { port: number; hostname?: string; path?: string }
  ) {
    this.handlers = new ProcessWebSocketHandlers(processManager);
  }

  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    logger.log('SimpleWebSocketServer', `Starting on ${this.config.hostname || '0.0.0.0'}:${this.config.port}`);

    this.server = Deno.serve({
      port: this.config.port,
      hostname: this.config.hostname || '0.0.0.0',
      handler: (req) => this.handleRequest(req),
    });

    // Set up process event listeners
    this.setupEventListeners();
  }

  private handleRequest(req: Request): Response {
    const url = new URL(req.url);
    
    if (url.pathname === (this.config.path || '/ws')) {
      return this.handleWebSocketUpgrade(req);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        connections: this.connections.size,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  private handleWebSocketUpgrade(req: Request): Response {
    const upgrade = req.headers.get('upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 400 });
    }

    try {
      const { socket, response } = Deno.upgradeWebSocket(req);
      const connectionId = `ws-${Date.now()}-${++this.connectionIdCounter}`;
      
      socket.onopen = () => {
        logger.log('SimpleWebSocketServer', `Connection opened: ${connectionId}`);
        this.connections.set(connectionId, socket);
        
        // Send connected message
        this.sendToConnection(connectionId, {
          type: 'connected',
          data: { connectionId, serverTime: new Date().toISOString() },
        });
      };

      socket.onclose = () => {
        logger.log('SimpleWebSocketServer', `Connection closed: ${connectionId}`);
        this.connections.delete(connectionId);
      };

      socket.onerror = (event) => {
        logger.error('SimpleWebSocketServer', `Connection error: ${connectionId}`, event);
      };

      socket.onmessage = (event) => {
        this.handleMessage(connectionId, event);
      };

      return response;
    } catch (error) {
      logger.error('SimpleWebSocketServer', 'Failed to upgrade WebSocket', error);
      return new Response('WebSocket upgrade failed', { status: 500 });
    }
  }

  private async handleMessage(connectionId: string, event: MessageEvent): Promise<void> {
    try {
      const message = JSON.parse(event.data);
      
      if (!isWebSocketMessage(message)) {
        throw new Error('Invalid message format');
      }

      logger.debug('SimpleWebSocketServer', `Processing ${message.type} from ${connectionId}`);

      // Create a mock connection object for handlers
      const socket = this.connections.get(connectionId);
      if (!socket) return;

      const connection = {
        id: connectionId,
        sessionId: connectionId,
        socket,
        state: 'open' as const,
        connectedAt: new Date(),
        lastActivity: new Date(),
        subscriptions: { processIds: new Set<string>(), allProcesses: true },
        metadata: {},
      };

      // Route to appropriate handler
      switch (message.type) {
        case 'list_processes':
          await this.handlers.handleListProcesses(connection, message.data);
          break;
        case 'get_process_status':
          await this.handlers.handleGetProcessStatus(connection, message.data);
          break;
        case 'start_process':
          await this.handlers.handleStartProcess(connection, message.data);
          break;
        case 'stop_process':
          await this.handlers.handleStopProcess(connection, message.data);
          break;
        case 'get_process_logs':
          await this.handlers.handleGetProcessLogs(connection, message.data);
          break;
        default:
          this.sendError(connectionId, {
            code: 'UNKNOWN_MESSAGE_TYPE',
            message: `Unknown message type: ${message.type}`,
          });
      }
    } catch (error) {
      logger.error('SimpleWebSocketServer', 'Error handling message', error);
      this.sendError(connectionId, {
        code: 'MESSAGE_PROCESSING_ERROR',
        message: error instanceof Error ? error.message : 'Failed to process message',
      });
    }
  }

  private setupEventListeners(): void {
    // Listen for process events and broadcast to all connections
    this.processManager.on('process:started', (data) => {
      this.broadcast({
        type: 'process_started',
        data: { processId: data.processId, process: data.process },
      });
    });

    this.processManager.on('process:stopped', (data) => {
      this.broadcast({
        type: 'process_stopped',
        data: { processId: data.processId, process: data.process },
      });
    });

    this.processManager.on('process:failed', (data) => {
      this.broadcast({
        type: 'process_failed',
        data: { processId: data.processId, process: data.process, error: data.error },
      });
    });

    this.processManager.on('process:state_changed', (data) => {
      this.broadcast({
        type: 'process_state_changed',
        data: { processId: data.processId, from: data.from, to: data.to },
      });
    });

    // Throttled log broadcasting
    let logTimeout: number | undefined;
    const pendingLogs = new Map<string, unknown[]>();

    this.processManager.on('process:log_added', (data) => {
      const logs = pendingLogs.get(data.processId) || [];
      logs.push(data.log);
      pendingLogs.set(data.processId, logs);

      if (!logTimeout) {
        logTimeout = setTimeout(() => {
          for (const [processId, logs] of pendingLogs) {
            this.broadcast({
              type: 'process_logs_updated',
              data: { processId, logs },
            });
          }
          pendingLogs.clear();
          logTimeout = undefined;
        }, 100);
      }
    });
  }

  private sendToConnection(connectionId: string, message: WebSocketMessage): void {
    const socket = this.connections.get(connectionId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        logger.error('SimpleWebSocketServer', `Failed to send to ${connectionId}`, error);
      }
    }
  }

  private sendError(connectionId: string, error: WebSocketError): void {
    this.sendToConnection(connectionId, { type: 'error', data: error });
  }

  private broadcast(message: WebSocketMessage): void {
    for (const [connectionId, socket] of this.connections) {
      if (socket.readyState === WebSocket.OPEN) {
        this.sendToConnection(connectionId, message);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    // Close all connections
    for (const [connectionId, socket] of this.connections) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1001, 'Server shutdown');
      }
    }

    // Shutdown server
    await this.server.shutdown();
    this.server = null;
    this.connections.clear();

    logger.log('SimpleWebSocketServer', 'Server stopped');
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}