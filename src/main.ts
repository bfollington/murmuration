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

/**
 * Initialize and start the MCP Process Server
 */
async function main(): Promise<void> {
  // In MCP mode, we must suppress all console output to avoid interfering with JSON-RPC
  const isMCPMode = !Deno.env.get('DEBUG') && !Deno.stdout.isTerminal();
  
  // Create a logger that respects MCP mode
  const log = (message: string) => {
    if (!isMCPMode) {
      console.log(message);
    }
  };
  
  const logError = (message: string, error?: unknown) => {
    if (!isMCPMode) {
      console.error(message, error);
    }
  };
  
  log('[Main] Starting MCP Process Server...');
  
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
    
    // Create MCP server with ProcessManager dependency injection
    const mcpServer = new MCPProcessServer(processManager);
    
    // Start the MCP server
    log('[Main] Starting MCP server with stdio transport...');
    await mcpServer.start();
    
    log('[Main] MCP Process Server is running and ready for client connections');
    log('[Main] Server Info: ' + JSON.stringify(mcpServer.getServerInfo(), null, 2));
    
    // Handle graceful shutdown on SIGINT (Ctrl+C)
    const handleShutdown = async (signal: string) => {
      log(`[Main] Received ${signal}, shutting down gracefully...`);
      
      try {
        await mcpServer.stop();
        log('[Main] MCP server stopped successfully');
        Deno.exit(0);
      } catch (error) {
        logError('[Main] Error during shutdown:', error);
        Deno.exit(1);
      }
    };
    
    // Set up signal handlers for graceful shutdown
    Deno.addSignalListener('SIGINT', () => handleShutdown('SIGINT'));
    Deno.addSignalListener('SIGTERM', () => handleShutdown('SIGTERM'));
    
    // Keep the process running
    log('[Main] Press Ctrl+C to stop the server');
    
    // Wait indefinitely - the server handles all client communication via stdio
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Optionally log server stats periodically
      if (Deno.env.get('DEBUG') === 'true') {
        const info = mcpServer.getServerInfo();
        log('[Main] Server Stats: ' + JSON.stringify(info.processManagerStats));
      }
    }
    
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
    console.error('[Main] Unhandled error:', error);
    Deno.exit(1);
  });
}