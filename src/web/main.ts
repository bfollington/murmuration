#!/usr/bin/env -S deno run --allow-all

/**
 * Web server main entry point
 * 
 * Runs the WebSocket server for process management.
 * Can be run standalone or alongside the MCP server.
 */

import { ProcessRegistry } from '../process/registry.ts';
import { ProcessManager } from '../process/manager.ts';
import { FileKnowledgeManager } from '../knowledge/file-manager.ts';
import { IntegratedQueueManager } from '../queue/integrated-manager.ts';
import { WebSocketServer } from './server.ts';
import { ProcessWebSocketHandlers } from './handlers.ts';
import { KnowledgeWebSocketHandlers } from './knowledge-handlers.ts';
import { logger } from '../shared/logger.ts';

/**
 * Set up event listeners for real-time WebSocket updates
 */
function setupEventListeners(
  server: WebSocketServer,
  processManager: ProcessManager,
  knowledgeManager: FileKnowledgeManager,
  queueManager: IntegratedQueueManager
) {
  // Listen for process events
  processManager.on('process:started', (data) => {
    server.broadcast({
      type: 'process_started',
      data: { processId: data.processId, process: data.process },
    });
  });

  processManager.on('process:stopped', (data) => {
    server.broadcast({
      type: 'process_stopped',
      data: { processId: data.processId, process: data.process },
    });
  });

  processManager.on('process:failed', (data) => {
    server.broadcast({
      type: 'process_failed',
      data: { processId: data.processId, process: data.process, error: data.error },
    });
  });

  processManager.on('process:state_changed', (data) => {
    server.broadcast({
      type: 'process_state_changed',
      data: { processId: data.processId, from: data.from, to: data.to },
    });
  });

  // Throttled log broadcasting
  let logTimeout: number | undefined;
  const pendingLogs = new Map<string, unknown[]>();

  processManager.on('process:log_added', (data) => {
    const logs = pendingLogs.get(data.processId) || [];
    logs.push(data.log);
    pendingLogs.set(data.processId, logs);

    if (!logTimeout) {
      logTimeout = setTimeout(() => {
        for (const [processId, logs] of pendingLogs) {
          server.broadcast({
            type: 'process_logs_updated',
            data: { processId, logs },
          });
        }
        pendingLogs.clear();
        logTimeout = undefined;
      }, 100);
    }
  });

  // Knowledge event listeners
  knowledgeManager.on('knowledge:created', (data: any) => {
    server.broadcast({
      type: 'knowledge_updated',
      data: { entry: data.entry },
    });
  });

  knowledgeManager.on('knowledge:updated', (data: any) => {
    server.broadcast({
      type: 'knowledge_updated',
      data: { entry: data.entry },
    });
  });

  knowledgeManager.on('knowledge:deleted', (data: any) => {
    server.broadcast({
      type: 'knowledge_deleted',
      data: { entryId: data.entryId },
    });
  });

  // Queue event listeners
  queueManager.on('queue:entry_added', (data: any) => {
    server.broadcast({
      type: 'queue_entry_updated',
      data: { entry: data.entry },
    });
  });

  queueManager.on('queue:entry_started', (data: any) => {
    server.broadcast({
      type: 'queue_entry_updated',
      data: { entry: data.entry },
    });
  });

  queueManager.on('queue:entry_completed', (data: any) => {
    server.broadcast({
      type: 'queue_entry_updated',
      data: { entry: data.entry },
    });
  });

  queueManager.on('queue:entry_failed', (data: any) => {
    server.broadcast({
      type: 'queue_entry_updated',
      data: { entry: data.entry },
    });
  });

  logger.log('Main', 'Event listeners set up for real-time updates');
}

/**
 * Set up file system watching for knowledge directory changes
 */
async function setupFileSystemWatching(
  server: WebSocketServer,
  knowledgeManager: FileKnowledgeManager
) {
  try {
    const knowledgeDir = '.knowledge';
    
    // Check if knowledge directory exists
    try {
      await Deno.stat(knowledgeDir);
    } catch {
      logger.log('Main', 'Knowledge directory not found, skipping file watching');
      return;
    }

    const watcher = Deno.watchFs(knowledgeDir, { recursive: true });
    
    logger.log('Main', `Started watching ${knowledgeDir} for file changes`);
    
    // Handle file system events in the background
    (async () => {
      try {
        for await (const event of watcher) {
          // Only process markdown files
          const isMarkdownFile = event.paths.some(path => path.endsWith('.md'));
          if (!isMarkdownFile) continue;

          logger.debug('Main', `File system event: ${event.kind} on ${event.paths.join(', ')}`);

          // Broadcast knowledge update to all connected clients
          // This will trigger clients to refresh their knowledge data
          server.broadcast({
            type: 'knowledge_file_changed',
            data: {
              event: event.kind,
              paths: event.paths,
              timestamp: new Date().toISOString(),
            },
          });
        }
      } catch (error) {
        logger.error('Main', 'File watcher error', error);
      }
    })();
  } catch (error) {
    logger.error('Main', 'Failed to set up file system watching', error);
  }
}

async function main() {
  logger.log('Main', 'Starting Process Management Web Server');

  // Create shared instances
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  
  // Create FileKnowledgeManager for Q&A and notes
  const knowledgeManager = new FileKnowledgeManager();
  
  // Create IntegratedQueueManager for process queuing
  const queueManager = new IntegratedQueueManager(processManager, {
    maxConcurrentProcesses: 5,
    autoStart: true,
    persistInterval: 30000,
    restoreOnStartup: true,
    persistPath: './queue-state.json'
  });

  // Create WebSocket server
  const port = parseInt(Deno.env.get('WS_PORT') || '8080');
  const server = new WebSocketServer({
    port,
    hostname: '0.0.0.0',
    path: '/ws',
  });

  // Set up message handlers
  const processHandlers = new ProcessWebSocketHandlers(processManager);
  server.registerHandler('list_processes', processHandlers.handleListProcesses.bind(processHandlers));
  server.registerHandler('start_process', processHandlers.handleStartProcess.bind(processHandlers));
  server.registerHandler('stop_process', processHandlers.handleStopProcess.bind(processHandlers));
  server.registerHandler('get_process_status', processHandlers.handleGetProcessStatus.bind(processHandlers));
  server.registerHandler('get_process_logs', processHandlers.handleGetProcessLogs.bind(processHandlers));

  // Set up knowledge handlers
  const knowledgeHandlers = new KnowledgeWebSocketHandlers(knowledgeManager);
  server.registerHandler('list_knowledge', knowledgeHandlers.handleListKnowledge.bind(knowledgeHandlers));
  server.registerHandler('create_question', knowledgeHandlers.handleCreateQuestion.bind(knowledgeHandlers));
  server.registerHandler('create_answer', knowledgeHandlers.handleCreateAnswer.bind(knowledgeHandlers));
  server.registerHandler('create_note', knowledgeHandlers.handleCreateNote.bind(knowledgeHandlers));
  server.registerHandler('create_issue', knowledgeHandlers.handleCreateIssue.bind(knowledgeHandlers));
  server.registerHandler('get_knowledge_stats', knowledgeHandlers.handleGetKnowledgeStats.bind(knowledgeHandlers));

  try {
    await server.start();
    logger.log('Main', `WebSocket server started on port ${port}`);
    logger.log('Main', 'Open http://localhost:8080 in a browser to test');

    // Set up event listeners for real-time updates
    setupEventListeners(server, processManager, knowledgeManager, queueManager);
    
    // Set up file system watching for knowledge directory
    setupFileSystemWatching(server, knowledgeManager);

    // Handle shutdown signals
    const shutdown = async () => {
      logger.log('Main', 'Shutting down...');
      
      // Stop all processes
      await processManager.shutdown();
      
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