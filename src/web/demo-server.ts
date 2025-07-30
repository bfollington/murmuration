#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Demo script to run the WebSocket server standalone for testing
 * 
 * Usage:
 *   deno run --allow-net --allow-env src/web/demo-server.ts [port]
 */

import { WebSocketServer } from './server.ts';

const port = Deno.args[0] ? parseInt(Deno.args[0]) : 8080;

console.log('🚀 Starting WebSocket Server Demo');
console.log('==================================');

const server = new WebSocketServer({
  port,
  hostname: '0.0.0.0',
  path: '/ws',
  maxConnections: 10,
});

// Start the server
try {
  await server.start();
  console.log(`\n✅ WebSocket server is running!`);
  console.log(`📡 WebSocket URL: ws://localhost:${port}/ws`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log(`\nPress Ctrl+C to stop the server`);
  
  // Handle shutdown signals
  const shutdown = async () => {
    console.log('\n\n🛑 Shutting down server...');
    await server.stop();
    console.log('👋 Server stopped. Goodbye!');
    Deno.exit(0);
  };
  
  Deno.addSignalListener('SIGINT', shutdown);
  Deno.addSignalListener('SIGTERM', shutdown);
  
  // Keep the process running
  await new Promise(() => {});
} catch (error) {
  console.error('❌ Failed to start server:', error);
  Deno.exit(1);
}