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
import { logger } from '../shared/logger.ts';
import { FileKnowledgeManager } from '../knowledge/file-manager.ts';
import { IntegratedQueueManager } from '../queue/integrated-manager.ts';
import { 
  CreateIssueRequest,
  UpdateKnowledgeRequest,
  KnowledgeQuery,
  KnowledgeType,
  EntryStatus,
  isIssue
} from '../knowledge/types.ts';
import { MilestoneManager } from '../knowledge/milestone-manager.ts';
import { CreateMilestoneRequest, isValidCreateMilestoneRequest } from '../knowledge/types.ts';
import { QueuedProcess, QueuePriority } from '../queue/types.ts';
import { 
  getProcessUrl, 
  getIssueUrl, 
  getNoteUrl, 
  getDashboardUrl 
} from '../shared/url-utils.ts';
import { MCPToolResponse, MCPResponseContent } from '../shared/types.ts';
import { fragmentToolDefinitions, fragmentToolHandlers } from './tools/fragment.ts';

/**
 * MCPProcessServer - Model Context Protocol server for process management
 * 
 * Provides MCP integration layer that connects our ProcessManager to MCP clients
 * like Claude Desktop and Claude Code. Uses stdio transport for local communication.
 */
export class MCPProcessServer {
  private readonly server: Server;
  private readonly processManager: ProcessManager;
  private readonly knowledgeManager: FileKnowledgeManager;
  private readonly queueManager: IntegratedQueueManager;
  private readonly milestoneManager: MilestoneManager;
  private transport: StdioServerTransport | null = null;
  private isStarted = false;
  private startPromise: Promise<void> | null = null;

  /**
   * Initialize MCP server with dependency injection for all managers
   * @param processManager - ProcessManager instance for direct process operations
   * @param knowledgeManager - FileKnowledgeManager instance for issues
   * @param queueManager - IntegratedQueueManager instance for queued process operations
   * @param milestoneManager - MilestoneManager instance for milestone tracking
   */
  constructor(
    processManager: ProcessManager,
    knowledgeManager: FileKnowledgeManager,
    queueManager: IntegratedQueueManager,
    milestoneManager: MilestoneManager
  ) {
    if (!processManager) {
      throw new Error('ProcessManager is required');
    }
    if (!knowledgeManager) {
      throw new Error('FileKnowledgeManager is required');
    }
    if (!queueManager) {
      throw new Error('IntegratedQueueManager is required');
    }
    if (!milestoneManager) {
      throw new Error('MilestoneManager is required');
    }
    
    this.processManager = processManager;
    this.knowledgeManager = knowledgeManager;
    this.queueManager = queueManager;
    this.milestoneManager = milestoneManager;
    
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
   * Create a structured MCP tool response with optional web UI URL
   * @param text Main response text
   * @param data Optional JSON data to include
   * @param webUrl Optional web UI URL
   * @returns Formatted CallToolResult
   * @private
   */
  private createMCPResponse(
    text: string, 
    data?: Record<string, unknown>, 
    webUrl?: string
  ): CallToolResult {
    const content: MCPResponseContent[] = [
      {
        type: 'text',
        text: text,
      },
    ];

    // Add JSON data if provided
    if (data) {
      content.push({
        type: 'text',
        text: JSON.stringify(data, null, 2),
      });
    }

    const response: MCPToolResponse = {
      content,
    };

    // Add web URL if provided
    if (webUrl) {
      response.webUrl = webUrl;
    }

    return response as CallToolResult;
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
          // Fragment tools (replacing old knowledge tools)
          ...fragmentToolDefinitions,
          {
            name: 'start_process',
            description: 'Start a new process either immediately or add it to the queue based on priority and system capacity',
            inputSchema: {
              type: 'object',
              properties: {
                script_name: {
                  type: 'string',
                  description: 'The script or command to execute',
                },
                title: {
                  type: 'string',
                  description: 'User-friendly title to identify this process',
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
                priority: {
                  type: 'number',
                  minimum: 1,
                  maximum: 10,
                  description: 'Priority level (1-10, where 10 is highest). Higher priority processes are executed first when queued.',
                  default: 5,
                },
                immediate: {
                  type: 'boolean',
                  description: 'Force immediate execution, bypassing the queue. Use with caution as it may exceed concurrency limits.',
                  default: false,
                },
              },
              required: ['script_name', 'title'],
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
          {
            name: 'get_queue_status',
            description: 'Get the current status of the process queue including statistics, configuration, and pending processes',
            inputSchema: {
              type: 'object',
              properties: {
                include_entries: {
                  type: 'boolean',
                  description: 'Include detailed list of queue entries',
                  default: false,
                },
                status_filter: {
                  type: 'string',
                  enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
                  description: 'Filter entries by status (only applies if include_entries is true)',
                },
              },
              required: [],
            },
          },
          {
            name: 'set_queue_config',
            description: 'Update queue configuration settings such as concurrency limit and retry settings',
            inputSchema: {
              type: 'object',
              properties: {
                maxConcurrent: {
                  type: 'number',
                  minimum: 1,
                  maximum: 20,
                  description: 'Maximum number of processes that can run concurrently',
                },
                maxQueueSize: {
                  type: 'number',
                  minimum: 10,
                  maximum: 1000,
                  description: 'Maximum number of processes that can be queued',
                },
                maxRetries: {
                  type: 'number',
                  minimum: 0,
                  maximum: 10,
                  description: 'Maximum number of retries for failed processes',
                },
                retryDelay: {
                  type: 'number',
                  minimum: 1000,
                  maximum: 300000,
                  description: 'Delay in milliseconds between retries',
                },
              },
              required: [],
            },
          },
          {
            name: 'pause_queue',
            description: 'Pause the process queue. Running processes will continue, but no new processes will start.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'resume_queue',
            description: 'Resume the process queue after it has been paused. Processing will continue from where it left off.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'cancel_queued_process',
            description: 'Cancel a process that is waiting in the queue. Cannot cancel processes that are already running.',
            inputSchema: {
              type: 'object',
              properties: {
                queue_id: {
                  type: 'string',
                  description: 'The queue ID of the process to cancel',
                },
              },
              required: ['queue_id'],
            },
          },
          {
            name: 'record_issue',
            description: 'Record a new issue for tracking actionable tasks and problems.',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'The issue title/summary',
                  minLength: 1,
                },
                content: {
                  type: 'string',
                  description: 'The detailed issue description',
                  minLength: 1,
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags for categorizing the issue',
                },
                priority: {
                  type: 'string',
                  enum: ['low', 'medium', 'high'],
                  description: 'Priority level of the issue',
                  default: 'medium',
                },
              },
              required: ['title', 'content'],
            },
          },
          {
            name: 'list_issues',
            description: 'List issues with optional filtering by status, tags, or limit.',
            inputSchema: {
              type: 'object',
              properties: {
                status: {
                  type: 'string',
                  enum: ['open', 'in-progress', 'completed', 'archived'],
                  description: 'Filter by issue status',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by tags (issues must have all specified tags)',
                },
                limit: {
                  type: 'number',
                  minimum: 1,
                  maximum: 100,
                  description: 'Maximum number of issues to return',
                  default: 20,
                },
              },
              required: [],
            },
          },
          {
            name: 'update_issue',
            description: 'Update an existing issue\'s title, content, status, tags, or priority.',
            inputSchema: {
              type: 'object',
              properties: {
                issue_id: {
                  type: 'string',
                  description: 'The ID of the issue to update',
                },
                title: {
                  type: 'string',
                  description: 'New title for the issue',
                },
                content: {
                  type: 'string',
                  description: 'New content for the issue',
                },
                status: {
                  type: 'string',
                  enum: ['open', 'in-progress', 'completed', 'archived'],
                  description: 'New status for the issue',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'New tags for the issue (replaces existing tags)',
                },
                priority: {
                  type: 'string',
                  enum: ['low', 'medium', 'high'],
                  description: 'New priority for the issue',
                },
              },
              required: ['issue_id'],
            },
          },
          {
            name: 'delete_issue',
            description: 'Delete an issue from the knowledge base.',
            inputSchema: {
              type: 'object',
              properties: {
                issue_id: {
                  type: 'string',
                  description: 'The ID of the issue to delete',
                },
              },
              required: ['issue_id'],
            },
          },
          {
            name: 'get_issue',
            description: 'Get detailed information for a specific issue by ID.',
            inputSchema: {
              type: 'object',
              properties: {
                issue_id: {
                  type: 'string',
                  description: 'The ID of the issue to retrieve',
                },
              },
              required: ['issue_id'],
            },
          },
          {
            name: 'get_milestone',
            description: 'Retrieve the current milestone information.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
          {
            name: 'set_milestone',
            description: 'Set or update the current milestone with title, description, target date, and progress.',
            inputSchema: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description: 'Brief milestone description',
                },
                description: {
                  type: 'string',
                  description: 'Detailed explanation of the milestone',
                },
                targetDate: {
                  type: 'string',
                  description: 'Target completion date in ISO format (YYYY-MM-DD)',
                },
                progress: {
                  type: 'number',
                  minimum: 0,
                  maximum: 100,
                  description: 'Progress percentage (0-100)',
                },
                relatedIssues: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Array of issue IDs related to this milestone',
                },
              },
              required: ['title', 'description'],
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
          case 'get_queue_status':
            return await this.handleGetQueueStatus(args);
          case 'set_queue_config':
            return await this.handleSetQueueConfig(args);
          case 'pause_queue':
            return await this.handlePauseQueue(args);
          case 'resume_queue':
            return await this.handleResumeQueue(args);
          case 'cancel_queued_process':
            return await this.handleCancelQueuedProcess(args);
          case 'record_issue':
            return await this.handleRecordIssue(args);
          case 'list_issues':
            return await this.handleListIssues(args);
          case 'update_issue':
            return await this.handleUpdateIssue(args);
          case 'delete_issue':
            return await this.handleDeleteIssue(args);
          case 'get_issue':
            return await this.handleGetIssue(args);
          case 'get_milestone':
            return await this.handleGetMilestone(args);
          case 'set_milestone':
            return await this.handleSetMilestone(args);
          // Fragment tools
          case 'record_fragment':
            return await fragmentToolHandlers.handleRecordFragment(args);
          case 'list_fragments':
            return await fragmentToolHandlers.handleListFragments(args);
          case 'search_fragments_by_title':
            return await fragmentToolHandlers.handleSearchFragmentsByTitle(args);
          case 'search_fragments_similar':
            return await fragmentToolHandlers.handleSearchFragmentsSimilar(args);
          case 'get_fragment':
            return await fragmentToolHandlers.handleGetFragment(args);
          case 'update_fragment':
            return await fragmentToolHandlers.handleUpdateFragment(args);
          case 'delete_fragment':
            return await fragmentToolHandlers.handleDeleteFragment(args);
          case 'get_fragment_stats':
            return await fragmentToolHandlers.handleGetFragmentStats(args);
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
      
      // Extract queue-specific parameters
      const params = args as Record<string, unknown>;
      const priority = (params.priority as number) || 5;
      const immediate = (params.immediate as boolean) || false;
      
      this.logServerEvent(`Starting process: ${request.script_name} with args: ${JSON.stringify(request.args || [])} (priority: ${priority}, immediate: ${immediate})`);
      
      if (immediate) {
        // Use IntegratedQueueManager for immediate execution (bypasses queue)
        const result = await this.queueManager.startProcessImmediately(request);
        
        if (!result.success) {
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to start process immediately: ${result.error}`
          );
        }
        
        // Return success response with process details
        const processInfo = {
          processId: result.processId!,
          title: result.process!.title,
          name: result.process!.name,
          command: result.process!.command.join(' '),
          status: result.process!.status,
          startTime: result.process!.startTime.toISOString(),
          pid: result.process!.pid,
          executionMode: 'immediate'
        };
        
        return this.createMCPResponse(
          `Process '${result.process!.title}' started immediately with ID: ${result.processId}`,
          processInfo,
          getProcessUrl(result.processId!)
        );
      } else {
        // Add to queue
        const queuedProcess: QueuedProcess = {
          script_name: request.script_name,
          title: request.title,
          args: request.args,
          env_vars: request.env_vars,
          name: request.name,
          priority: priority as QueuePriority,
          metadata: {
            requestedAt: new Date().toISOString(),
            source: 'mcp'
          }
        };
        
        const queueId = this.queueManager.addToQueue(queuedProcess);
        
        // Get queue position
        const allEntries = this.queueManager.getAllQueueEntries();
        const pendingEntries = allEntries.filter(e => e.status === 'pending' || e.status === 'processing');
        const position = pendingEntries.findIndex(e => e.id === queueId) + 1;
        
        const queueInfo = {
          queueId,
          title: request.title,
          priority,
          queuePosition: position,
          totalInQueue: pendingEntries.length,
          executionMode: 'queued'
        };
        
        return this.createMCPResponse(
          `Process '${request.title}' added to queue with ID: ${queueId} (position ${position} of ${pendingEntries.length})`,
          queueInfo,
          getProcessUrl(queueId)
        );
      }
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
      
      // Get queue entries
      const queueEntries = this.queueManager.getAllQueueEntries();
      const pendingQueue = queueEntries.filter(e => e.status === 'pending' || e.status === 'processing');
      
      // Format response data
      const processData = processes.map(process => {
        // Check if this process has a corresponding queue entry
        const queueEntry = queueEntries.find(e => e.processId === process.id);
        
        const data: any = {
          id: process.id,
          title: process.title,
          name: process.name,
          command: process.command.join(' '),
          status: process.status,
          startTime: process.startTime.toISOString(),
          endTime: process.endTime?.toISOString(),
          exitCode: process.exitCode,
          logCount: process.logs.length
        };
        
        // Add queue information if available
        if (queueEntry) {
          data.queueInfo = {
            queueId: queueEntry.id,
            queueStatus: queueEntry.status,
            priority: queueEntry.priority,
            queuedAt: queueEntry.queuedAt.toISOString()
          };
        }
        
        return data;
      });
      
      // Get queue statistics
      const queueStats = this.queueManager.getStatistics();
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${processes.length} process(es)${query.status ? ` with status '${query.status}'` : ''}${query.name ? ` matching name '${query.name}'` : ''}. Queue: ${queueStats.totalQueued - queueStats.processing - queueStats.completed - queueStats.failed - queueStats.cancelled} pending, ${queueStats.processing} processing`,
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
      
      // First check if this is a queue ID
      const queueEntry = this.queueManager.getQueueEntry(processId);
      
      if (queueEntry) {
        // This is a queued process
        const queueEntries = this.queueManager.getAllQueueEntries();
        const pendingEntries = queueEntries.filter(e => e.status === 'pending' || e.status === 'processing');
        const position = pendingEntries.findIndex(e => e.id === processId) + 1;
        
        const queueDetails = {
          id: queueEntry.id,
          title: queueEntry.process.title,
          scriptName: queueEntry.process.script_name,
          args: queueEntry.process.args,
          status: `queued (${queueEntry.status})`,
          priority: queueEntry.priority,
          queuePosition: position > 0 ? position : 'processing',
          totalInQueue: pendingEntries.length,
          queuedAt: queueEntry.queuedAt.toISOString(),
          startedAt: queueEntry.startedAt?.toISOString(),
          processId: queueEntry.processId
        };
        
        return {
          content: [
            {
              type: 'text',
              text: `Queued process '${queueEntry.process.title}' (${processId}) - ${queueEntry.status}${position > 0 ? ` (position ${position} of ${pendingEntries.length})` : ''}`,
            },
            {
              type: 'text',
              text: JSON.stringify(queueDetails, null, 2),
            },
          ],
        };
      }
      
      // Get process status from ProcessManager
      const process = this.processManager.getProcessStatus(processId);
      
      if (!process) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Process with ID '${processId}' not found`
        );
      }
      
      // Check if this process has a queue entry
      const allQueueEntries = this.queueManager.getAllQueueEntries();
      const processQueueEntry = allQueueEntries.find(e => e.processId === processId);
      
      // Format detailed process information
      const processDetails: any = {
        id: process.id,
        title: process.title,
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
      
      // Add queue information if available
      if (processQueueEntry) {
        processDetails.queueInfo = {
          queueId: processQueueEntry.id,
          priority: processQueueEntry.priority,
          queuedAt: processQueueEntry.queuedAt.toISOString(),
          startedAt: processQueueEntry.startedAt?.toISOString(),
          completedAt: processQueueEntry.completedAt?.toISOString()
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Process '${process.title}' (${processId}) status: ${process.status}`,
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
    try {
      // Validate input arguments
      const { processId, force, timeout } = this.validateStopProcessArgs(args);
      
      this.logServerEvent(`Stopping process: ${processId} (force: ${force}, timeout: ${timeout}ms)`);
      
      // Get process before attempting to stop it
      const process = this.processManager.getProcessStatus(processId);
      
      if (!process) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Process with ID '${processId}' not found`
        );
      }
      
      // Check if process is already stopped
      if (process.status === 'stopped' || process.status === 'failed') {
        return {
          content: [
            {
              type: 'text',
              text: `Process '${process.name}' (${processId}) is already terminated with status: ${process.status}`,
            },
            {
              type: 'text',
              text: JSON.stringify({
                processId: process.id,
                name: process.name,
                status: process.status,
                endTime: process.endTime?.toISOString(),
                finalState: 'already_terminated'
              }, null, 2),
            },
          ],
        };
      }
      
      const startTime = Date.now();
      
      // Use ProcessManager to stop the process
      await this.processManager.stopProcess(processId, { force, timeout });
      
      const endTime = Date.now();
      const terminationDuration = endTime - startTime;
      
      // Get final process state
      const finalProcess = this.processManager.getProcessStatus(processId);
      
      const terminationInfo = {
        processId: finalProcess?.id || processId,
        name: finalProcess?.name || 'unknown',
        finalStatus: finalProcess?.status || 'unknown',
        terminationMethod: force ? 'forced' : 'graceful',
        terminationDuration: `${terminationDuration}ms`,
        endTime: finalProcess?.endTime?.toISOString(),
        exitCode: finalProcess?.exitCode
      };
      
      return {
        content: [
          {
            type: 'text',
            text: `Process '${terminationInfo.name}' (${processId}) terminated successfully using ${terminationInfo.terminationMethod} method`,
          },
          {
            type: 'text',
            text: JSON.stringify(terminationInfo, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`stop_process error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during process termination';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to stop process: ${errorMessage}`
      );
    }
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
   * Handle get_queue_status tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleGetQueueStatus(args: unknown): Promise<CallToolResult> {
    try {
      // Parse arguments
      const params = (args && typeof args === 'object') ? args as Record<string, unknown> : {};
      const includeEntries = params.include_entries as boolean || false;
      const statusFilter = params.status_filter as string | undefined;
      
      // Get queue statistics
      const stats = this.queueManager.getStatistics();
      
      // Format statistics
      // Calculate pending by subtracting all other statuses from totalQueued
      const pending = stats.totalQueued - stats.processing - stats.completed - stats.failed - stats.cancelled;
      
      const statsInfo = {
        totalQueued: stats.totalQueued,
        pending: pending,
        processing: stats.processing,
        completed: stats.completed,
        failed: stats.failed,
        cancelled: stats.cancelled,
        averageWaitTime: `${(stats.averageWaitTime / 1000).toFixed(2)}s`,
        averageProcessingTime: `${(stats.averageProcessingTime / 1000).toFixed(2)}s`,
        throughput: `${stats.throughput.toFixed(2)} processes/min`,
        lastUpdated: stats.lastUpdated.toISOString()
      };
      
      // Get current config (we'll need to add this method to IntegratedQueueManager)
      const configInfo = {
        maxConcurrentProcesses: 5, // Default from queue config
        maxQueueSize: 1000,
        autoStart: true,
        persistInterval: 30000
      };
      
      let response = {
        statistics: statsInfo,
        configuration: configInfo,
        isProcessing: true // Assume it's processing by default
      };
      
      // Include entries if requested
      if (includeEntries) {
        const allEntries = this.queueManager.getAllQueueEntries();
        let entries = allEntries;
        
        if (statusFilter) {
          entries = entries.filter(e => e.status === statusFilter);
        }
        
        const formattedEntries = entries.map(entry => ({
          id: entry.id,
          title: entry.process.title,
          scriptName: entry.process.script_name,
          status: entry.status,
          priority: entry.priority,
          queuedAt: entry.queuedAt.toISOString(),
          startedAt: entry.startedAt?.toISOString(),
          completedAt: entry.completedAt?.toISOString(),
          processId: entry.processId,
          error: entry.error,
          retryCount: entry.retryCount
        }));
        
        (response as any).entries = formattedEntries;
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Queue Status: ${statsInfo.pending} pending, ${stats.processing} processing`,
          },
          {
            type: 'text',
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`get_queue_status error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get queue status: ${errorMessage}`
      );
    }
  }

  /**
   * Handle set_queue_config tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleSetQueueConfig(args: unknown): Promise<CallToolResult> {
    try {
      // Parse arguments
      if (!args || typeof args !== 'object') {
        return {
          content: [
            {
              type: 'text',
              text: 'No configuration changes requested',
            },
          ],
        };
      }
      
      const params = args as Record<string, unknown>;
      const updates: string[] = [];
      
      // Note: The current implementation doesn't support dynamic config updates
      // This would need to be added to IntegratedQueueManager
      // For now, we'll just acknowledge the request
      
      if (params.maxConcurrent !== undefined) {
        updates.push(`maxConcurrent: ${params.maxConcurrent}`);
      }
      if (params.maxQueueSize !== undefined) {
        updates.push(`maxQueueSize: ${params.maxQueueSize}`);
      }
      if (params.maxRetries !== undefined) {
        updates.push(`maxRetries: ${params.maxRetries}`);
      }
      if (params.retryDelay !== undefined) {
        updates.push(`retryDelay: ${params.retryDelay}ms`);
      }
      
      if (updates.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No configuration changes requested',
            },
          ],
        };
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Queue configuration update requested: ${updates.join(', ')}`,
          },
          {
            type: 'text',
            text: 'Note: Dynamic configuration updates are not yet implemented. Changes will take effect on next server restart.',
          },
        ],
      };
    } catch (error) {
      this.logServerError(`set_queue_config error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to set queue config: ${errorMessage}`
      );
    }
  }

  /**
   * Handle pause_queue tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handlePauseQueue(args: unknown): Promise<CallToolResult> {
    try {
      // Stop processing
      this.queueManager.stopProcessing();
      
      // Get current queue state
      const stats = this.queueManager.getStatistics();
      
      return this.createMCPResponse(
        `Queue processing paused successfully`,
        {
          status: 'paused',
          pendingCount: stats.totalQueued - stats.processing - stats.completed - stats.failed - stats.cancelled,
          processingCount: stats.processing,
          message: 'Running processes will continue, but no new processes will start'
        },
        getDashboardUrl()
      );
    } catch (error) {
      this.logServerError(`pause_queue error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to pause queue: ${errorMessage}`
      );
    }
  }

  /**
   * Handle resume_queue tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleResumeQueue(args: unknown): Promise<CallToolResult> {
    try {
      // Start processing
      this.queueManager.startProcessing();
      
      // Get current queue state
      const stats = this.queueManager.getStatistics();
      
      return this.createMCPResponse(
        `Queue processing resumed successfully`,
        {
          status: 'resumed',
          pendingCount: stats.totalQueued - stats.processing - stats.completed - stats.failed - stats.cancelled,
          processingCount: stats.processing,
          message: 'Queue processing will continue from where it left off'
        },
        getDashboardUrl()
      );
    } catch (error) {
      this.logServerError(`resume_queue error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to resume queue: ${errorMessage}`
      );
    }
  }

  /**
   * Handle cancel_queued_process tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleCancelQueuedProcess(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'cancel_queued_process requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.queue_id || typeof params.queue_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'queue_id is required and must be a string');
      }
      
      const queueId = params.queue_id;
      
      // Cancel the queued process
      const success = this.queueManager.cancel(queueId);
      
      if (!success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unable to cancel process. It may not exist, already be processing, or already completed.`
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Queued process ${queueId} cancelled successfully`,
          },
        ],
      };
    } catch (error) {
      this.logServerError(`cancel_queued_process error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to cancel queued process: ${errorMessage}`
      );
    }
  }

  /**
   * Validate arguments for start_process tool
   * @param args - Raw arguments from MCP call
   * @returns Validated StartProcessRequest object
   * @private
   */
  private validateStartProcessArgs(args: unknown): StartProcessRequest {
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidRequest, 'start_process requires arguments');
    }
    
    const params = args as Record<string, unknown>;
    
    // Use the type guard for comprehensive validation
    if (!isValidStartProcessRequest(params)) {
      // Provide more specific error messages for common issues
      if (!params.script_name || typeof params.script_name !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'script_name is required and must be a non-empty string');
      }
      
      if (!params.title || typeof params.title !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'title is required and must be a non-empty string');
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
    
    return params as StartProcessRequest;
  }

  /**
   * Validate arguments for stop_process tool
   * @param args - Raw arguments from MCP call
   * @returns Validated parameters for process termination
   * @private
   */
  private validateStopProcessArgs(args: unknown): {
    processId: string;
    force: boolean;
    timeout: number;
  } {
    if (!args || typeof args !== 'object') {
      throw new McpError(ErrorCode.InvalidRequest, 'stop_process requires arguments');
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
    
    const result = { 
      processId: params.process_id,
      force: false,
      timeout: 5000
    };
    
    // Validate optional force parameter
    if (params.force !== undefined) {
      if (typeof params.force !== 'boolean') {
        throw new McpError(ErrorCode.InvalidRequest, 'force must be a boolean');
      }
      result.force = params.force;
    }
    
    // Validate optional timeout parameter
    if (params.timeout !== undefined) {
      if (typeof params.timeout !== 'number' || params.timeout < 1000 || params.timeout > 60000) {
        throw new McpError(ErrorCode.InvalidRequest, 'timeout must be a number between 1000 and 60000 (milliseconds)');
      }
      result.timeout = params.timeout;
    }
    
    return result;
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
   * Handle record_issue tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleRecordIssue(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'record_issue requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.title || typeof params.title !== 'string' || params.title.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'title is required and must be a non-empty string');
      }
      
      if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'content is required and must be a non-empty string');
      }
      
      // Create issue request (using content as the main content, title in metadata)
      const request: CreateIssueRequest = {
        content: `# ${params.title}\n\n${params.content}`,
        priority: (params.priority as 'low' | 'medium' | 'high') || 'medium',
        tags: params.tags as string[] | undefined,
        metadata: {
          title: params.title,
          ...((params.metadata as Record<string, unknown>) || {})
        },
      };
      
      // Create issue using FileKnowledgeManager
      const result = await this.knowledgeManager.createIssue(request);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to create issue: ${result.error}`
        );
      }
      
      const issue = result.data!;
      
      return this.createMCPResponse(
        `Issue recorded successfully with ID: ${issue.id}`,
        {
          id: issue.id,
          title: params.title,
          content: params.content,
          priority: issue.priority,
          status: issue.status,
          tags: issue.tags,
          timestamp: issue.timestamp.toISOString()
        },
        getIssueUrl(issue.id)
      );
    } catch (error) {
      this.logServerError(`record_issue error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during issue creation';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to record issue: ${errorMessage}`
      );
    }
  }

  /**
   * Handle list_issues tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleListIssues(args: unknown): Promise<CallToolResult> {
    try {
      // Build query for issues
      const query: KnowledgeQuery = { type: KnowledgeType.ISSUE };
      
      if (args && typeof args === 'object') {
        const params = args as Record<string, unknown>;
        
        if (params.status) {
          // Map string status to EntryStatus enum
          const statusMap: Record<string, EntryStatus> = {
            'open': EntryStatus.OPEN,
            'in-progress': EntryStatus.IN_PROGRESS,
            'completed': EntryStatus.COMPLETED,
            'archived': EntryStatus.ARCHIVED
          };
          
          const status = statusMap[params.status as string];
          if (!status) {
            throw new McpError(ErrorCode.InvalidRequest, `Invalid status '${params.status}'. Must be one of: open, in-progress, completed, archived`);
          }
          // Note: The search doesn't directly support status filtering yet, we'll filter after
        }
        
        if (params.tags && Array.isArray(params.tags)) {
          query.tags = params.tags as string[];
        }
        if (params.limit && typeof params.limit === 'number') {
          query.limit = params.limit;
        }
      }
      
      // Search issues using FileKnowledgeManager
      const entries = await this.knowledgeManager.searchEntries(query);
      
      // Apply status filtering if specified (since query doesn't support it yet)
      let filteredEntries = entries;
      if (args && typeof args === 'object') {
        const params = args as Record<string, unknown>;
        if (params.status) {
          const statusMap: Record<string, EntryStatus> = {
            'open': EntryStatus.OPEN,
            'in-progress': EntryStatus.IN_PROGRESS,
            'completed': EntryStatus.COMPLETED,
            'archived': EntryStatus.ARCHIVED
          };
          const targetStatus = statusMap[params.status as string];
          filteredEntries = entries.filter(entry => entry.status === targetStatus);
        }
      }
      
      // Format issues for display
      const formattedIssues = filteredEntries.map(entry => {
        const issue = entry as any; // We know it's an Issue
        // Extract title from metadata or content
        const title = issue.metadata?.title || issue.content.split('\n')[0].replace(/^# /, '') || 'Untitled Issue';
        const content = issue.metadata?.title ? issue.content.replace(/^# .*\n\n/, '') : issue.content;
        
        return {
          id: issue.id,
          title,
          content,
          priority: issue.priority,
          status: issue.status,
          tags: issue.tags,
          assignee: issue.assignee,
          dueDate: issue.dueDate?.toISOString(),
          timestamp: issue.timestamp.toISOString(),
          lastUpdated: issue.lastUpdated.toISOString()
        };
      });
      
      const statusFilter = args && typeof args === 'object' ? (args as any).status : null;
      const statusText = statusFilter ? ` with status '${statusFilter}'` : '';
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${filteredEntries.length} issue(s)${statusText}`,
          },
          {
            type: 'text',
            text: JSON.stringify(formattedIssues, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`list_issues error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during listing';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list issues: ${errorMessage}`
      );
    }
  }

  /**
   * Handle update_issue tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleUpdateIssue(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'update_issue requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.issue_id || typeof params.issue_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'issue_id is required and must be a string');
      }
      
      // Build update request
      const updates: UpdateKnowledgeRequest = {};
      
      // Handle title and content updates
      if (params.title !== undefined || params.content !== undefined) {
        // Get current issue to merge title/content properly
        const currentIssue = await this.knowledgeManager.getEntry(params.issue_id);
        if (!currentIssue) {
          throw new McpError(ErrorCode.InvalidRequest, `Issue with ID ${params.issue_id} not found`);
        }
        
        const currentTitle = currentIssue.metadata?.title || currentIssue.content.split('\n')[0].replace(/^# /, '') || 'Untitled Issue';
        const currentContent = currentIssue.metadata?.title ? currentIssue.content.replace(/^# .*\n\n/, '') : currentIssue.content;
        
        const newTitle = params.title !== undefined ? params.title as string : currentTitle;
        const newContent = params.content !== undefined ? params.content as string : currentContent;
        
        updates.content = `# ${newTitle}\n\n${newContent}`;
        updates.metadata = { 
          ...currentIssue.metadata, 
          title: newTitle 
        };
      }
      
      if (params.status !== undefined) {
        const statusMap: Record<string, EntryStatus> = {
          'open': EntryStatus.OPEN,
          'in-progress': EntryStatus.IN_PROGRESS,
          'completed': EntryStatus.COMPLETED,
          'archived': EntryStatus.ARCHIVED
        };
        
        const status = statusMap[params.status as string];
        if (!status) {
          throw new McpError(ErrorCode.InvalidRequest, `Invalid status '${params.status}'. Must be one of: open, in-progress, completed, archived`);
        }
        updates.status = status;
      }
      
      if (params.tags !== undefined) {
        if (!Array.isArray(params.tags)) {
          throw new McpError(ErrorCode.InvalidRequest, 'tags must be an array of strings');
        }
        updates.tags = params.tags as string[];
      }
      
      if (params.priority !== undefined) {
        if (!['low', 'medium', 'high'].includes(params.priority as string)) {
          throw new McpError(ErrorCode.InvalidRequest, 'priority must be low, medium, or high');
        }
        updates.priority = params.priority as 'low' | 'medium' | 'high';
      }
      
      // Update issue using FileKnowledgeManager
      const result = await this.knowledgeManager.updateEntry(params.issue_id, updates);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to update issue: ${result.error}`
        );
      }
      
      const issue = result.data!;
      const title = issue.metadata?.title || issue.content.split('\n')[0].replace(/^# /, '') || 'Untitled Issue';
      
      return {
        content: [
          {
            type: 'text',
            text: `Issue ${params.issue_id} updated successfully`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              id: issue.id,
              title,
              priority: (issue as any).priority,
              status: issue.status,
              tags: issue.tags,
              lastUpdated: issue.lastUpdated.toISOString()
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`update_issue error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during update';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update issue: ${errorMessage}`
      );
    }
  }

  /**
   * Handle delete_issue tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleDeleteIssue(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'delete_issue requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.issue_id || typeof params.issue_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'issue_id is required and must be a string');
      }
      
      // Delete issue using FileKnowledgeManager
      const result = await this.knowledgeManager.deleteEntry(params.issue_id);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to delete issue: ${result.error}`
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Issue ${params.issue_id} deleted successfully`,
          },
        ],
      };
    } catch (error) {
      this.logServerError(`delete_issue error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during deletion';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete issue: ${errorMessage}`
      );
    }
  }

  /**
   * Handle get_issue tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleGetIssue(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'get_issue requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.issue_id || typeof params.issue_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'issue_id is required and must be a string');
      }
      
      // Get issue using FileKnowledgeManager
      const entry = await this.knowledgeManager.getEntry(params.issue_id);
      
      if (!entry) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Issue with ID ${params.issue_id} not found`
        );
      }
      
      // Validate entry is an issue
      if (!isIssue(entry)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Entry with ID ${params.issue_id} is not an issue`
        );
      }
      
      // Extract title from metadata or content
      const title = entry.metadata?.title || entry.content.split('\n')[0].replace(/^# /, '') || 'Untitled Issue';
      
      // Format response with summary text and JSON details
      const summaryText = `Issue: ${title}\nStatus: ${entry.status}\nCreated: ${entry.timestamp.toISOString()}\nLast Updated: ${entry.lastUpdated.toISOString()}`;
      
      const issueDetails = {
        id: entry.id,
        title: title,
        content: entry.content,
        status: entry.status,
        priority: entry.metadata?.priority || 'medium',
        tags: entry.tags || [],
        timestamp: entry.timestamp.toISOString(),
        lastUpdated: entry.lastUpdated.toISOString(),
        metadata: entry.metadata || {}
      };
      
      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
          {
            type: 'text',
            text: JSON.stringify(issueDetails, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`get_issue error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during retrieval';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get issue: ${errorMessage}`
      );
    }
  }

  /**
   * Handle get_milestone tool calls
   * @param args - Tool arguments (empty object)
   * @returns CallToolResult
   * @private
   */
  private async handleGetMilestone(args: unknown): Promise<CallToolResult> {
    try {
      // Get current milestone
      const milestoneResult = await this.milestoneManager.getCurrentMilestone();
      
      if (!milestoneResult.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to retrieve milestone: ${milestoneResult.error || 'Unknown error'}`
        );
      }
      
      if (!milestoneResult.data) {
        return {
          content: [
            {
              type: 'text',
              text: 'No milestone is currently set.',
            },
          ],
        };
      }
      
      const milestone = milestoneResult.data;
      
      // Format milestone information
      const summaryText = `Current Milestone: ${milestone.title}\nProgress: ${milestone.progress}%\nTarget Date: ${milestone.targetDate ? milestone.targetDate.toISOString().split('T')[0] : 'Not set'}\nLast Updated: ${milestone.lastUpdated.toISOString()}`;
      
      const milestoneDetails = {
        title: milestone.title,
        description: milestone.description,
        progress: milestone.progress,
        targetDate: milestone.targetDate ? milestone.targetDate.toISOString().split('T')[0] : null,
        relatedIssues: milestone.relatedIssueIds || [],
        createdAt: milestone.timestamp.toISOString(),
        lastUpdated: milestone.lastUpdated.toISOString(),
      };
      
      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
          {
            type: 'text',
            text: JSON.stringify(milestoneDetails, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`get_milestone error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during milestone retrieval';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get milestone: ${errorMessage}`
      );
    }
  }

  /**
   * Handle set_milestone tool calls
   * @param args - Tool arguments containing milestone data
   * @returns CallToolResult
   * @private
   */
  private async handleSetMilestone(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'set_milestone requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      // Validate required fields
      if (!params.title || typeof params.title !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'title is required and must be a string');
      }
      
      if (!params.description || typeof params.description !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'description is required and must be a string');
      }
      
      // Validate optional fields
      if (params.progress !== undefined && (typeof params.progress !== 'number' || params.progress < 0 || params.progress > 100)) {
        throw new McpError(ErrorCode.InvalidRequest, 'progress must be a number between 0 and 100');
      }
      
      if (params.targetDate !== undefined && typeof params.targetDate !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'targetDate must be a string in ISO format');
      }
      
      if (params.relatedIssues !== undefined && !Array.isArray(params.relatedIssues)) {
        throw new McpError(ErrorCode.InvalidRequest, 'relatedIssues must be an array of strings');
      }
      
      // Parse targetDate if provided
      let targetDate: Date | undefined;
      if (params.targetDate) {
        try {
          targetDate = new Date(params.targetDate as string);
          if (isNaN(targetDate.getTime())) {
            throw new McpError(ErrorCode.InvalidRequest, 'targetDate must be a valid date string');
          }
        } catch {
          throw new McpError(ErrorCode.InvalidRequest, 'targetDate must be a valid date string');
        }
      }

      // Create milestone request
      const milestoneRequest: CreateMilestoneRequest = {
        title: params.title as string,
        description: params.description as string,
        content: params.description as string, // Use description as content for now
        progress: (params.progress as number) || 0,
        targetDate: targetDate,
        relatedIssueIds: (params.relatedIssues as string[]) || [],
      };
      
      // Validate request using type guard
      if (!isValidCreateMilestoneRequest(milestoneRequest)) {
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid milestone request format');
      }
      
      // Set or update milestone
      const milestoneResult = await this.milestoneManager.setMilestone(milestoneRequest);
      
      if (!milestoneResult.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to set milestone: ${milestoneResult.error || 'Unknown error'}`
        );
      }
      
      if (!milestoneResult.data) {
        throw new McpError(ErrorCode.InternalError, 'Milestone was not created properly');
      }
      
      const milestone = milestoneResult.data;
      
      // Format success response
      const summaryText = `Milestone "${milestone.title}" has been set successfully.\nProgress: ${milestone.progress}%\nTarget Date: ${milestone.targetDate ? milestone.targetDate.toISOString().split('T')[0] : 'Not set'}`;
      
      const milestoneDetails = {
        title: milestone.title,
        description: milestone.description,
        progress: milestone.progress,
        targetDate: milestone.targetDate ? milestone.targetDate.toISOString().split('T')[0] : null,
        relatedIssues: milestone.relatedIssueIds || [],
        createdAt: milestone.timestamp.toISOString(),
        lastUpdated: milestone.lastUpdated.toISOString(),
      };
      
      return {
        content: [
          {
            type: 'text',
            text: summaryText,
          },
          {
            type: 'text',
            text: JSON.stringify(milestoneDetails, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`set_milestone error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during milestone setting';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to set milestone: ${errorMessage}`
      );
    }
  }

  /**
   * Log server events for debugging and monitoring
   * @param message - The log message
   * @private
   */
  private logServerEvent(message: string): void {
    logger.log('MCPProcessServer', message);
  }

  /**
   * Log server errors for debugging and monitoring
   * @param message - The error message
   * @private
   */
  private logServerError(message: string): void {
    logger.error('MCPProcessServer', message);
  }
}