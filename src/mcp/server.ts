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
import { KnowledgeManager } from '../knowledge/manager.ts';
import { IntegratedQueueManager } from '../queue/integrated-manager.ts';
import { 
  CreateQuestionRequest, 
  CreateNoteRequest,
  UpdateKnowledgeRequest,
  KnowledgeQuery,
  KnowledgeType
} from '../knowledge/types.ts';
import { QueuedProcess, QueuePriority } from '../queue/types.ts';

/**
 * MCPProcessServer - Model Context Protocol server for process management
 * 
 * Provides MCP integration layer that connects our ProcessManager to MCP clients
 * like Claude Desktop and Claude Code. Uses stdio transport for local communication.
 */
export class MCPProcessServer {
  private readonly server: Server;
  private readonly processManager: ProcessManager;
  private readonly knowledgeManager: KnowledgeManager;
  private readonly queueManager: IntegratedQueueManager;
  private transport: StdioServerTransport | null = null;
  private isStarted = false;
  private startPromise: Promise<void> | null = null;

  /**
   * Initialize MCP server with dependency injection for all managers
   * @param processManager - ProcessManager instance for direct process operations
   * @param knowledgeManager - KnowledgeManager instance for Q&A and notes
   * @param queueManager - IntegratedQueueManager instance for queued process operations
   */
  constructor(
    processManager: ProcessManager,
    knowledgeManager: KnowledgeManager,
    queueManager: IntegratedQueueManager
  ) {
    if (!processManager) {
      throw new Error('ProcessManager is required');
    }
    if (!knowledgeManager) {
      throw new Error('KnowledgeManager is required');
    }
    if (!queueManager) {
      throw new Error('IntegratedQueueManager is required');
    }
    
    this.processManager = processManager;
    this.knowledgeManager = knowledgeManager;
    this.queueManager = queueManager;
    
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
            name: 'record_question',
            description: 'Record a question related to a process or general knowledge base. Questions can be answered later to build institutional knowledge.',
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'The question content',
                  minLength: 1,
                },
                process_id: {
                  type: 'string',
                  description: 'Optional process ID this question relates to',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags for categorizing the question (e.g., "build-error", "config", "deployment")',
                },
                priority: {
                  type: 'string',
                  enum: ['low', 'medium', 'high'],
                  description: 'Priority of the question',
                  default: 'medium',
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata for the question',
                },
              },
              required: ['content'],
            },
          },
          {
            name: 'record_answer',
            description: 'Record an answer to a previously asked question. Multiple answers can be provided for the same question.',
            inputSchema: {
              type: 'object',
              properties: {
                question_id: {
                  type: 'string',
                  description: 'The ID of the question to answer',
                },
                content: {
                  type: 'string',
                  description: 'The answer content',
                  minLength: 1,
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags for categorizing the answer',
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata for the answer',
                },
              },
              required: ['question_id', 'content'],
            },
          },
          {
            name: 'list_questions_and_answers',
            description: 'List questions and their answers with filtering options. Useful for knowledge retrieval and learning from past issues.',
            inputSchema: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['question', 'answer', 'note'],
                  description: 'Filter by knowledge entry type',
                },
                process_id: {
                  type: 'string',
                  description: 'Filter by process ID',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by tags (entries must have all specified tags)',
                },
                answered: {
                  type: 'boolean',
                  description: 'Filter questions by answered status',
                },
                limit: {
                  type: 'number',
                  minimum: 1,
                  maximum: 100,
                  description: 'Maximum number of entries to return',
                  default: 20,
                },
              },
              required: [],
            },
          },
          {
            name: 'record_note',
            description: 'Record a note about a process, configuration, or general knowledge. Notes are standalone entries that can be categorized and linked to other knowledge entries.',
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'The note content',
                  minLength: 1,
                },
                category: {
                  type: 'string',
                  description: 'Category for the note (e.g., "troubleshooting", "config", "best-practice")',
                },
                process_id: {
                  type: 'string',
                  description: 'Optional process ID this note relates to',
                },
                related_ids: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'IDs of related knowledge entries (questions, answers, or other notes)',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags for categorizing the note',
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata for the note',
                },
              },
              required: ['content', 'category'],
            },
          },
          {
            name: 'list_notes',
            description: 'List notes with filtering options. Useful for retrieving categorized knowledge and documentation.',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  description: 'Filter by note category',
                },
                process_id: {
                  type: 'string',
                  description: 'Filter by process ID',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Filter by tags (notes must have all specified tags)',
                },
                limit: {
                  type: 'number',
                  minimum: 1,
                  maximum: 100,
                  description: 'Maximum number of notes to return',
                  default: 20,
                },
              },
              required: [],
            },
          },
          {
            name: 'update_note',
            description: 'Update an existing note\'s content, category, or tags.',
            inputSchema: {
              type: 'object',
              properties: {
                note_id: {
                  type: 'string',
                  description: 'The ID of the note to update',
                },
                content: {
                  type: 'string',
                  description: 'New content for the note',
                },
                category: {
                  type: 'string',
                  description: 'New category for the note',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'New tags for the note (replaces existing tags)',
                },
                metadata: {
                  type: 'object',
                  description: 'Additional metadata to merge with existing metadata',
                },
              },
              required: ['note_id'],
            },
          },
          {
            name: 'delete_note',
            description: 'Delete a note from the knowledge base.',
            inputSchema: {
              type: 'object',
              properties: {
                note_id: {
                  type: 'string',
                  description: 'The ID of the note to delete',
                },
              },
              required: ['note_id'],
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
          case 'record_question':
            return await this.handleRecordQuestion(args);
          case 'record_answer':
            return await this.handleRecordAnswer(args);
          case 'list_questions_and_answers':
            return await this.handleListQuestionsAndAnswers(args);
          case 'record_note':
            return await this.handleRecordNote(args);
          case 'list_notes':
            return await this.handleListNotes(args);
          case 'update_note':
            return await this.handleUpdateNote(args);
          case 'delete_note':
            return await this.handleDeleteNote(args);
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
        
        return {
          content: [
            {
              type: 'text',
              text: `Process '${result.process!.title}' started immediately with ID: ${result.processId}`,
            },
            {
              type: 'text',
              text: JSON.stringify(processInfo, null, 2),
            },
          ],
        };
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
        
        return {
          content: [
            {
              type: 'text',
              text: `Process '${request.title}' added to queue with ID: ${queueId} (position ${position} of ${pendingEntries.length})`,
            },
            {
              type: 'text',
              text: JSON.stringify(queueInfo, null, 2),
            },
          ],
        };
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
   * Handle record_question tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleRecordQuestion(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'record_question requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'content is required and must be a non-empty string');
      }
      
      // Create question request
      const request: CreateQuestionRequest = {
        content: params.content,
        processId: params.process_id as string | undefined,
        tags: params.tags as string[] | undefined,
        priority: params.priority as 'low' | 'medium' | 'high' | undefined,
        metadata: params.metadata as Record<string, unknown> | undefined,
      };
      
      // Create question using KnowledgeManager
      const result = await this.knowledgeManager.createQuestion(request);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to create question: ${result.error}`
        );
      }
      
      const question = result.data!;
      
      return {
        content: [
          {
            type: 'text',
            text: `Question recorded successfully with ID: ${question.id}`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              id: question.id,
              content: question.content,
              priority: question.priority,
              tags: question.tags,
              processId: question.processId,
              timestamp: question.timestamp.toISOString()
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`record_question error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during question creation';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to record question: ${errorMessage}`
      );
    }
  }

  /**
   * Handle record_answer tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleRecordAnswer(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'record_answer requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.question_id || typeof params.question_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'question_id is required and must be a string');
      }
      
      if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'content is required and must be a non-empty string');
      }
      
      // Create answer request
      const request = {
        questionId: params.question_id,
        content: params.content,
        tags: params.tags as string[] | undefined,
        metadata: params.metadata as Record<string, unknown> | undefined,
      };
      
      // Create answer using KnowledgeManager
      const result = await this.knowledgeManager.createAnswer(request);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to create answer: ${result.error}`
        );
      }
      
      const answer = result.data!;
      
      return {
        content: [
          {
            type: 'text',
            text: `Answer recorded successfully for question ${params.question_id}`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              id: answer.id,
              questionId: answer.questionId,
              content: answer.content,
              tags: answer.tags,
              timestamp: answer.timestamp.toISOString()
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`record_answer error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during answer creation';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to record answer: ${errorMessage}`
      );
    }
  }

  /**
   * Handle list_questions_and_answers tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleListQuestionsAndAnswers(args: unknown): Promise<CallToolResult> {
    try {
      // Build query from arguments
      const query: KnowledgeQuery = {};
      
      if (args && typeof args === 'object') {
        const params = args as Record<string, unknown>;
        
        if (params.type) {
          query.type = params.type as KnowledgeType;
        }
        if (params.process_id) {
          query.processId = params.process_id as string;
        }
        if (params.tags && Array.isArray(params.tags)) {
          query.tags = params.tags as string[];
        }
        if (params.answered !== undefined) {
          query.answered = params.answered as boolean;
        }
        if (params.limit && typeof params.limit === 'number') {
          query.limit = params.limit;
        }
      }
      
      // Search entries using KnowledgeManager
      const entries = this.knowledgeManager.searchEntries(query);
      
      // Format entries for display
      const formattedEntries = entries.map(entry => {
        const base = {
          id: entry.id,
          type: entry.type,
          content: entry.content,
          tags: entry.tags,
          processId: entry.processId,
          timestamp: entry.timestamp.toISOString()
        };
        
        if (entry.type === KnowledgeType.QUESTION) {
          const question = entry as any;
          return {
            ...base,
            answered: question.answered,
            answerCount: question.answerIds?.length || 0,
            priority: question.priority
          };
        } else if (entry.type === KnowledgeType.ANSWER) {
          const answer = entry as any;
          return {
            ...base,
            questionId: answer.questionId,
            accepted: answer.accepted,
            votes: answer.votes
          };
        }
        
        return base;
      });
      
      // Get statistics
      const stats = this.knowledgeManager.getStatistics();
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${entries.length} knowledge entries. Total: ${stats.totalEntries} (${stats.byType.questions} questions, ${stats.byType.answers} answers, ${stats.byType.notes} notes)`,
          },
          {
            type: 'text',
            text: JSON.stringify(formattedEntries, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`list_questions_and_answers error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during listing';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list questions and answers: ${errorMessage}`
      );
    }
  }

  /**
   * Handle record_note tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleRecordNote(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'record_note requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.content || typeof params.content !== 'string' || params.content.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'content is required and must be a non-empty string');
      }
      
      if (!params.category || typeof params.category !== 'string' || params.category.trim().length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'category is required and must be a non-empty string');
      }
      
      // Create note request
      const request: CreateNoteRequest = {
        content: params.content,
        category: params.category,
        processId: params.process_id as string | undefined,
        relatedIds: params.related_ids as string[] | undefined,
        tags: params.tags as string[] | undefined,
        metadata: params.metadata as Record<string, unknown> | undefined,
      };
      
      // Create note using KnowledgeManager
      const result = await this.knowledgeManager.createNote(request);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to create note: ${result.error}`
        );
      }
      
      const note = result.data!;
      
      return {
        content: [
          {
            type: 'text',
            text: `Note recorded successfully with ID: ${note.id}`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              id: note.id,
              content: note.content,
              category: note.category,
              tags: note.tags,
              processId: note.processId,
              relatedIds: note.relatedIds,
              timestamp: note.timestamp.toISOString()
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`record_note error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during note creation';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to record note: ${errorMessage}`
      );
    }
  }

  /**
   * Handle list_notes tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleListNotes(args: unknown): Promise<CallToolResult> {
    try {
      // Build query for notes
      const query: KnowledgeQuery = { type: KnowledgeType.NOTE };
      
      if (args && typeof args === 'object') {
        const params = args as Record<string, unknown>;
        
        if (params.category) {
          query.category = params.category as string;
        }
        if (params.process_id) {
          query.processId = params.process_id as string;
        }
        if (params.tags && Array.isArray(params.tags)) {
          query.tags = params.tags as string[];
        }
        if (params.limit && typeof params.limit === 'number') {
          query.limit = params.limit;
        }
      }
      
      // Search notes using KnowledgeManager
      const entries = this.knowledgeManager.searchEntries(query);
      
      // Format notes for display
      const formattedNotes = entries.map(entry => {
        const note = entry as any;
        return {
          id: note.id,
          content: note.content,
          category: note.category,
          tags: note.tags,
          processId: note.processId,
          relatedIds: note.relatedIds,
          timestamp: note.timestamp.toISOString(),
          lastUpdated: note.lastUpdated.toISOString()
        };
      });
      
      return {
        content: [
          {
            type: 'text',
            text: `Found ${entries.length} notes`,
          },
          {
            type: 'text',
            text: JSON.stringify(formattedNotes, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`list_notes error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during listing';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list notes: ${errorMessage}`
      );
    }
  }

  /**
   * Handle update_note tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleUpdateNote(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'update_note requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.note_id || typeof params.note_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'note_id is required and must be a string');
      }
      
      // Build update request
      const updates: UpdateKnowledgeRequest = {};
      
      if (params.content !== undefined) {
        if (typeof params.content !== 'string' || params.content.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidRequest, 'content must be a non-empty string');
        }
        updates.content = params.content;
      }
      
      if (params.category !== undefined) {
        if (typeof params.category !== 'string' || params.category.trim().length === 0) {
          throw new McpError(ErrorCode.InvalidRequest, 'category must be a non-empty string');
        }
        updates.category = params.category;
      }
      
      if (params.tags !== undefined) {
        if (!Array.isArray(params.tags)) {
          throw new McpError(ErrorCode.InvalidRequest, 'tags must be an array of strings');
        }
        updates.tags = params.tags as string[];
      }
      
      if (params.metadata !== undefined) {
        updates.metadata = params.metadata as Record<string, unknown>;
      }
      
      // Update note using KnowledgeManager
      const result = await this.knowledgeManager.updateEntry(params.note_id, updates);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to update note: ${result.error}`
        );
      }
      
      const note = result.data!;
      
      return {
        content: [
          {
            type: 'text',
            text: `Note ${params.note_id} updated successfully`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              id: note.id,
              content: note.content,
              category: (note as any).category,
              tags: note.tags,
              lastUpdated: note.lastUpdated.toISOString()
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      this.logServerError(`update_note error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during update';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update note: ${errorMessage}`
      );
    }
  }

  /**
   * Handle delete_note tool calls
   * @param args - Tool arguments
   * @returns CallToolResult
   * @private
   */
  private async handleDeleteNote(args: unknown): Promise<CallToolResult> {
    try {
      // Validate arguments
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'delete_note requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.note_id || typeof params.note_id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'note_id is required and must be a string');
      }
      
      // Delete note using KnowledgeManager
      const result = await this.knowledgeManager.deleteEntry(params.note_id);
      
      if (!result.success) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to delete note: ${result.error}`
        );
      }
      
      return {
        content: [
          {
            type: 'text',
            text: `Note ${params.note_id} deleted successfully`,
          },
        ],
      };
    } catch (error) {
      this.logServerError(`delete_note error: ${error}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during deletion';
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete note: ${errorMessage}`
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
      
      return {
        content: [
          {
            type: 'text',
            text: `Queue processing paused successfully`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              status: 'paused',
              pendingCount: stats.totalQueued - stats.processing - stats.completed - stats.failed - stats.cancelled,
              processingCount: stats.processing,
              message: 'Running processes will continue, but no new processes will start'
            }, null, 2),
          },
        ],
      };
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
      
      return {
        content: [
          {
            type: 'text',
            text: `Queue processing resumed successfully`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              status: 'resumed',
              pendingCount: stats.totalQueued - stats.processing - stats.completed - stats.failed - stats.cancelled,
              processingCount: stats.processing,
              message: 'Queue processing will continue from where it left off'
            }, null, 2),
          },
        ],
      };
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