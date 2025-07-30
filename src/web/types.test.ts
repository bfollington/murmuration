import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { 
  WebSocketState
} from "./types.ts";
import type { 
  ConnectionManager, 
  WebSocketConnection, 
  ServerMessage,
  ConnectionFilter,
  ClientSubscriptions,
  ConnectionEvent,
  ConnectionStats
} from "./types.ts";

// Mock WebSocket for testing
class MockWebSocket {
  readyState = 1; // OPEN
  send(_data: string) {}
  close(_code?: number, _reason?: string) {}
}

// Mock implementation to verify interface completeness
class MockConnectionManager implements ConnectionManager {
  private connections = new Map<string, WebSocketConnection>();
  private eventListeners = new Set<(event: ConnectionEvent) => void>();
  private nextSessionId = 1;

  addConnection(socket: WebSocket, metadata?: Record<string, unknown>): string {
    const sessionId = `session-${this.nextSessionId++}`;
    const connection: WebSocketConnection = {
      sessionId,
      socket,
      state: WebSocketState.CONNECTED,
      connectedAt: new Date(),
      lastActivity: new Date(),
      subscriptions: {
        processIds: new Set(),
        allProcesses: false
      },
      metadata
    };
    this.connections.set(sessionId, connection);
    this.emitEvent({ type: 'connected', sessionId, timestamp: new Date() });
    return sessionId;
  }

  removeConnection(sessionId: string): boolean {
    const existed = this.connections.delete(sessionId);
    if (existed) {
      this.emitEvent({ type: 'disconnected', sessionId, timestamp: new Date() });
    }
    return existed;
  }

  getConnection(sessionId: string): WebSocketConnection | undefined {
    return this.connections.get(sessionId);
  }

  getConnections(filter?: ConnectionFilter): WebSocketConnection[] {
    let connections = Array.from(this.connections.values());
    
    if (filter) {
      if (filter.sessionIds) {
        connections = connections.filter(c => filter.sessionIds!.includes(c.sessionId));
      }
      if (filter.states) {
        connections = connections.filter(c => filter.states!.includes(c.state));
      }
      if (filter.subscribedToAll !== undefined) {
        connections = connections.filter(c => c.subscriptions.allProcesses === filter.subscribedToAll);
      }
      if (filter.processIds) {
        connections = connections.filter(c => 
          filter.processIds!.some(pid => c.subscriptions.processIds.has(pid))
        );
      }
      if (filter.inactiveSince) {
        const cutoff = Date.now() - filter.inactiveSince;
        connections = connections.filter(c => c.lastActivity.getTime() < cutoff);
      }
    }
    
    return connections;
  }

  async sendToConnection(_sessionId: string, _message: ServerMessage): Promise<boolean> {
    return true;
  }

  async broadcast(_message: ServerMessage, _filter?: ConnectionFilter): Promise<number> {
    return 0;
  }

  async broadcastToProcess(_processId: string, _message: ServerMessage): Promise<number> {
    return 0;
  }

  updateSubscription(sessionId: string, action: string, processId?: string): boolean {
    const connection = this.connections.get(sessionId);
    if (!connection) return false;

    switch (action) {
      case 'subscribe':
        if (processId) {
          connection.subscriptions.processIds.add(processId);
          this.emitEvent({ type: 'subscribed', sessionId, timestamp: new Date(), details: { processId } });
        }
        break;
      case 'unsubscribe':
        if (processId) {
          connection.subscriptions.processIds.delete(processId);
          this.emitEvent({ type: 'unsubscribed', sessionId, timestamp: new Date(), details: { processId } });
        }
        break;
      case 'subscribe_all':
        connection.subscriptions.allProcesses = true;
        this.emitEvent({ type: 'subscribed', sessionId, timestamp: new Date(), details: { allProcesses: true } });
        break;
      case 'unsubscribe_all':
        connection.subscriptions.allProcesses = false;
        this.emitEvent({ type: 'unsubscribed', sessionId, timestamp: new Date(), details: { allProcesses: false } });
        break;
    }
    
    return true;
  }

  getSubscriptions(sessionId: string): ClientSubscriptions | undefined {
    return this.connections.get(sessionId)?.subscriptions;
  }

  isSubscribedToProcess(sessionId: string, processId: string): boolean {
    const connection = this.connections.get(sessionId);
    if (!connection) return false;
    
    return connection.subscriptions.allProcesses || 
           connection.subscriptions.processIds.has(processId);
  }

  updateActivity(sessionId: string): void {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.lastActivity = new Date();
    }
  }

  cleanupInactive(maxInactiveMs: number): number {
    const cutoff = Date.now() - maxInactiveMs;
    let cleaned = 0;
    
    for (const [sessionId, connection] of this.connections) {
      if (connection.lastActivity.getTime() < cutoff) {
        this.removeConnection(sessionId);
        cleaned++;
      }
    }
    
    return cleaned;
  }

  getStats(): ConnectionStats {
    const connections = Array.from(this.connections.values());
    const states = connections.reduce((acc, c) => {
      acc[c.state] = (acc[c.state] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const totalSubscriptions = connections.reduce((sum, c) => 
      sum + c.subscriptions.processIds.size, 0
    );
    
    return {
      total: connections.length,
      connected: states[WebSocketState.CONNECTED] || 0,
      disconnected: states[WebSocketState.DISCONNECTED] || 0,
      error: states[WebSocketState.ERROR] || 0,
      subscribedToAll: connections.filter(c => c.subscriptions.allProcesses).length,
      averageSubscriptionsPerConnection: connections.length > 0 ? 
        totalSubscriptions / connections.length : 0,
      oldestConnection: connections.length > 0 ? 
        connections.reduce((oldest, c) => 
          c.connectedAt < oldest ? c.connectedAt : oldest, 
          connections[0].connectedAt
        ) : undefined,
      newestConnection: connections.length > 0 ?
        connections.reduce((newest, c) => 
          c.connectedAt > newest ? c.connectedAt : newest,
          connections[0].connectedAt  
        ) : undefined
    };
  }

  async closeAll(_code?: number, _reason?: string): Promise<void> {
    this.connections.clear();
  }

  onConnectionEvent(callback: (event: ConnectionEvent) => void): () => void {
    this.eventListeners.add(callback);
    return () => {
      this.eventListeners.delete(callback);
    };
  }

  private emitEvent(event: ConnectionEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}

// Test that the interface can be implemented
Deno.test("ConnectionManager - interface can be implemented", () => {
  const manager: ConnectionManager = new MockConnectionManager();
  assertExists(manager);
});

// Test WebSocketConnection structure
Deno.test("WebSocketConnection - has all required fields", () => {
  const connection: WebSocketConnection = {
    sessionId: "test-session",
    socket: new MockWebSocket() as unknown as WebSocket,
    state: WebSocketState.CONNECTED,
    connectedAt: new Date(),
    lastActivity: new Date(),
    subscriptions: {
      processIds: new Set(["p1", "p2"]),
      allProcesses: false
    },
    metadata: { userAgent: "test" }
  };
  
  assertEquals(connection.sessionId, "test-session");
  assertEquals(connection.state, WebSocketState.CONNECTED);
  assertExists(connection.connectedAt);
  assertExists(connection.lastActivity);
  assertEquals(connection.subscriptions.processIds.size, 2);
  assertEquals(connection.subscriptions.allProcesses, false);
  assertEquals(connection.metadata?.userAgent, "test");
});

// Test ConnectionFilter usage
Deno.test("ConnectionFilter - supports all filter criteria", () => {
  const filter: ConnectionFilter = {
    processIds: ["p1", "p2"],
    subscribedToAll: true,
    states: [WebSocketState.CONNECTED, WebSocketState.RECONNECTING],
    sessionIds: ["session-1", "session-2"],
    inactiveSince: 60000
  };
  
  // Verify all fields exist
  assertExists(filter.processIds);
  assertExists(filter.subscribedToAll);
  assertExists(filter.states);
  assertExists(filter.sessionIds);
  assertExists(filter.inactiveSince);
});

// Test ConnectionStats structure
Deno.test("ConnectionStats - contains all statistics", () => {
  const stats: ConnectionStats = {
    total: 10,
    connected: 7,
    disconnected: 2,
    error: 1,
    subscribedToAll: 3,
    averageSubscriptionsPerConnection: 2.5,
    oldestConnection: new Date("2023-01-01"),
    newestConnection: new Date()
  };
  
  assertEquals(stats.total, 10);
  assertEquals(stats.connected, 7);
  assertEquals(stats.disconnected, 2);
  assertEquals(stats.error, 1);
  assertEquals(stats.subscribedToAll, 3);
  assertEquals(stats.averageSubscriptionsPerConnection, 2.5);
  assertExists(stats.oldestConnection);
  assertExists(stats.newestConnection);
});

// Test subscription management
Deno.test("ConnectionManager - subscription methods work together", () => {
  const manager = new MockConnectionManager();
  const socket = new MockWebSocket() as unknown as WebSocket;
  
  // Add connection
  const sessionId = manager.addConnection(socket);
  
  // Test initial state
  const subs = manager.getSubscriptions(sessionId);
  assertExists(subs);
  assertEquals(subs!.processIds.size, 0);
  assertEquals(subs!.allProcesses, false);
  
  // Subscribe to specific process
  assertEquals(manager.updateSubscription(sessionId, 'subscribe', 'p1'), true);
  assertEquals(manager.isSubscribedToProcess(sessionId, 'p1'), true);
  assertEquals(manager.isSubscribedToProcess(sessionId, 'p2'), false);
  
  // Subscribe to all
  assertEquals(manager.updateSubscription(sessionId, 'subscribe_all'), true);
  assertEquals(manager.isSubscribedToProcess(sessionId, 'p2'), true); // Now subscribed via all
  
  // Verify subscriptions
  const updatedSubs = manager.getSubscriptions(sessionId);
  assertExists(updatedSubs);
  assertEquals(updatedSubs!.processIds.has('p1'), true);
  assertEquals(updatedSubs!.allProcesses, true);
});

// Test connection filtering
Deno.test("ConnectionManager - filtering connections works", () => {
  const manager = new MockConnectionManager();
  
  // Add multiple connections
  const s1 = manager.addConnection(new MockWebSocket() as unknown as WebSocket);
  const s2 = manager.addConnection(new MockWebSocket() as unknown as WebSocket);
  const s3 = manager.addConnection(new MockWebSocket() as unknown as WebSocket);
  
  // Set up different subscriptions
  manager.updateSubscription(s1, 'subscribe', 'p1');
  manager.updateSubscription(s2, 'subscribe_all');
  manager.updateSubscription(s3, 'subscribe', 'p2');
  
  // Test various filters
  assertEquals(manager.getConnections().length, 3);
  assertEquals(manager.getConnections({ subscribedToAll: true }).length, 1);
  assertEquals(manager.getConnections({ processIds: ['p1'] }).length, 1);
  assertEquals(manager.getConnections({ sessionIds: [s1, s2] }).length, 2);
});

// Test event handling
Deno.test("ConnectionManager - event callbacks work", () => {
  const manager = new MockConnectionManager();
  const events: ConnectionEvent[] = [];
  
  // Register callback
  const unsubscribe = manager.onConnectionEvent((event) => {
    events.push(event);
  });
  
  // Trigger events
  const sessionId = manager.addConnection(new MockWebSocket() as unknown as WebSocket);
  manager.updateSubscription(sessionId, 'subscribe', 'p1');
  manager.removeConnection(sessionId);
  
  // Verify events
  assertEquals(events.length, 3);
  assertEquals(events[0].type, 'connected');
  assertEquals(events[1].type, 'subscribed');
  assertEquals(events[2].type, 'disconnected');
  
  // Test unsubscribe
  unsubscribe();
  manager.addConnection(new MockWebSocket() as unknown as WebSocket);
  assertEquals(events.length, 3); // No new event
});

// Test cleanup functionality
Deno.test("ConnectionManager - cleanup inactive connections", async () => {
  const manager = new MockConnectionManager();
  
  // Add connections
  const s1 = manager.addConnection(new MockWebSocket() as unknown as WebSocket);
  const s2 = manager.addConnection(new MockWebSocket() as unknown as WebSocket);
  
  // Make s1 inactive by not updating activity
  await new Promise(resolve => setTimeout(resolve, 100));
  manager.updateActivity(s2); // Keep s2 active
  
  // Clean up connections inactive for more than 50ms
  const cleaned = manager.cleanupInactive(50);
  
  // Verify cleanup
  assertEquals(cleaned, 1);
  assertEquals(manager.getConnection(s1), undefined);
  assertExists(manager.getConnection(s2));
});