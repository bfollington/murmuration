#!/usr/bin/env -S deno run --allow-all

/**
 * Web server main entry point
 * 
 * Runs the WebSocket server for process management.
 * Can be run standalone or alongside the MCP server.
 */

import { ProcessRegistry } from '../process/registry.ts';
import { ProcessManager } from '../process/manager.ts';
import { KnowledgeManager } from '../knowledge/manager.ts';
import { IntegratedQueueManager } from '../queue/integrated-manager.ts';
import { SimpleWebSocketServer } from './server-simple.ts';
import { logger } from '../shared/logger.ts';

async function main() {
  logger.log('Main', 'Starting Process Management Web Server');

  // Create shared instances
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  
  // Create KnowledgeManager for Q&A and notes
  const knowledgeManager = new KnowledgeManager();
  
  // Create IntegratedQueueManager for process queuing
  const queueManager = new IntegratedQueueManager(processManager, {
    maxConcurrentProcesses: 5,
    autoStart: true,
    persistInterval: 30000,
    restoreOnStartup: true,
    persistPath: './queue-state.json'
  });

  // Create and start WebSocket server
  const port = parseInt(Deno.env.get('WS_PORT') || '8080');
  const server = new SimpleWebSocketServer(processManager, knowledgeManager, queueManager, {
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
      
      // Shutdown the queue manager
      await queueManager.shutdown();
      
      // Save knowledge if needed
      await knowledgeManager.save();
      
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