import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ProcessManager } from '../process/manager.ts';
import { StartProcessRequest, isValidStartProcessRequest } from '../process/types.ts';

/**
 * MCPProcessServer - Model Context Protocol server for process management
 * 
 * Provides MCP integration layer that connects our ProcessManager to MCP clients
 * like Claude Desktop and Claude Code. Uses stdio transport for local communication.
 */
export class MCPProcessServer {
  private readonly server: Server;
  private readonly processManager: ProcessManager;
  private transport: StdioServerTransport | null = null;
  private isStarted = false;
  private startPromise: Promise<void> | null = null;

  /**
   * Initialize MCP server with ProcessManager dependency injection
   * @param processManager - ProcessManager instance for process operations
   */
  constructor(processManager: ProcessManager) {
    if (!processManager) {
      throw new Error('ProcessManager is required');
    }
    
    this.processManager = processManager;
    
    // Initialize MCP server with configuration
    this.server = new Server(
      {
        name: 'mcp-process-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupServerHandlers();
  }

  /**
   * Start the MCP server with stdio transport
   * @returns Promise that resolves when server is started
   */
  async start(): Promise<void> {
    // Handle concurrent start attempts
    if (this.isStarted) {
      throw new Error('MCP server is already started');
    }
    
    if (this.startPromise) {
      // If another start is in progress, wait for it
      await this.startPromise;
      if (this.isStarted) {
        throw new Error('MCP server is already started');
      }
      // If the previous start failed, continue with this one
    }

    // Create the start promise to prevent concurrent starts
    this.startPromise = this.performStart();
    
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  /**
   * Perform the actual server start operation
   * @private
   */
  private async performStart(): Promise<void> {
    try {
      // Create stdio transport for local MCP client communication
      this.transport = new StdioServerTransport();
      
      // Connect server to transport
      await this.server.connect(this.transport);
      
      this.isStarted = true;
      this.logServerEvent('MCP server started successfully with stdio transport');
      
    } catch (error) {
      // Clean up transport on failure
      if (this.transport) {
        try {
          await this.transport.close();
        } catch {
          // Ignore cleanup errors
        }
        this.transport = null;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown server start error';
      this.logServerError(`Failed to start MCP server: ${errorMessage}`);
      throw new Error(`MCP server startup failed: ${errorMessage}`);
    }
  }

  /**
   * Stop the MCP server and clean up resources
   * @returns Promise that resolves when server is stopped
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      this.logServerEvent('MCP server stop requested but server is not running');
      return;
    }

    try {
      this.logServerEvent('Stopping MCP server and cleaning up resources');
      
      // Close transport connection
      if (this.transport) {
        await this.transport.close();
        this.transport = null;
      }

      // Shutdown ProcessManager to terminate all processes
      await this.processManager.shutdown({ timeout: 5000, force: false });
      
      this.isStarted = false;
      this.logServerEvent('MCP server stopped successfully');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown server stop error';
      this.logServerError(`Error during MCP server shutdown: ${errorMessage}`);
      
      // Ensure we mark as stopped even if cleanup fails
      this.isStarted = false;
      throw new Error(`MCP server shutdown failed: ${errorMessage}`);
    }
  }

  /**
   * Check if the MCP server is currently running
   * @returns true if server is started, false otherwise
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Get server information for debugging
   * @returns Object containing server status and configuration
   */
  getServerInfo(): {
    isRunning: boolean;
    hasTransport: boolean;
    processManagerStats: {
      totalProcesses: number;
      runningProcesses: number;
      failedProcesses: number;
      completedProcesses: number;
    };
  } {
    const stats = this.processManager.getProcessStats();
    
    return {
      isRunning: this.isStarted,
      hasTransport: this.transport !== null,
      processManagerStats: {
        totalProcesses: stats.totalProcesses,
        runningProcesses: stats.runningProcesses,
        failedProcesses: stats.failedProcesses,
        completedProcesses: stats.completedProcesses,
      },
    };
  }

  /**
   * Setup MCP server request handlers
   * @private
   */
  private setupServerHandlers(): void {
    // Handle tool listing requests
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      this.logServerEvent('Received list_tools request');
      
      return {
        tools: [
          {
            name: 'start_process',
            description: 'Start a new process with the specified script and arguments',
            inputSchema: {
              type: 'object',
              properties: {
                script_name: {
                  type: 'string',
                  description: 'The script or command to execute',
                },
                args: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional command line arguments',
                  default: [],
                },
                env_vars: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                  description: 'Optional environment variables',
                  default: {},
                },
                name: {
                  type: 'string',
                  description: 'Optional display name for the process',
                },
              },
              required: ['script_name'],
            },
          },
          {
            name: 'list_processes',
            description: 'List all processes with optional filtering and pagination',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['starting', 'running', 'stopped', 'failed', 'stopping'],
                  description: 'Filter by process status',
                },
                name: {
                  type: 'string',
                  description: 'Filter by process name (partial match)',
                },
                limit: {
                  type: 'number',
                  minimum: 1,
                  maximum: 100,
                  description: 'Maximum number of processes to return',
                },
                offset: {
                  type: 'number',
                  minimum: 0,
                  description: 'Number of processes to skip',
                },
              },
              required: [],
            },
          },
          {
            name: 'get_process_status',
            description: 'Get detailed status information for a specific process',
            inputSchema: {
              type: 'object',
              properties: {
                process_id: {
                  type: 'string',
                  description: 'The process ID to get status for',
                },
              },
              required: ['process_id'],
            },
          },
          {
            name: 'stop_process',
            description: 'Stop a running process with optional force termination',
            inputSchema: {
              type: 'object',
              properties: {
                process_id: {
                  type: 'string',
                  description: 'The process ID to stop',
                },
                force: {
                  type: 'boolean',
                  description: 'Use SIGKILL instead of SIGTERM',
                  default: false,
                },
                timeout: {
                  type: 'number',
                  minimum: 1000,
                  maximum: 60000,
                  description: 'Grace period before forcing termination (ms)',
                  default: 5000,
                },
              },
              required: ['process_id'],
            },
          },
          {
            name: 'get_process_logs',
            description: 'Get logs for a specific process with optional filtering',
            inputSchema: {
              type: 'object',
              properties: {
                process_id: {
                  type: 'string',
                  description: 'The process ID to get logs for',
                },
                lines: {
                  type: 'number',
                  minimum: 1,
                  maximum: 1000,
                  description: 'Maximum number of recent log lines to return',
                },
                log_type: {
                  type: 'string',
                  enum: ['stdout', 'stderr', 'system'],
                  description: 'Filter by log type',
                },
              },
              required: ['process_id'],
            },
          },
        ],
      };
    });

    // Handle tool call requests - prepared for future tool implementations
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      
      this.logServerEvent(`Received tool call: ${name}`);
      
      try {
        // Route tool calls to appropriate handlers
        switch (name) {
          case 'start_process':
            return await this.handleStartProcess(args);
          case 'list_processes':
            return await this.handleListProcesses(args);
          case 'get_process_status':
            return await this.handleGetProcessStatus(args);
          case 'stop_process':
            return await this.handleStopProcess(args);
          case 'get_process_logs':
            return await this.handleGetProcessLogs(args);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        this.logServerError(`Tool call error for ${name}: ${error}`);
        
        if (error instanceof McpError) {
          throw error;
        }
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown tool execution error';
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${errorMessage}`
        );
      }
    });

    // Handle server errors
    this.server.onerror = (error) => {
      this.logServerError(`MCP server error: ${error}`);
    };
  }

  /**
   * Handle start_process tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleStartProcess(args: unknown): Promise<CallToolResult> {
    try {
      // Validate input arguments using type guard
      const request = this.validateStartProcessArgs(args);
      
      this.logServerEvent(`Starting process: ${request.script_name} with args: ${JSON.stringify(request.args || [])}`);
      
      // Use ProcessManager to spawn the process
      const result = await this.processManager.spawnProcess(request);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to start process: ${result.error}`
        );
      }
      
      // Return success response with process details
      const processInfo = {
        processId: result.processId!,
        name: result.process!.name,
        command: result.process!.command.join(' '),
        status: result.process!.status,
        startTime: result.process!.startTime.toISOString(),
        pid: result.process!.pid
      };
      
      return {
        content: [
          {
            type: 'text',
            text: `Process '${result.process!.name}' started successfully with ID: ${result.processId}`,
          },
          {
            type: 'text',
            text: JSON.stringify(processInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`start_process error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during process creation';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to start process: ${errorMessage}`
      );
    }
  }

  /**
   * Handle list_processes tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleListProcesses(args: unknown): Promise<CallToolResult> {
    try {
      // Validate and parse arguments
      const query = this.validateListProcessesArgs(args);
      
      // Get processes from ProcessManager
      const processes = this.processManager.listProcesses(query);
      
      // Format response data
      const processData = processes.map(process => ({
        id: process.id,
        name: process.name,
        command: process.command.join(' '),
        status: process.status,
        startTime: process.startTime.toISOString(),
        endTime: process.endTime?.toISOString(),
        exitCode: process.exitCode,
        logCount: process.logs.length
      }));
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${processes.length} process(es)${query.status ? ` with status '${query.status}'` : ''}${query.name ? ` matching name '${query.name}'` : ''}`,
          },
          {
            type: 'text',
            text: JSON.stringify(processData, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`list_processes error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during process listing';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to list processes: ${errorMessage}`
      );
    }
  }

  /**
   * Handle get_process_status tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleGetProcessStatus(args: unknown): Promise<CallToolResult> {
    try {
      // Validate and extract process_id
      const processId = this.validateGetProcessStatusArgs(args);
      
      // Get process status from ProcessManager
      const process = this.processManager.getProcessStatus(processId);
      
      if (!process) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Process with ID '${processId}' not found`
        );
      }
      
      // Format detailed process information
      const processDetails = {
        id: process.id,
        name: process.name,
        command: process.command.join(' '),
        status: process.status,
        startTime: process.startTime.toISOString(),
        endTime: process.endTime?.toISOString(),
        exitCode: process.exitCode,
        pid: process.pid,
        logCount: process.logs.length,
        metadata: process.metadata
      };
      
      return {
        content: [
          {
            type: 'text',
            text: `Process '${process.name}' (${processId}) status: ${process.status}`,
          },
          {
            type: 'text',
            text: JSON.stringify(processDetails, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`get_process_status error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during process status retrieval';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to get process status: ${errorMessage}`
      );
    }
  }

  /**
   * Handle stop_process tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleStopProcess(args: unknown): Promise<CallToolResult> {
    // Tool implementation will be added in next step
    return {
      content: [
        {
          type: 'text',
          text: 'stop_process tool implementation coming in Step 13',
        },
      ],
    };
  }

  /**
   * Handle get_process_logs tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleGetProcessLogs(args: unknown): Promise<CallToolResult> {
    try {
      // Validate and extract arguments
      const { processId, lines, logType } = this.validateGetProcessLogsArgs(args);
      
      // Get process logs from ProcessManager
      const logs = this.processManager.getProcessLogs(processId, lines, logType);
      
      if (logs === undefined) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Process with ID '${processId}' not found`
        );
      }
      
      // Format log entries for display
      const formattedLogs = logs.map(log => ({
        timestamp: log.timestamp.toISOString(),
        type: log.type,
        content: log.content
      }));
      
      const filterSummary = [];
      if (lines) filterSummary.push(`last ${lines} lines`);
      if (logType) filterSummary.push(`type: ${logType}`);
      const filterText = filterSummary.length > 0 ? ` (${filterSummary.join(', ')})` : '';
      
      return {
        content: [
          {
            type: 'text',
            text: `Retrieved ${logs.length} log entr${logs.length === 1 ? 'y' : 'ies'} for process ${processId}${filterText}`,
          },
          {
            type: 'text',
            text: formattedLogs.length > 0 
              ? formattedLogs.map(log => `[${log.timestamp}] ${log.type.toUpperCase()}: ${log.content}`).join('\n')
              : 'No logs available for this process',
          },
        ],
      };
    } catch (error) {
      this.logServerError(`get_process_logs error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during log retrieval';
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Failed to get process logs: ${errorMessage}`
      );
    }
  }

  /**
   * Validate arguments for start_process tool
   * @param args - Raw arguments from MCP call
   * @returns Validated StartProcessRequest object
   * @private
   */
  private validateStartProcessArgs(args: unknown): import('../process/types.ts').StartProcessRequest {
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidRequest, 'start_process requires arguments');
    }
    
    const params = args as Record<string, unknown>;
    
    // Use the type guard for comprehensive validation
    if (!import('../process/types.ts').isValidStartProcessRequest(params)) {
      // Provide more specific error messages for common issues
      if (!params.script_name || typeof params.script_name !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'script_name is required and must be a non-empty string');
      }
      
      if (params.args !== undefined && (!Array.isArray(params.args) || !params.args.every(arg => typeof arg === 'string'))) {
        throw new McpError(ErrorCode.InvalidRequest, 'args must be an array of strings');
      }
      
      if (params.env_vars !== undefined && 
          (typeof params.env_vars !== 'object' || params.env_vars === null || Array.isArray(params.env_vars))) {
        throw new McpError(ErrorCode.InvalidRequest, 'env_vars must be an object with string values');
      }
      
      if (params.name !== undefined && typeof params.name !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'name must be a string');
      }
      
      throw new McpError(ErrorCode.InvalidRequest, 'Invalid start_process arguments');
    }
    
    return params as import('../process/types.ts').StartProcessRequest;
  }

  /**
   * Validate arguments for list_processes tool
   * @param args - Raw arguments from MCP call
   * @returns Validated ProcessQuery object
   * @private
   */
  private validateListProcessesArgs(args: unknown): import('../process/types.ts').ProcessQuery {
    if (!args || typeof args !== 'object') {
      return {}; // Empty query is valid - returns all processes
    }
    
    const query = args as Record<string, unknown>;
    const result: import('../process/types.ts').ProcessQuery = {};
    
    // Validate status filter
    if (query.status !== undefined) {
      if (typeof query.status !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'status must be a string');
      }
      const validStatuses = ['starting', 'running', 'stopped', 'failed', 'stopping'];
      if (!validStatuses.includes(query.status)) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid status '${query.status}'. Must be one of: ${validStatuses.join(', ')}`);
      }
      result.status = query.status as import('../shared/types.ts').ProcessStatus;
    }
    
    // Validate name filter
    if (query.name !== undefined) {
      if (typeof query.name !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'name must be a string');
      }
      result.name = query.name;
    }
    
    // Validate limit parameter
    if (query.limit !== undefined) {
      if (typeof query.limit !== 'number' || query.limit < 1 || query.limit > 100) {
        throw new McpError(ErrorCode.InvalidRequest, 'limit must be a number between 1 and 100');
      }
      result.limit = query.limit;
    }
    
    // Validate offset parameter
    if (query.offset !== undefined) {
      if (typeof query.offset !== 'number' || query.offset < 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'offset must be a non-negative number');
      }
      result.offset = query.offset;
    }
    
    return result;
  }

  /**
   * Validate arguments for get_process_status tool
   * @param args - Raw arguments from MCP call
   * @returns Validated process ID string
   * @private
   */
  private validateGetProcessStatusArgs(args: unknown): string {
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidRequest, 'get_process_status requires arguments');
    }
    
    const params = args as Record<string, unknown>;
    
    if (params.process_id === undefined || params.process_id === null) {
      throw new McpError(ErrorCode.InvalidRequest, 'process_id is required and must be a string');
    }
    
    if (typeof params.process_id !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'process_id is required and must be a string');
    }
    
    if (params.process_id.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, 'process_id cannot be empty');
    }
    
    return params.process_id;
  }

  /**
   * Validate arguments for get_process_logs tool
   * @param args - Raw arguments from MCP call
   * @returns Validated parameters object
   * @private
   */
  private validateGetProcessLogsArgs(args: unknown): {
    processId: string;
    lines?: number;
    logType?: 'stdout' | 'stderr' | 'system';
  } {
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidRequest, 'get_process_logs requires arguments');
    }
    
    const params = args as Record<string, unknown>;
    
    // Validate required process_id
    if (params.process_id === undefined || params.process_id === null) {
      throw new McpError(ErrorCode.InvalidRequest, 'process_id is required and must be a string');
    }
    
    if (typeof params.process_id !== 'string') {
      throw new McpError(ErrorCode.InvalidRequest, 'process_id is required and must be a string');
    }
    
    if (params.process_id.length === 0) {
      throw new McpError(ErrorCode.InvalidRequest, 'process_id cannot be empty');
    }
    
    const result = { processId: params.process_id };
    
    // Validate optional lines parameter
    if (params.lines !== undefined) {
      if (typeof params.lines !== 'number' || params.lines < 1 || params.lines > 1000) {
        throw new McpError(ErrorCode.InvalidRequest, 'lines must be a number between 1 and 1000');
      }
      (result as any).lines = params.lines;
    }
    
    // Validate optional log_type parameter
    if (params.log_type !== undefined) {
      if (typeof params.log_type !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'log_type must be a string');
      }
      const validLogTypes = ['stdout', 'stderr', 'system'];
      if (!validLogTypes.includes(params.log_type)) {
        throw new McpError(ErrorCode.InvalidRequest, `Invalid log_type '${params.log_type}'. Must be one of: ${validLogTypes.join(', ')}`);
      }
      (result as any).logType = params.log_type as 'stdout' | 'stderr' | 'system';
    }
    
    return result;
  }

  /**
   * Log server events for debugging and monitoring
   * @param message - The log message
   * @private
   */
  private logServerEvent(message: string): void {
    console.log(`[MCPProcessServer] ${message}`);
  }

  /**
   * Log server errors for debugging and monitoring
   * @param message - The error message
   * @private
   */
  private logServerError(message: string): void {
    console.error(`[MCPProcessServer] ERROR: ${message}`);
  }
}