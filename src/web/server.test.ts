import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { WebSocketServer } from './server.ts';
import { delay } from 'https://deno.land/std@0.208.0/async/delay.ts';

/**
 * Helper to create a WebSocket client for testing
 */
async function createTestClient(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let timeoutId: number | undefined;
    
    socket.onopen = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      resolve(socket);
    };
    
    socket.onerror = (error) => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      reject(error);
    };
    
    // Timeout after 2 seconds
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      reject(new Error('Connection timeout'));
    }, 2000);
  });
}

/**
 * Helper to wait for WebSocket to close
 */
async function waitForClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    socket.onclose = (event) => resolve(event);
  });
}

/**
 * Find an available port for testing
 */
async function findAvailablePort(startPort = 8080): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      const server = Deno.listen({ port });
      server.close();
      return port;
    } catch {
      // Port in use, try next
      continue;
    }
  }
  throw new Error('No available ports found');
}

Deno.test('WebSocketServer - should start and stop cleanly', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  
  // Start server
  await server.start();
  assertEquals(server.isRunning(), true);
  
  // Stop server
  await server.stop();
  assertEquals(server.isRunning(), false);
});

Deno.test('WebSocketServer - should reject start when already running', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  
  await server.start();
  try {
    await assertRejects(
      () => server.start(),
      Error,
      'Server is already running'
    );
  } finally {
    await server.stop();
  }
});

Deno.test('WebSocketServer - should accept WebSocket connections', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  
  await server.start();
  
  try {
    // Connect a client
    const client = await createTestClient(`ws://localhost:${port}/ws`);
    assertEquals(client.readyState, WebSocket.OPEN);
    assertEquals(server.getConnectionCount(), 1);
    
    // Close the client
    client.close();
    await waitForClose(client);
    
    // Give server time to process the close
    await delay(100);
    assertEquals(server.getConnectionCount(), 0);
  } finally {
    await server.stop();
  }
});

Deno.test('WebSocketServer - should handle multiple concurrent connections', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  
  await server.start();
  
  const clients: WebSocket[] = [];
  try {
    // Connect multiple clients
    for (let i = 0; i < 5; i++) {
      const client = await createTestClient(`ws://localhost:${port}/ws`);
      clients.push(client);
    }
    
    assertEquals(server.getConnectionCount(), 5);
    
    // Close all clients
    for (const client of clients) {
      client.close();
    }
    
    // Wait for all to close
    await Promise.all(clients.map(client => waitForClose(client)));
    
    // Give server time to process closes
    await delay(100);
    assertEquals(server.getConnectionCount(), 0);
  } finally {
    // Clean up any remaining clients
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
    await server.stop();
  }
});

Deno.test('WebSocketServer - should respect maxConnections limit', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port, maxConnections: 2 });
  
  await server.start();
  
  const clients: WebSocket[] = [];
  try {
    // Connect up to the limit
    const client1 = await createTestClient(`ws://localhost:${port}/ws`);
    const client2 = await createTestClient(`ws://localhost:${port}/ws`);
    clients.push(client1, client2);
    
    assertEquals(server.getConnectionCount(), 2);
    
    // Try to connect beyond the limit
    const response = await fetch(`http://localhost:${port}/ws`, {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version': '13',
      },
    });
    
    assertEquals(response.status, 503);
    assertEquals(await response.text(), 'Service Unavailable - Maximum connections reached');
  } finally {
    // Clean up clients
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
    await server.stop();
  }
});

Deno.test('WebSocketServer - should handle health check endpoint', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port, maxConnections: 10 });
  
  await server.start();
  
  try {
    const response = await fetch(`http://localhost:${port}/health`);
    assertEquals(response.status, 200);
    
    const data = await response.json();
    assertEquals(data.status, 'ok');
    assertEquals(data.connections, 0);
    assertEquals(data.maxConnections, 10);
  } finally {
    await server.stop();
  }
});

Deno.test('WebSocketServer - should return 404 for unknown paths', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  
  await server.start();
  
  try {
    const response = await fetch(`http://localhost:${port}/unknown`);
    assertEquals(response.status, 404);
    assertEquals(await response.text(), 'Not Found');
  } finally {
    await server.stop();
  }
});

Deno.test('WebSocketServer - should handle graceful shutdown with connected clients', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  
  await server.start();
  
  const clients: WebSocket[] = [];
  const closeEvents: CloseEvent[] = [];
  
  try {
    // Connect multiple clients
    for (let i = 0; i < 3; i++) {
      const client = await createTestClient(`ws://localhost:${port}/ws`);
      clients.push(client);
      
      // Track close events
      client.onclose = (event) => closeEvents.push(event);
    }
    
    assertEquals(server.getConnectionCount(), 3);
    
    // Initiate server shutdown
    await server.stop({ closeCode: 1001, closeReason: 'Test shutdown' });
    
    // Give time for close events to propagate
    await delay(100);
    
    // Verify all clients were closed
    assertEquals(closeEvents.length, 3);
    for (const event of closeEvents) {
      assertEquals(event.code, 1001);
      assertEquals(event.reason, 'Test shutdown');
    }
    
    assertEquals(server.getConnectionCount(), 0);
  } finally {
    // Clean up any remaining clients
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.close();
      }
    }
  }
});

Deno.test('WebSocketServer - should handle server status correctly', async () => {
  const port = await findAvailablePort();
  const config = {
    port,
    hostname: '127.0.0.1',
    path: '/websocket',
    maxConnections: 50,
  };
  const server = new WebSocketServer(config);
  
  // Check initial status
  let status = server.getStatus();
  assertEquals(status.running, false);
  assertEquals(status.connections, 0);
  assertEquals(status.maxConnections, 50);
  assertEquals(status.config.port, port);
  assertEquals(status.config.hostname, '127.0.0.1');
  assertEquals(status.config.path, '/websocket');
  
  // Start server and check status
  await server.start();
  status = server.getStatus();
  assertEquals(status.running, true);
  
  // Stop server and check status
  await server.stop();
  status = server.getStatus();
  assertEquals(status.running, false);
});

Deno.test('WebSocketServer - should handle connection errors', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  
  await server.start();
  
  try {
    // Make a non-WebSocket request to the WebSocket endpoint
    const response = await fetch(`http://localhost:${port}/ws`);
    assertEquals(response.status, 400);
    assertEquals(await response.text(), 'Expected WebSocket upgrade');
  } finally {
    await server.stop();
  }
});