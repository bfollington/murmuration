import {
  ConnectionManager,
  WebSocketConnection,
  WebSocketState,
  ClientSubscriptions,
  ServerMessage,
  SendOptions,
  ConnectionFilter,
  ConnectionStats,
  ConnectionEvent,
} from './types.ts';
import { logger } from '../shared/logger.ts';

/**
 * Concrete implementation of ConnectionManager for managing WebSocket connections
 */
export class WebSocketConnectionManager implements ConnectionManager {
  private readonly connections: Map<string, WebSocketConnection> = new Map();
  private readonly eventListeners: Set<(event: ConnectionEvent) => void> = new Set();

  /**
   * Add a new WebSocket connection
   */
  addConnection(socket: WebSocket, metadata?: Record<string, unknown>): string {
    const sessionId = crypto.randomUUID();
    const now = new Date();

    const connection: WebSocketConnection = {
      sessionId,
      socket,
      state: WebSocketState.CONNECTED,
      connectedAt: now,
      lastActivity: now,
      subscriptions: {
        processIds: new Set<string>(),
        allProcesses: false,
      },
      metadata,
    };

    this.connections.set(sessionId, connection);
    logger.debug('ConnectionManager', `Added connection ${sessionId}`);
    
    this.emitEvent({
      type: 'connected',
      sessionId,
      timestamp: now,
      details: metadata,
    });

    return sessionId;
  }

  /**
   * Remove a connection by session ID
   */
  removeConnection(sessionId: string): boolean {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return false;
    }

    this.connections.delete(sessionId);
    logger.debug('ConnectionManager', `Removed connection ${sessionId}`);
    
    this.emitEvent({
      type: 'disconnected',
      sessionId,
      timestamp: new Date(),
    });

    return true;
  }

  /**
   * Get a specific connection by session ID
   */
  getConnection(sessionId: string): WebSocketConnection | undefined {
    return this.connections.get(sessionId);
  }

  /**
   * Get all connections matching the filter criteria
   */
  getConnections(filter?: ConnectionFilter): WebSocketConnection[] {
    let connections = Array.from(this.connections.values());

    if (!filter) {
      return connections;
    }

    // Filter by process IDs
    if (filter.processIds && filter.processIds.length > 0) {
      connections = connections.filter(conn => {
        if (conn.subscriptions.allProcesses) return true;
        return filter.processIds!.some(id => conn.subscriptions.processIds.has(id));
      });
    }

    // Filter by subscribed to all
    if (filter.subscribedToAll !== undefined) {
      connections = connections.filter(conn => 
        conn.subscriptions.allProcesses === filter.subscribedToAll
      );
    }

    // Filter by states
    if (filter.states && filter.states.length > 0) {
      connections = connections.filter(conn => 
        filter.states!.includes(conn.state)
      );
    }

    // Filter by session IDs
    if (filter.sessionIds && filter.sessionIds.length > 0) {
      connections = connections.filter(conn => 
        filter.sessionIds!.includes(conn.sessionId)
      );
    }

    // Filter by inactivity
    if (filter.inactiveSince !== undefined) {
      const cutoff = Date.now() - filter.inactiveSince;
      connections = connections.filter(conn => 
        conn.lastActivity.getTime() < cutoff
      );
    }

    return connections;
  }

  /**
   * Get all connections (alias for getConnections with no filter)
   */
  getAllConnections(): WebSocketConnection[] {
    return this.getConnections();
  }

  /**
   * Send a message to a specific connection
   */
  async sendToConnection(
    sessionId: string, 
    message: ServerMessage, 
    options?: SendOptions
  ): Promise<boolean> {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      logger.log('ConnectionManager', `Warning: Connection ${sessionId} not found`);
      return false;
    }

    // Check if we should send based on subscriptions
    if (!options?.force && this.shouldFilterMessage(connection, message)) {
      logger.debug('ConnectionManager', `Filtered message to ${sessionId} - not subscribed`);
      return false;
    }

    try {
      // Check if socket is open
      if (connection.socket.readyState !== WebSocket.OPEN) {
        logger.log('ConnectionManager', `Warning: Connection ${sessionId} not open (state: ${connection.socket.readyState})`);
        return false;
      }

      // Send the message
      const messageStr = JSON.stringify(message);
      connection.socket.send(messageStr);
      
      // Update activity
      this.updateActivity(sessionId);
      
      logger.debug('ConnectionManager', `Sent message to ${sessionId}: ${message.type}`);
      return true;
    } catch (error) {
      logger.error('ConnectionManager', `Failed to send message to ${sessionId}:`, error);
      
      // Update connection state on error
      connection.state = WebSocketState.ERROR;
      this.emitEvent({
        type: 'error',
        sessionId,
        timestamp: new Date(),
        details: error,
      });
      
      return false;
    }
  }

  /**
   * Broadcast a message to all connections matching the filter
   */
  async broadcast(message: ServerMessage, filter?: ConnectionFilter): Promise<number> {
    const connections = this.getConnections(filter);
    let successCount = 0;

    logger.debug('ConnectionManager', `Broadcasting ${message.type} to ${connections.length} connections`);

    const sendPromises = connections.map(conn => 
      this.sendToConnection(conn.sessionId, message).then(success => {
        if (success) successCount++;
        return success;
      })
    );

    await Promise.all(sendPromises);
    
    logger.debug('ConnectionManager', `Broadcast complete: ${successCount}/${connections.length} successful`);
    return successCount;
  }

  /**
   * Broadcast a message to connections subscribed to a specific process
   */
  async broadcastToProcess(processId: string, message: ServerMessage): Promise<number> {
    const filter: ConnectionFilter = {
      processIds: [processId],
    };
    return this.broadcast(message, filter);
  }

  /**
   * Update subscriptions for a connection
   */
  updateSubscription(
    sessionId: string,
    action: 'subscribe' | 'unsubscribe' | 'subscribe_all' | 'unsubscribe_all',
    processId?: string
  ): boolean {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return false;
    }

    const { subscriptions } = connection;

    switch (action) {
      case 'subscribe':
        if (!processId) {
          logger.log('ConnectionManager', 'Warning: Subscribe action requires processId');
          return false;
        }
        subscriptions.processIds.add(processId);
        logger.debug('ConnectionManager', `${sessionId} subscribed to process ${processId}`);
        break;

      case 'unsubscribe':
        if (!processId) {
          logger.log('ConnectionManager', 'Warning: Unsubscribe action requires processId');
          return false;
        }
        subscriptions.processIds.delete(processId);
        logger.debug('ConnectionManager', `${sessionId} unsubscribed from process ${processId}`);
        break;

      case 'subscribe_all':
        subscriptions.allProcesses = true;
        logger.debug('ConnectionManager', `${sessionId} subscribed to all processes`);
        break;

      case 'unsubscribe_all':
        subscriptions.allProcesses = false;
        subscriptions.processIds.clear();
        logger.debug('ConnectionManager', `${sessionId} unsubscribed from all processes`);
        break;
    }

    this.emitEvent({
      type: action.startsWith('unsubscribe') ? 'unsubscribed' : 'subscribed',
      sessionId,
      timestamp: new Date(),
      details: { action, processId },
    });

    return true;
  }

  /**
   * Get subscription state for a connection
   */
  getSubscriptions(sessionId: string): ClientSubscriptions | undefined {
    const connection = this.connections.get(sessionId);
    return connection?.subscriptions;
  }

  /**
   * Check if a connection is subscribed to a process
   */
  isSubscribedToProcess(sessionId: string, processId: string): boolean {
    const connection = this.connections.get(sessionId);
    if (!connection) {
      return false;
    }

    return connection.subscriptions.allProcesses || 
           connection.subscriptions.processIds.has(processId);
  }

  /**
   * Update the last activity timestamp for a connection
   */
  updateActivity(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.lastActivity = new Date();
    }
  }

  /**
   * Clean up inactive or errored connections
   */
  cleanupInactive(maxInactiveMs: number): number {
    const cutoff = Date.now() - maxInactiveMs;
    let cleanedCount = 0;

    for (const [sessionId, connection] of this.connections) {
      const shouldClean = connection.state === WebSocketState.ERROR ||
                         connection.lastActivity.getTime() < cutoff;

      if (shouldClean) {
        logger.log('ConnectionManager', `Cleaning up inactive connection ${sessionId}`);
        this.removeConnection(sessionId);
        
        // Close the socket if still open
        if (connection.socket.readyState === WebSocket.OPEN) {
          connection.socket.close(1000, 'Inactive connection');
        }
        
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.log('ConnectionManager', `Cleaned up ${cleanedCount} inactive connections`);
    }

    return cleanedCount;
  }

  /**
   * Get statistics about current connections
   */
  getStats(): ConnectionStats {
    const connections = Array.from(this.connections.values());
    
    const stats: ConnectionStats = {
      total: connections.length,
      connected: connections.filter(c => c.state === WebSocketState.CONNECTED).length,
      disconnected: connections.filter(c => c.state === WebSocketState.DISCONNECTED).length,
      error: connections.filter(c => c.state === WebSocketState.ERROR).length,
      subscribedToAll: connections.filter(c => c.subscriptions.allProcesses).length,
      averageSubscriptionsPerConnection: 0,
    };

    if (connections.length > 0) {
      const totalSubscriptions = connections.reduce((sum, conn) => 
        sum + conn.subscriptions.processIds.size, 0
      );
      stats.averageSubscriptionsPerConnection = totalSubscriptions / connections.length;

      // Find oldest and newest connections
      const sorted = connections.sort((a, b) => 
        a.connectedAt.getTime() - b.connectedAt.getTime()
      );
      stats.oldestConnection = sorted[0].connectedAt;
      stats.newestConnection = sorted[sorted.length - 1].connectedAt;
    }

    return stats;
  }

  /**
   * Close all connections gracefully
   */
  async closeAll(code?: number, reason?: string): Promise<void> {
    logger.log('ConnectionManager', `Closing all ${this.connections.size} connections`);
    
    const closePromises: Promise<void>[] = [];

    for (const [sessionId, connection] of this.connections) {
      closePromises.push(
        new Promise<void>((resolve) => {
          if (connection.socket.readyState === WebSocket.OPEN) {
            connection.socket.close(code || 1000, reason || 'Server shutting down');
            
            // Wait for close event or timeout
            const timeout = setTimeout(() => resolve(), 1000);
            connection.socket.addEventListener('close', () => {
              clearTimeout(timeout);
              resolve();
            });
          } else {
            resolve();
          }
          
          this.removeConnection(sessionId);
        })
      );
    }

    await Promise.all(closePromises);
    logger.log('ConnectionManager', 'All connections closed');
  }

  /**
   * Register a callback for connection events
   */
  onConnectionEvent(callback: (event: ConnectionEvent) => void): () => void {
    this.eventListeners.add(callback);
    
    // Return cleanup function
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  /**
   * Emit an event to all listeners
   */
  private emitEvent(event: ConnectionEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error('ConnectionManager', 'Event listener error:', error);
      }
    }
  }

  /**
   * Check if a message should be filtered based on subscriptions
   */
  private shouldFilterMessage(connection: WebSocketConnection, message: ServerMessage): boolean {
    // Some messages should always be sent
    const alwaysSend = ['connected', 'error', 'success', 'ping', 'pong'];
    if (alwaysSend.includes(message.type)) {
      return false;
    }

    // If subscribed to all, send everything
    if (connection.subscriptions.allProcesses) {
      return false;
    }

    // Check if message relates to a subscribed process
    if ('payload' in message && 
        typeof message.payload === 'object' && 
        message.payload !== null &&
        'id' in message.payload &&
        typeof message.payload.id === 'string') {
      return !connection.subscriptions.processIds.has(message.payload.id);
    }

    // Default to sending if we can't determine
    return false;
  }

  /**
   * Get connection count (utility method)
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Check if session exists (utility method)
   */
  hasConnection(sessionId: string): boolean {
    return this.connections.has(sessionId);
  }

  /**
   * Get all session IDs (utility method)
   */
  getSessionIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connections by state (utility method)
   */
  getConnectionsByState(state: WebSocketState): WebSocketConnection[] {
    return this.getConnections({ states: [state] });
  }

  /**
   * Get connections by subscription (utility method)
   */
  getConnectionsBySubscription(processId: string): WebSocketConnection[] {
    return this.getConnections({ processIds: [processId] });
  }
}

/**
 * Factory function to create a ConnectionManager instance
 */
export function createConnectionManager(): ConnectionManager {
  return new WebSocketConnectionManager();
}

// Export default instance for convenience
export const defaultConnectionManager = createConnectionManager();

/**
 * Default connection manager class for convenience
 */
export class DefaultConnectionManager extends WebSocketConnectionManager {
  constructor() {
    super();
  }
}