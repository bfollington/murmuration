#!/usr/bin/env -S deno run --allow-run --allow-net --allow-read --allow-write --allow-env

/**
 * Main entry point for the MCP Process Server
 * 
 * This demonstrates how to integrate the MCPProcessServer with ProcessManager
 * and start the MCP server for use with Claude Desktop and Claude Code.
 */

import { MCPProcessServer } from './mcp/server.ts';
import { ProcessManager } from './process/manager.ts';
import { ProcessRegistry } from './process/registry.ts';
import { ProcessMonitoringConfig } from './process/types.ts';
import { FileKnowledgeManager } from './knowledge/file-manager.ts';
import { IntegratedQueueManager } from './queue/integrated-manager.ts';
import { MilestoneManager } from './knowledge/milestone-manager.ts';

/**
 * Initialize and start the MCP Process Server
 */
async function main(): Promise<void> {
  // Always suppress console output unless DEBUG is explicitly set
  // This ensures compatibility with MCP clients like Claude Code
  const debugMode = Deno.env.get('DEBUG') === 'true';
  
  // Create a logger that only outputs in debug mode
  const log = (message: string) => {
    if (debugMode) {
      console.error(`[DEBUG] ${message}`); // Use stderr for debug logs
    }
  };
  
  const logError = (message: string, error?: unknown) => {
    if (debugMode) {
      console.error(`[ERROR] ${message}`, error);
    }
  };
  
  try {
    // Create ProcessRegistry for process storage
    const registry = new ProcessRegistry();
    
    // Configure process monitoring
    const monitoringConfig: ProcessMonitoringConfig = {
      logBufferSize: 1000,
      heartbeatInterval: 5000,
      maxRestarts: 3
    };
    
    // Create ProcessManager with registry and monitoring config
    const processManager = new ProcessManager(registry, monitoringConfig);
    
    // Create FileKnowledgeManager for Q&A, notes, and issues
    const knowledgeManager = new FileKnowledgeManager();
    
    // Create IntegratedQueueManager for process queuing
    const queueManager = new IntegratedQueueManager(processManager, {
      maxConcurrentProcesses: 5,
      autoStart: true,
      persistInterval: 30000,
      restoreOnStartup: true,
      persistPath: './queue-state.json'
    });
    
    // Create MilestoneManager for milestone tracking
    const milestoneManager = new MilestoneManager();
    
    // Create MCP server with all manager dependencies
    const mcpServer = new MCPProcessServer(processManager, knowledgeManager, queueManager, milestoneManager);
    
    // Start the MCP server
    await mcpServer.start();
    
    // Handle graceful shutdown on SIGINT (Ctrl+C)
    const handleShutdown = async (signal: string) => {
      try {
        // Stop the MCP server (which also shuts down ProcessManager)
        await mcpServer.stop();
        
        // Shutdown the queue manager
        await queueManager.shutdown();
        
        // FileKnowledgeManager saves automatically, no manual save needed
        
        Deno.exit(0);
      } catch (error) {
        // In MCP mode, we cannot log errors during shutdown
        Deno.exit(1);
      }
    };
    
    // Set up signal handlers for graceful shutdown
    Deno.addSignalListener('SIGINT', () => handleShutdown('SIGINT'));
    Deno.addSignalListener('SIGTERM', () => handleShutdown('SIGTERM'));
    
    // Wait indefinitely - the server handles all client communication via stdio
    await new Promise(() => {}); // Never resolves, keeps process alive
    
  } catch (error) {
    logError('[Main] Failed to start MCP Process Server:', error);
    Deno.exit(1);
  }
}

/**
 * Entry point with error handling
 */
if (import.meta.main) {
  main().catch((error) => {
    // Only log errors if not in MCP mode
    const isMCPMode = !Deno.env.get('DEBUG') && !Deno.stdout.isTerminal();
    if (!isMCPMode) {
      console.error('[Main] Unhandled error:', error);
    }
    Deno.exit(1);
  });
}