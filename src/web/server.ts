import { logger } from '../shared/logger.ts';
import { WebSocketConnection, WebSocketState, ConnectionManager, WebSocketMessage, WebSocketError, isWebSocketMessage } from './types.ts';
import { DefaultConnectionManager } from './connection-manager.ts';

/**
 * Configuration options for the WebSocket server
 */
export interface WebSocketServerConfig {
  /** Port to listen on */
  port: number;
  /** Hostname to bind to */
  hostname?: string;
  /** Path for WebSocket upgrade requests */
  path?: string;
  /** Maximum number of concurrent connections */
  maxConnections?: number;
  /** Heartbeat interval in milliseconds */
  heartbeatInterval?: number;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Required<WebSocketServerConfig> = {
  port: 8080,
  hostname: '0.0.0.0',
  path: '/ws',
  maxConnections: 100,
  heartbeatInterval: 30000,
  connectionTimeout: 60000,
};

/**
 * WebSocket server that accepts connections and manages their lifecycle
 * 
 * This server provides:
 * - HTTP server with WebSocket upgrade handling
 * - Connection lifecycle management
 * - Graceful shutdown
 * - Configuration options
 * 
 * Note: This implementation focuses on connection handling only.
 * Message processing will be added in later phases.
 */
export class WebSocketServer {
  private readonly config: Required<WebSocketServerConfig>;
  private server: Deno.HttpServer<Deno.NetAddr> | null = null;
  private connections: Map<string, WebSocket> = new Map();
  private connectionIdCounter = 0;
  private shutdownPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private connectionManager: ConnectionManager;
  private messageHandlers: Map<string, (connection: WebSocketConnection, data: unknown) => Promise<void>> = new Map();

  constructor(config: WebSocketServerConfig, connectionManager?: ConnectionManager) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.connectionManager = connectionManager || new DefaultConnectionManager();
  }

  /**
   * Start the WebSocket server
   * @returns Promise that resolves when the server is listening
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    this.abortController = new AbortController();

    logger.log('WebSocketServer', `Starting WebSocket server on ${this.config.hostname}:${this.config.port}`);
    logger.log('WebSocketServer', `WebSocket endpoint: ws://${this.config.hostname}:${this.config.port}${this.config.path}`);

    try {
      this.server = Deno.serve({
        port: this.config.port,
        hostname: this.config.hostname,
        signal: this.abortController.signal,
        handler: (req) => this.handleRequest(req),
        onListen: ({ hostname, port }) => {
          logger.log('WebSocketServer', `Server listening on ${hostname}:${port}`);
        },
      });
    } catch (error) {
      logger.error('WebSocketServer', 'Failed to start server', error);
      throw error;
    }
  }

  /**
   * Handle incoming HTTP requests
   * @param req The incoming request
   * @returns Response
   */
  private handleRequest(req: Request): Response {
    const url = new URL(req.url);
    
    // Handle WebSocket upgrade requests
    if (url.pathname === this.config.path) {
      return this.handleWebSocketUpgrade(req);
    }

    // Handle health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        connections: this.connections.size,
        maxConnections: this.config.maxConnections,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Default 404 response
    return new Response('Not Found', { status: 404 });
  }

  /**
   * Handle WebSocket upgrade requests
   * @param req The upgrade request
   * @returns Response with WebSocket upgrade
   */
  private handleWebSocketUpgrade(req: Request): Response {
    // Check if we've reached maximum connections
    if (this.connections.size >= this.config.maxConnections) {
      logger.log('WebSocketServer', `Connection rejected: maximum connections (${this.config.maxConnections}) reached`);
      return new Response('Service Unavailable - Maximum connections reached', { status: 503 });
    }

    // Check for WebSocket upgrade headers
    const upgrade = req.headers.get('upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 400 });
    }

    try {
      const { socket, response } = Deno.upgradeWebSocket(req);
      const connectionId = this.generateConnectionId();
      
      // Set up event handlers
      socket.onopen = () => this.handleConnectionOpen(connectionId, socket);
      socket.onclose = (event) => this.handleConnectionClose(connectionId, event);
      socket.onerror = (event) => this.handleConnectionError(connectionId, event);
      // Set up message handling
      socket.onmessage = (event) => this.handleMessage(connectionId, event);

      return response;
    } catch (error) {
      logger.error('WebSocketServer', 'Failed to upgrade WebSocket', error);
      return new Response('WebSocket upgrade failed', { status: 500 });
    }
  }

  /**
   * Generate a unique connection ID
   * @returns Unique connection ID
   */
  private generateConnectionId(): string {
    const id = ++this.connectionIdCounter;
    const timestamp = Date.now();
    return `ws-${timestamp}-${id}`;
  }

  /**
   * Handle new WebSocket connection
   * @param connectionId Unique connection identifier
   * @param socket The WebSocket instance
   */
  private handleConnectionOpen(connectionId: string, socket: WebSocket): void {
    logger.log('WebSocketServer', `WebSocket connection opened: ${connectionId}`);
    
    // Store the connection
    this.connections.set(connectionId, socket);
    
    // Create connection object and add to manager
    const connection: WebSocketConnection = {
      id: connectionId,
      socket,
      state: WebSocketState.OPEN,
      connectedAt: new Date(),
      metadata: {
        userAgent: 'unknown', // Could be extracted from upgrade request headers
        remoteAddress: 'unknown', // Could be extracted from request
      },
    };
    
    this.connectionManager.addConnection(connection);
    
    // Log connection details
    logger.log('WebSocketServer', `Active connections: ${this.connections.size}/${this.config.maxConnections}`);
    
    // Send connected message to client
    this.sendMessage(connectionId, {
      type: 'connected',
      data: {
        connectionId,
        serverTime: new Date().toISOString(),
      },
    });
  }

  /**
   * Handle WebSocket connection close
   * @param connectionId Connection identifier
   * @param event Close event
   */
  private handleConnectionClose(connectionId: string, event: CloseEvent): void {
    logger.log('WebSocketServer', `WebSocket connection closed: ${connectionId} (code: ${event.code}, reason: ${event.reason || 'none'})`);
    
    // Remove the connection
    this.connections.delete(connectionId);
    this.connectionManager.removeConnection(connectionId);
    
    // Log remaining connections
    logger.log('WebSocketServer', `Active connections: ${this.connections.size}/${this.config.maxConnections}`);
  }

  /**
   * Handle WebSocket connection error
   * @param connectionId Connection identifier  
   * @param event Error event
   */
  private handleConnectionError(connectionId: string, event: Event | ErrorEvent): void {
    const errorMessage = event instanceof ErrorEvent ? event.message : 'Unknown error';
    logger.error('WebSocketServer', `WebSocket error for ${connectionId}: ${errorMessage}`);
    
    // Update connection state
    const connection = this.connectionManager.getConnection(connectionId);
    if (connection) {
      connection.state = WebSocketState.ERROR;
      connection.lastError = new Error(errorMessage);
    }
    
    // The connection will be closed automatically after an error
  }

  /**
   * Handle incoming WebSocket message
   * @param connectionId Connection identifier
   * @param event Message event
   */
  private async handleMessage(connectionId: string, event: MessageEvent): Promise<void> {
    logger.debug('WebSocketServer', `Message received from ${connectionId}`);
    
    try {
      // Parse the message
      const message = this.parseMessage(event.data);
      
      // Validate message format
      if (!isWebSocketMessage(message)) {
        throw new Error('Invalid message format');
      }
      
      logger.debug('WebSocketServer', `Processing message type: ${message.type}`);
      
      // Look up handler for message type
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        const connection = this.connectionManager.getConnection(connectionId);
        if (connection) {
          await handler(connection, message.data);
        }
      } else {
        // Send error response for unknown message type
        this.sendError(connectionId, {
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unknown message type: ${message.type}`,
        });
      }
    } catch (error) {
      logger.error('WebSocketServer', `Error handling message from ${connectionId}`, error);
      this.sendError(connectionId, {
        code: 'MESSAGE_PROCESSING_ERROR',
        message: error instanceof Error ? error.message : 'Failed to process message',
      });
    }
  }

  /**
   * Parse incoming message data
   * @param data Raw message data
   * @returns Parsed message
   */
  private parseMessage(data: unknown): unknown {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (error) {
        throw new Error('Invalid JSON in message');
      }
    }
    throw new Error('Expected string message data');
  }

  /**
   * Send a message to a specific connection
   * @param connectionId Connection identifier
   * @param message Message to send
   */
  private sendMessage(connectionId: string, message: WebSocketMessage): void {
    const socket = this.connections.get(connectionId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
        logger.debug('WebSocketServer', `Sent message type '${message.type}' to ${connectionId}`);
      } catch (error) {
        logger.error('WebSocketServer', `Failed to send message to ${connectionId}`, error);
      }
    }
  }

  /**
   * Send an error message to a specific connection
   * @param connectionId Connection identifier
   * @param error Error details
   */
  private sendError(connectionId: string, error: WebSocketError): void {
    this.sendMessage(connectionId, {
      type: 'error',
      data: error,
    });
  }

  /**
   * Register a message handler
   * @param type Message type
   * @param handler Handler function
   */
  public registerHandler(type: string, handler: (connection: WebSocketConnection, data: unknown) => Promise<void>): void {
    this.messageHandlers.set(type, handler);
    logger.debug('WebSocketServer', `Registered handler for message type: ${type}`);
  }

  /**
   * Broadcast a message to all connected clients
   * @param message Message to broadcast
   */
  public broadcast(message: WebSocketMessage): void {
    const connections = this.connectionManager.getAllConnections();
    logger.debug('WebSocketServer', `Broadcasting message type '${message.type}' to ${connections.length} connections`);
    
    for (const connection of connections) {
      if (connection.state === WebSocketState.OPEN) {
        this.sendMessage(connection.id, message);
      }
    }
  }

  /**
   * Stop the WebSocket server gracefully
   * @param options Shutdown options
   * @returns Promise that resolves when shutdown is complete
   */
  async stop(options: { timeout?: number; closeCode?: number; closeReason?: string } = {}): Promise<void> {
    const { timeout = 10000, closeCode = 1001, closeReason = 'Server shutdown' } = options;

    if (!this.server) {
      logger.log('WebSocketServer', 'Server is not running');
      return;
    }

    if (this.shutdownPromise) {
      logger.log('WebSocketServer', 'Shutdown already in progress');
      return this.shutdownPromise;
    }

    logger.log('WebSocketServer', `Initiating graceful shutdown (timeout: ${timeout}ms)`);

    this.shutdownPromise = this.performShutdown(timeout, closeCode, closeReason);
    return this.shutdownPromise;
  }

  /**
   * Perform the actual shutdown process
   * @param timeout Shutdown timeout in milliseconds
   * @param closeCode WebSocket close code
   * @param closeReason WebSocket close reason
   * @returns Promise that resolves when shutdown is complete
   */
  private async performShutdown(timeout: number, closeCode: number, closeReason: string): Promise<void> {
    // Close all active WebSocket connections
    logger.log('WebSocketServer', `Closing ${this.connections.size} active connections`);
    
    const closePromises: Promise<void>[] = [];
    for (const [connectionId, socket] of this.connections) {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        logger.debug('WebSocketServer', `Closing connection ${connectionId}`);
        socket.close(closeCode, closeReason);
        
        // Create a promise that resolves when the connection closes
        const closePromise = new Promise<void>((resolve) => {
          const originalOnClose = socket.onclose;
          let timeoutId: number | undefined;
          
          socket.onclose = (event) => {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            if (originalOnClose) originalOnClose.call(socket, event);
            resolve();
          };
          
          // Timeout individual connection closes
          timeoutId = setTimeout(() => {
            timeoutId = undefined;
            resolve();
          }, 1000);
        });
        
        closePromises.push(closePromise);
      }
    }

    // Wait for all connections to close with timeout
    let timeoutId: number | undefined;
    try {
      await Promise.race([
        Promise.all(closePromises),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Connection close timeout')), timeout / 2);
        })
      ]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      logger.log('WebSocketServer', 'All WebSocket connections closed');
    } catch (error) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      logger.error('WebSocketServer', 'Some connections failed to close gracefully', error);
    }

    // Stop accepting new connections and shutdown the server
    if (this.server) {
      logger.log('WebSocketServer', 'Shutting down HTTP server');
      try {
        await this.server.shutdown();
        logger.log('WebSocketServer', 'HTTP server stopped');
      } catch (error) {
        logger.error('WebSocketServer', 'Error during server shutdown', error);
      }
    }

    // Clean up
    this.connections.clear();
    this.server = null;
    this.abortController = null;
    this.shutdownPromise = null;

    logger.log('WebSocketServer', 'WebSocket server shutdown complete');
  }

  /**
   * Get current server status
   * @returns Server status information
   */
  getStatus(): {
    running: boolean;
    connections: number;
    maxConnections: number;
    config: Required<WebSocketServerConfig>;
  } {
    return {
      running: this.server !== null,
      connections: this.connections.size,
      maxConnections: this.config.maxConnections,
      config: { ...this.config },
    };
  }

  /**
   * Check if the server is running
   * @returns true if server is running
   */
  isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Get active connection count
   * @returns Number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size;
  }
}