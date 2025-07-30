#!/usr/bin/env -S deno run --allow-all

/**
 * Web server main entry point
 * 
 * Runs the WebSocket server for process management.
 * Can be run standalone or alongside the MCP server.
 */

import { ProcessRegistry } from '../process/registry.ts';
import { ProcessManager } from '../process/manager.ts';
import { SimpleWebSocketServer } from './server-simple.ts';
import { logger } from '../shared/logger.ts';

async function main() {
  logger.log('Main', 'Starting Process Management Web Server');

  // Create shared instances
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);

  // Create and start WebSocket server
  const port = parseInt(Deno.env.get('WS_PORT') || '8080');
  const server = new SimpleWebSocketServer(processManager, {
    port,
    hostname: '0.0.0.0',
    path: '/ws',
  });

  try {
    await server.start();
    logger.log('Main', `WebSocket server started on port ${port}`);
    logger.log('Main', 'Open src/web/client.html in a browser to test');

    // Handle shutdown signals
    const shutdown = async () => {
      logger.log('Main', 'Shutting down...');
      
      // Stop all processes
      await processManager.stopAllProcesses();
      
      // Stop WebSocket server
      await server.stop();
      
      logger.log('Main', 'Shutdown complete');
      Deno.exit(0);
    };

    Deno.addSignalListener('SIGINT', shutdown);
    Deno.addSignalListener('SIGTERM', shutdown);

    // Keep the process running
    await new Promise(() => {});
  } catch (error) {
    logger.error('Main', 'Failed to start server', error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}