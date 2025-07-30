#!/usr/bin/env -S deno run --allow-net

/**
 * Simple WebSocket test client for manual testing of the WebSocket server
 * 
 * Usage:
 *   deno run --allow-net src/web/test-client.ts [port]
 */

const port = Deno.args[0] ? parseInt(Deno.args[0]) : 8080;
const url = `ws://localhost:${port}/ws`;

console.log(`Connecting to WebSocket server at ${url}...`);

try {
  const socket = new WebSocket(url);
  
  socket.onopen = () => {
    console.log('✅ Connected to WebSocket server');
    console.log('Connection state:', socket.readyState === WebSocket.OPEN ? 'OPEN' : 'NOT OPEN');
    
    // Send a test message (will be ignored in Step 3)
    console.log('Sending test message...');
    socket.send(JSON.stringify({
      type: 'ping',
      payload: { timestamp: Date.now() }
    }));
    
    // Schedule disconnect after 5 seconds
    console.log('Will disconnect in 5 seconds...');
    setTimeout(() => {
      console.log('Closing connection...');
      socket.close(1000, 'Test complete');
    }, 5000);
  };
  
  socket.onmessage = (event) => {
    console.log('📥 Message received:', event.data);
  };
  
  socket.onclose = (event) => {
    console.log(`❌ Connection closed - Code: ${event.code}, Reason: ${event.reason || 'none'}`);
    Deno.exit(0);
  };
  
  socket.onerror = (error) => {
    console.error('❗ WebSocket error:', error);
  };
  
  // Handle Ctrl+C
  Deno.addSignalListener('SIGINT', () => {
    console.log('\nReceived SIGINT, closing connection...');
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1000, 'User interrupted');
    }
    Deno.exit(0);
  });
  
} catch (error) {
  console.error('Failed to create WebSocket:', error);
  Deno.exit(1);
}