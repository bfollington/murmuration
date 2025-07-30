import { assertEquals, assertExists, assertNotEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  WebSocketConnectionManager,
  createConnectionManager,
} from './connection-manager.ts';
import {
  WebSocketState,
  ServerMessage,
  ConnectionFilter,
} from './types.ts';

// Mock WebSocket for testing
class MockWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  
  readyState: number = MockWebSocket.OPEN;
  messages: string[] = [];
  closeCode?: number;
  closeReason?: string;
  
  // Required WebSocket properties
  binaryType: 'blob' | 'arraybuffer' = 'blob';
  bufferedAmount: number = 0;
  extensions: string = '';
  protocol: string = '';
  url: string = 'ws://localhost:8080';
  
  // Event handlers (required by WebSocket interface)
  onopen: ((this: WebSocket, ev: Event) => any) | null = null;
  onclose: ((this: WebSocket, ev: CloseEvent) => any) | null = null;
  onerror: ((this: WebSocket, ev: Event | ErrorEvent) => any) | null = null;
  onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null = null;

  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void {
    if (typeof data === 'string') {
      this.messages.push(data);
    }
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
    this.dispatchEvent(new Event('close'));
  }
}

/**
 * Create a mock WebSocket for testing
 */
function createMockWebSocket(): WebSocket {
  return new MockWebSocket() as unknown as WebSocket;
}

Deno.test('ConnectionManager - addConnection should create new connection with session ID', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  
  const sessionId = manager.addConnection(socket);
  
  assertExists(sessionId);
  assertEquals(typeof sessionId, 'string');
  assertEquals(sessionId.length, 36); // UUID format
  
  const connection = manager.getConnection(sessionId);
  assertExists(connection);
  assertEquals(connection!.sessionId, sessionId);
  assertEquals(connection!.socket, socket);
  assertEquals(connection!.state, WebSocketState.CONNECTED);
  assertEquals(connection!.subscriptions.allProcesses, false);
  assertEquals(connection!.subscriptions.processIds.size, 0);
});

Deno.test('ConnectionManager - addConnection should include metadata if provided', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const metadata = { userAgent: 'test-client', ip: '127.0.0.1' };
  
  const sessionId = manager.addConnection(socket, metadata);
  const connection = manager.getConnection(sessionId);
  
  assertExists(connection);
  assertEquals(connection!.metadata, metadata);
});

Deno.test('ConnectionManager - removeConnection should remove existing connection', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  const removed = manager.removeConnection(sessionId);
  assertEquals(removed, true);
  
  const connection = manager.getConnection(sessionId);
  assertEquals(connection, undefined);
});

Deno.test('ConnectionManager - removeConnection should return false for non-existent connection', () => {
  const manager = new WebSocketConnectionManager();
  
  const removed = manager.removeConnection('non-existent');
  assertEquals(removed, false);
});

Deno.test('ConnectionManager - getConnections should return all connections without filter', () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  const socket3 = createMockWebSocket();
  
  manager.addConnection(socket1);
  manager.addConnection(socket2);
  manager.addConnection(socket3);
  
  const connections = manager.getConnections();
  assertEquals(connections.length, 3);
});

Deno.test('ConnectionManager - getConnections should filter by process IDs', () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  const socket3 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  const sessionId3 = manager.addConnection(socket3);
  
  // Subscribe connections to different processes
  manager.updateSubscription(sessionId1, 'subscribe', 'process-1');
  manager.updateSubscription(sessionId2, 'subscribe', 'process-2');
  manager.updateSubscription(sessionId3, 'subscribe_all');
  
  const filter: ConnectionFilter = { processIds: ['process-1'] };
  const connections = manager.getConnections(filter);
  
  // Should include sessionId1 (subscribed to process-1) and sessionId3 (subscribed to all)
  assertEquals(connections.length, 2);
  assertEquals(connections.some(c => c.sessionId === sessionId1), true);
  assertEquals(connections.some(c => c.sessionId === sessionId3), true);
});

Deno.test('ConnectionManager - getConnections should filter by subscribedToAll', () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  
  manager.updateSubscription(sessionId1, 'subscribe_all');
  
  const filter: ConnectionFilter = { subscribedToAll: true };
  const connections = manager.getConnections(filter);
  
  assertEquals(connections.length, 1);
  assertEquals(connections[0].sessionId, sessionId1);
});

Deno.test('ConnectionManager - getConnections should filter by states', () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  
  // Manually update connection state for testing
  const conn2 = manager.getConnection(sessionId2);
  assertExists(conn2);
  conn2.state = WebSocketState.ERROR;
  
  const filter: ConnectionFilter = { states: [WebSocketState.ERROR] };
  const connections = manager.getConnections(filter);
  
  assertEquals(connections.length, 1);
  assertEquals(connections[0].sessionId, sessionId2);
});

Deno.test('ConnectionManager - sendToConnection should send message to open connection', async () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  const message: ServerMessage = {
    type: 'ping',
    payload: { timestamp: Date.now() }
  };
  
  const sent = await manager.sendToConnection(sessionId, message);
  assertEquals(sent, true);
  assertEquals((socket as any).messages.length, 1);
  assertEquals((socket as any).messages[0], JSON.stringify(message));
});

Deno.test('ConnectionManager - sendToConnection should return false for non-existent connection', async () => {
  const manager = new WebSocketConnectionManager();
  
  const message: ServerMessage = {
    type: 'ping',
    payload: { timestamp: Date.now() }
  };
  
  const sent = await manager.sendToConnection('non-existent', message);
  assertEquals(sent, false);
});

Deno.test('ConnectionManager - sendToConnection should filter messages based on subscriptions', async () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  // Don't subscribe to any processes
  
  const message: ServerMessage = {
    type: 'process_updated',
    payload: { id: 'process-1' } as any // Simplified for test
  };
  
  const sent = await manager.sendToConnection(sessionId, message);
  assertEquals(sent, false); // Should be filtered
  assertEquals((socket as any).messages.length, 0);
});

Deno.test('ConnectionManager - sendToConnection should send with force option', async () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  const message: ServerMessage = {
    type: 'process_updated',
    payload: { id: 'process-1' } as any
  };
  
  const sent = await manager.sendToConnection(sessionId, message, { force: true });
  assertEquals(sent, true);
  assertEquals((socket as any).messages.length, 1);
});

Deno.test('ConnectionManager - broadcast should send to all matching connections', async () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  const socket3 = createMockWebSocket();
  
  manager.addConnection(socket1);
  manager.addConnection(socket2);
  manager.addConnection(socket3);
  
  const message: ServerMessage = {
    type: 'ping',
    payload: { timestamp: Date.now() }
  };
  
  const count = await manager.broadcast(message);
  assertEquals(count, 3);
  assertEquals((socket1 as any).messages.length, 1);
  assertEquals((socket2 as any).messages.length, 1);
  assertEquals((socket3 as any).messages.length, 1);
});

Deno.test('ConnectionManager - broadcastToProcess should send only to subscribed connections', async () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  const socket3 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  const sessionId3 = manager.addConnection(socket3);
  
  // Subscribe only sessionId1 and sessionId3 to process-1
  manager.updateSubscription(sessionId1, 'subscribe', 'process-1');
  manager.updateSubscription(sessionId3, 'subscribe_all');
  
  const message: ServerMessage = {
    type: 'process_updated',
    payload: { id: 'process-1' } as any
  };
  
  const count = await manager.broadcastToProcess('process-1', message);
  assertEquals(count, 2);
  assertEquals((socket1 as any).messages.length, 1);
  assertEquals((socket2 as any).messages.length, 0);
  assertEquals((socket3 as any).messages.length, 1);
});

Deno.test('ConnectionManager - updateSubscription should handle subscribe action', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  const updated = manager.updateSubscription(sessionId, 'subscribe', 'process-1');
  assertEquals(updated, true);
  
  const subscriptions = manager.getSubscriptions(sessionId);
  assertExists(subscriptions);
  assertEquals(subscriptions.processIds.has('process-1'), true);
  assertEquals(subscriptions.allProcesses, false);
});

Deno.test('ConnectionManager - updateSubscription should handle unsubscribe action', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  manager.updateSubscription(sessionId, 'subscribe', 'process-1');
  manager.updateSubscription(sessionId, 'subscribe', 'process-2');
  
  const updated = manager.updateSubscription(sessionId, 'unsubscribe', 'process-1');
  assertEquals(updated, true);
  
  const subscriptions = manager.getSubscriptions(sessionId);
  assertExists(subscriptions);
  assertEquals(subscriptions.processIds.has('process-1'), false);
  assertEquals(subscriptions.processIds.has('process-2'), true);
});

Deno.test('ConnectionManager - updateSubscription should handle subscribe_all action', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  const updated = manager.updateSubscription(sessionId, 'subscribe_all');
  assertEquals(updated, true);
  
  const subscriptions = manager.getSubscriptions(sessionId);
  assertExists(subscriptions);
  assertEquals(subscriptions.allProcesses, true);
});

Deno.test('ConnectionManager - updateSubscription should handle unsubscribe_all action', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  manager.updateSubscription(sessionId, 'subscribe', 'process-1');
  manager.updateSubscription(sessionId, 'subscribe_all');
  
  const updated = manager.updateSubscription(sessionId, 'unsubscribe_all');
  assertEquals(updated, true);
  
  const subscriptions = manager.getSubscriptions(sessionId);
  assertExists(subscriptions);
  assertEquals(subscriptions.allProcesses, false);
  assertEquals(subscriptions.processIds.size, 0);
});

Deno.test('ConnectionManager - isSubscribedToProcess should check direct subscription', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  manager.updateSubscription(sessionId, 'subscribe', 'process-1');
  
  assertEquals(manager.isSubscribedToProcess(sessionId, 'process-1'), true);
  assertEquals(manager.isSubscribedToProcess(sessionId, 'process-2'), false);
});

Deno.test('ConnectionManager - isSubscribedToProcess should return true for subscribe_all', () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  manager.updateSubscription(sessionId, 'subscribe_all');
  
  assertEquals(manager.isSubscribedToProcess(sessionId, 'any-process'), true);
});

Deno.test('ConnectionManager - updateActivity should update last activity time', async () => {
  const manager = new WebSocketConnectionManager();
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  const conn1 = manager.getConnection(sessionId);
  assertExists(conn1);
  const initialActivity = conn1.lastActivity;
  
  // Wait a bit to ensure time difference
  await new Promise(resolve => setTimeout(resolve, 10));
  
  manager.updateActivity(sessionId);
  
  const conn2 = manager.getConnection(sessionId);
  assertExists(conn2);
  assertNotEquals(conn2.lastActivity, initialActivity);
  assertEquals(conn2.lastActivity > initialActivity, true);
});

Deno.test('ConnectionManager - cleanupInactive should remove inactive connections', async () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  
  // Make connection 1 inactive by setting lastActivity to past
  const conn1 = manager.getConnection(sessionId1);
  assertExists(conn1);
  conn1.lastActivity = new Date(Date.now() - 60000); // 1 minute ago
  
  const cleaned = manager.cleanupInactive(30000); // 30 seconds
  assertEquals(cleaned, 1);
  
  assertEquals(manager.getConnection(sessionId1), undefined);
  assertExists(manager.getConnection(sessionId2));
});

Deno.test('ConnectionManager - cleanupInactive should remove errored connections', () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  
  // Set connection 1 to error state
  const conn1 = manager.getConnection(sessionId1);
  assertExists(conn1);
  conn1.state = WebSocketState.ERROR;
  
  const cleaned = manager.cleanupInactive(60000);
  assertEquals(cleaned, 1);
  
  assertEquals(manager.getConnection(sessionId1), undefined);
  assertExists(manager.getConnection(sessionId2));
});

Deno.test('ConnectionManager - getStats should return accurate statistics', () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  const socket3 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  const sessionId3 = manager.addConnection(socket3);
  
  // Setup different states and subscriptions
  manager.updateSubscription(sessionId1, 'subscribe', 'process-1');
  manager.updateSubscription(sessionId1, 'subscribe', 'process-2');
  manager.updateSubscription(sessionId2, 'subscribe_all');
  
  const conn3 = manager.getConnection(sessionId3);
  assertExists(conn3);
  conn3.state = WebSocketState.ERROR;
  
  const stats = manager.getStats();
  
  assertEquals(stats.total, 3);
  assertEquals(stats.connected, 2);
  assertEquals(stats.error, 1);
  assertEquals(stats.subscribedToAll, 1);
  assertEquals(stats.averageSubscriptionsPerConnection, 2/3); // 2 subscriptions across 3 connections
  assertExists(stats.oldestConnection);
  assertExists(stats.newestConnection);
});

Deno.test('ConnectionManager - closeAll should close all connections', async () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  
  manager.addConnection(socket1);
  manager.addConnection(socket2);
  
  await manager.closeAll(1001, 'Going away');
  
  assertEquals(manager.getConnectionCount(), 0);
  assertEquals(socket1.readyState, WebSocket.CLOSED);
  assertEquals((socket1 as any).closeCode, 1001);
  assertEquals((socket1 as any).closeReason, 'Going away');
  assertEquals(socket2.readyState, WebSocket.CLOSED);
});

Deno.test('ConnectionManager - onConnectionEvent should register and trigger callbacks', () => {
  const manager = new WebSocketConnectionManager();
  const events: any[] = [];
  
  const cleanup = manager.onConnectionEvent(event => {
    events.push(event);
  });
  
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'connected');
  assertEquals(events[0].sessionId, sessionId);
  
  manager.removeConnection(sessionId);
  
  assertEquals(events.length, 2);
  assertEquals(events[1].type, 'disconnected');
  assertEquals(events[1].sessionId, sessionId);
  
  // Test cleanup
  cleanup();
  manager.addConnection(createMockWebSocket());
  assertEquals(events.length, 2); // No new events
});

Deno.test('ConnectionManager - factory function should create instance', () => {
  const manager = createConnectionManager();
  assertExists(manager);
  
  const socket = createMockWebSocket();
  const sessionId = manager.addConnection(socket);
  assertExists(sessionId);
});

Deno.test('ConnectionManager - should handle concurrent operations safely', async () => {
  const manager = new WebSocketConnectionManager();
  const sockets: WebSocket[] = [];
  const sessionIds: string[] = [];
  
  // Add 10 connections concurrently
  const addPromises = Array.from({ length: 10 }, () => {
    const socket = createMockWebSocket();
    sockets.push(socket);
    return Promise.resolve(manager.addConnection(socket));
  });
  
  const ids = await Promise.all(addPromises);
  sessionIds.push(...ids);
  
  assertEquals(manager.getConnectionCount(), 10);
  
  // Subscribe all connections concurrently
  const subscribePromises = sessionIds.map(id => 
    Promise.resolve(manager.updateSubscription(id, 'subscribe', 'test-process'))
  );
  
  await Promise.all(subscribePromises);
  
  // Broadcast message
  const message: ServerMessage = {
    type: 'process_updated',
    payload: { id: 'test-process' } as any
  };
  
  const count = await manager.broadcastToProcess('test-process', message);
  assertEquals(count, 10);
  
  // Verify all sockets received the message
  for (const socket of sockets) {
    assertEquals((socket as any).messages.length, 1);
  }
});

Deno.test('ConnectionManager - utility methods should work correctly', () => {
  const manager = new WebSocketConnectionManager();
  
  const socket1 = createMockWebSocket();
  const socket2 = createMockWebSocket();
  
  const sessionId1 = manager.addConnection(socket1);
  const sessionId2 = manager.addConnection(socket2);
  
  // Test hasConnection
  assertEquals(manager.hasConnection(sessionId1), true);
  assertEquals(manager.hasConnection('non-existent'), false);
  
  // Test getSessionIds
  const sessionIds = manager.getSessionIds();
  assertEquals(sessionIds.length, 2);
  assertEquals(sessionIds.includes(sessionId1), true);
  assertEquals(sessionIds.includes(sessionId2), true);
  
  // Test getConnectionsByState
  const connected = manager.getConnectionsByState(WebSocketState.CONNECTED);
  assertEquals(connected.length, 2);
  
  // Test getConnectionsBySubscription
  manager.updateSubscription(sessionId1, 'subscribe', 'process-1');
  const subscribed = manager.getConnectionsBySubscription('process-1');
  assertEquals(subscribed.length, 1);
  assertEquals(subscribed[0].sessionId, sessionId1);
});