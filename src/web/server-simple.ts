import { logger } from '../shared/logger.ts';
import { WebSocketMessage, WebSocketError, isWebSocketMessage } from './types.ts';
import { ProcessWebSocketHandlers } from './handlers.ts';
import { ProcessManager } from '../process/manager.ts';
import { KnowledgeManager } from '../knowledge/manager.ts';
import { IntegratedQueueManager } from '../queue/integrated-manager.ts';
import { ProcessStatus } from '../shared/types.ts';
import { QueueStatus } from '../queue/types.ts';

/**
 * Simplified WebSocket server for process management
 * 
 * This is a minimal implementation that works without the complex
 * connection manager integration.
 */
export class SimpleWebSocketServer {
  private server: Deno.HttpServer<Deno.NetAddr> | null = null;
  private connections = new Map<string, WebSocket>();
  private handlers: ProcessWebSocketHandlers;
  private connectionIdCounter = 0;

  constructor(
    private processManager: ProcessManager,
    private knowledgeManager: KnowledgeManager,
    private queueManager: IntegratedQueueManager,
    private config: { port: number; hostname?: string; path?: string }
  ) {
    this.handlers = new ProcessWebSocketHandlers(processManager);
  }

  async start(): Promise<void> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    logger.log('SimpleWebSocketServer', `Starting on ${this.config.hostname || '0.0.0.0'}:${this.config.port}`);

    this.server = Deno.serve({
      port: this.config.port,
      hostname: this.config.hostname || '0.0.0.0',
      handler: (req) => this.handleRequest(req),
    });

    // Set up process event listeners
    this.setupEventListeners();
  }

  private handleRequest(req: Request): Response {
    const url = new URL(req.url);
    
    if (url.pathname === (this.config.path || '/ws')) {
      return this.handleWebSocketUpgrade(req);
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        connections: this.connections.size,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  private handleWebSocketUpgrade(req: Request): Response {
    const upgrade = req.headers.get('upgrade');
    if (upgrade !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 400 });
    }

    try {
      const { socket, response } = Deno.upgradeWebSocket(req);
      const connectionId = `ws-${Date.now()}-${++this.connectionIdCounter}`;
      
      socket.onopen = () => {
        logger.log('SimpleWebSocketServer', `Connection opened: ${connectionId}`);
        this.connections.set(connectionId, socket);
        
        // Send connected message
        this.sendToConnection(connectionId, {
          type: 'connected',
          data: { connectionId, serverTime: new Date().toISOString() },
        });
      };

      socket.onclose = () => {
        logger.log('SimpleWebSocketServer', `Connection closed: ${connectionId}`);
        this.connections.delete(connectionId);
      };

      socket.onerror = (event) => {
        logger.error('SimpleWebSocketServer', `Connection error: ${connectionId}`, event);
      };

      socket.onmessage = (event) => {
        this.handleMessage(connectionId, event);
      };

      return response;
    } catch (error) {
      logger.error('SimpleWebSocketServer', 'Failed to upgrade WebSocket', error);
      return new Response('WebSocket upgrade failed', { status: 500 });
    }
  }

  private async handleMessage(connectionId: string, event: MessageEvent): Promise<void> {
    try {
      const message = JSON.parse(event.data);
      
      if (!isWebSocketMessage(message)) {
        throw new Error('Invalid message format');
      }

      logger.debug('SimpleWebSocketServer', `Processing ${message.type} from ${connectionId}`);

      // Create a mock connection object for handlers
      const socket = this.connections.get(connectionId);
      if (!socket) return;

      const connection = {
        id: connectionId,
        sessionId: connectionId,
        socket,
        state: 'open' as const,
        connectedAt: new Date(),
        lastActivity: new Date(),
        subscriptions: { processIds: new Set<string>(), allProcesses: true },
        metadata: {},
      };

      // Route to appropriate handler
      switch (message.type) {
        // Process management
        case 'list_processes':
          await this.handlers.handleListProcesses(connection, message.data);
          break;
        case 'get_process_status':
          await this.handlers.handleGetProcessStatus(connection, message.data);
          break;
        case 'start_process':
          await this.handlers.handleStartProcess(connection, message.data);
          break;
        case 'stop_process':
          await this.handlers.handleStopProcess(connection, message.data);
          break;
        case 'get_process_logs':
          await this.handlers.handleGetProcessLogs(connection, message.data);
          break;
          
        // Knowledge management
        case 'list_knowledge':
          await this.handleListKnowledge(connectionId, message.data);
          break;
        case 'create_question':
          await this.handleCreateQuestion(connectionId, message.data);
          break;
        case 'create_answer':
          await this.handleCreateAnswer(connectionId, message.data);
          break;
        case 'create_note':
          await this.handleCreateNote(connectionId, message.data);
          break;
          
        // Queue management
        case 'get_queue_stats':
          await this.handleGetQueueStats(connectionId);
          break;
        case 'list_queue_entries':
          await this.handleListQueueEntries(connectionId, message.data);
          break;
        case 'cancel_queue_entry':
          await this.handleCancelQueueEntry(connectionId, message.data);
          break;
          
        // Dashboard and metrics
        case 'get_dashboard_stats':
          await this.handleGetDashboardStats(connectionId);
          break;
        case 'get_metrics_data':
          await this.handleGetMetricsData(connectionId);
          break;
          
        default:
          this.sendError(connectionId, {
            code: 'UNKNOWN_MESSAGE_TYPE',
            message: `Unknown message type: ${message.type}`,
          });
      }
    } catch (error) {
      logger.error('SimpleWebSocketServer', 'Error handling message', error);
      this.sendError(connectionId, {
        code: 'MESSAGE_PROCESSING_ERROR',
        message: error instanceof Error ? error.message : 'Failed to process message',
      });
    }
  }

  private setupEventListeners(): void {
    // Listen for process events and broadcast to all connections
    this.processManager.on('process:started', (data) => {
      this.broadcast({
        type: 'process_started',
        data: { processId: data.processId, process: data.process },
      });
    });

    this.processManager.on('process:stopped', (data) => {
      this.broadcast({
        type: 'process_stopped',
        data: { processId: data.processId, process: data.process },
      });
    });

    this.processManager.on('process:failed', (data) => {
      this.broadcast({
        type: 'process_failed',
        data: { processId: data.processId, process: data.process, error: data.error },
      });
    });

    this.processManager.on('process:state_changed', (data) => {
      this.broadcast({
        type: 'process_state_changed',
        data: { processId: data.processId, from: data.from, to: data.to },
      });
    });

    // Throttled log broadcasting
    let logTimeout: number | undefined;
    const pendingLogs = new Map<string, unknown[]>();

    this.processManager.on('process:log_added', (data) => {
      const logs = pendingLogs.get(data.processId) || [];
      logs.push(data.log);
      pendingLogs.set(data.processId, logs);

      if (!logTimeout) {
        logTimeout = setTimeout(() => {
          for (const [processId, logs] of pendingLogs) {
            this.broadcast({
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
    this.knowledgeManager.on('knowledge:created', (data) => {
      this.broadcast({
        type: 'knowledge_updated',
        data: { entry: data.entry },
      });
    });

    this.knowledgeManager.on('knowledge:updated', (data) => {
      this.broadcast({
        type: 'knowledge_updated',
        data: { entry: data.entry },
      });
    });

    this.knowledgeManager.on('knowledge:deleted', (data) => {
      this.broadcast({
        type: 'knowledge_deleted',
        data: { entryId: data.entryId },
      });
    });

    // Queue event listeners
    this.queueManager.on('queue:entry_added', (data) => {
      this.broadcast({
        type: 'queue_entry_updated',
        data: { entry: data.entry },
      });
    });

    this.queueManager.on('queue:entry_started', (data) => {
      this.broadcast({
        type: 'queue_entry_updated',
        data: { entry: data.entry },
      });
    });

    this.queueManager.on('queue:entry_completed', (data) => {
      this.broadcast({
        type: 'queue_entry_updated',
        data: { entry: data.entry },
      });
    });

    this.queueManager.on('queue:entry_failed', (data) => {
      this.broadcast({
        type: 'queue_entry_updated',
        data: { entry: data.entry },
      });
    });

    this.queueManager.on('queue:entry_cancelled', (data) => {
      this.broadcast({
        type: 'queue_entry_updated',
        data: { entry: data.entry },
      });
    });

    // Periodically broadcast dashboard stats for real-time updates
    setInterval(() => {
      if (this.connections.size > 0) {
        this.handleGetDashboardStats('broadcast').catch(err => 
          logger.error('SimpleWebSocketServer', 'Failed to broadcast dashboard stats', err)
        );
      }
    }, 5000); // Update every 5 seconds
  }

  private sendToConnection(connectionId: string, message: WebSocketMessage): void {
    const socket = this.connections.get(connectionId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(message));
      } catch (error) {
        logger.error('SimpleWebSocketServer', `Failed to send to ${connectionId}`, error);
      }
    }
  }

  private sendError(connectionId: string, error: WebSocketError): void {
    this.sendToConnection(connectionId, { type: 'error', data: error });
  }

  private broadcast(message: WebSocketMessage): void {
    for (const [connectionId, socket] of this.connections) {
      if (socket.readyState === WebSocket.OPEN) {
        this.sendToConnection(connectionId, message);
      }
    }
  }

  // Knowledge management handlers
  private async handleListKnowledge(connectionId: string, data: unknown): Promise<void> {
    try {
      const query = data as { limit?: number; type?: string; search?: string };
      const entries = await this.knowledgeManager.queryKnowledge({
        limit: query.limit || 100,
        type: query.type as any,
        search: query.search,
      });
      
      this.sendToConnection(connectionId, {
        type: 'knowledge_list',
        data: { entries },
      });
    } catch (error) {
      this.sendError(connectionId, {
        code: 'KNOWLEDGE_QUERY_ERROR',
        message: error instanceof Error ? error.message : 'Failed to query knowledge',
      });
    }
  }

  private async handleCreateQuestion(connectionId: string, data: unknown): Promise<void> {
    try {
      const result = await this.knowledgeManager.createQuestion(data as any);
      if (result.success && result.data) {
        this.broadcast({
          type: 'knowledge_created',
          data: { entry: result.data },
        });
      } else {
        this.sendError(connectionId, {
          code: 'CREATE_QUESTION_ERROR',
          message: result.error || 'Failed to create question',
        });
      }
    } catch (error) {
      this.sendError(connectionId, {
        code: 'CREATE_QUESTION_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create question',
      });
    }
  }

  private async handleCreateAnswer(connectionId: string, data: unknown): Promise<void> {
    try {
      const result = await this.knowledgeManager.createAnswer(data as any);
      if (result.success && result.data) {
        this.broadcast({
          type: 'knowledge_created',
          data: { entry: result.data },
        });
      } else {
        this.sendError(connectionId, {
          code: 'CREATE_ANSWER_ERROR',
          message: result.error || 'Failed to create answer',
        });
      }
    } catch (error) {
      this.sendError(connectionId, {
        code: 'CREATE_ANSWER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create answer',
      });
    }
  }

  private async handleCreateNote(connectionId: string, data: unknown): Promise<void> {
    try {
      const result = await this.knowledgeManager.createNote(data as any);
      if (result.success && result.data) {
        this.broadcast({
          type: 'knowledge_created',
          data: { entry: result.data },
        });
      } else {
        this.sendError(connectionId, {
          code: 'CREATE_NOTE_ERROR',
          message: result.error || 'Failed to create note',
        });
      }
    } catch (error) {
      this.sendError(connectionId, {
        code: 'CREATE_NOTE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to create note',
      });
    }
  }

  // Queue management handlers
  private async handleGetQueueStats(connectionId: string): Promise<void> {
    try {
      const stats = await this.queueManager.getStatistics();
      const queueStats = {
        pending: stats.totalQueued,
        processing: stats.processing,
        completed: stats.completed,
        failed: stats.failed,
      };
      
      this.sendToConnection(connectionId, {
        type: 'queue_stats',
        data: { stats: queueStats },
      });
    } catch (error) {
      this.sendError(connectionId, {
        code: 'QUEUE_STATS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get queue stats',
      });
    }
  }

  private async handleListQueueEntries(connectionId: string, data: unknown): Promise<void> {
    try {
      const query = data as { limit?: number; status?: string };
      const entries = await this.queueManager.listQueueEntries({
        limit: query.limit || 100,
        status: query.status as QueueStatus,
      });
      
      this.sendToConnection(connectionId, {
        type: 'queue_entries',
        data: { entries },
      });
    } catch (error) {
      this.sendError(connectionId, {
        code: 'QUEUE_LIST_ERROR',
        message: error instanceof Error ? error.message : 'Failed to list queue entries',
      });
    }
  }

  private async handleCancelQueueEntry(connectionId: string, data: unknown): Promise<void> {
    try {
      const { entryId } = data as { entryId: string };
      const result = await this.queueManager.cancelEntry(entryId);
      
      if (result.success) {
        this.broadcast({
          type: 'queue_entry_updated',
          data: { entry: result.data },
        });
      } else {
        this.sendError(connectionId, {
          code: 'CANCEL_QUEUE_ERROR',
          message: result.error || 'Failed to cancel queue entry',
        });
      }
    } catch (error) {
      this.sendError(connectionId, {
        code: 'CANCEL_QUEUE_ERROR',
        message: error instanceof Error ? error.message : 'Failed to cancel queue entry',
      });
    }
  }

  // Dashboard and metrics handlers
  private async handleGetDashboardStats(connectionId: string): Promise<void> {
    try {
      // Get process stats
      const processes = this.processManager.getAllProcesses();
      const processStatusCounts = {
        running: 0,
        starting: 0,
        stopped: 0,
        failed: 0,
      };
      
      processes.forEach(p => {
        if (p.status === ProcessStatus.running) processStatusCounts.running++;
        else if (p.status === ProcessStatus.starting) processStatusCounts.starting++;
        else if (p.status === ProcessStatus.stopped) processStatusCounts.stopped++;
        else if (p.status === ProcessStatus.failed) processStatusCounts.failed++;
      });
      
      // Get queue stats
      const queueStats = await this.queueManager.getStatistics();
      const queuePriority = new Array(10).fill(0);
      
      // Count queue entries by priority
      const entries = await this.queueManager.listQueueEntries({ limit: 1000 });
      entries.forEach(entry => {
        if (entry.status === QueueStatus.pending) {
          queuePriority[entry.priority - 1]++;
        }
      });
      
      // Get knowledge stats
      const knowledgeStats = await this.knowledgeManager.getStatistics();
      
      const dashboardData = {
        runningProcesses: processStatusCounts.running,
        queuedProcesses: queueStats.totalQueued,
        knowledgeEntries: knowledgeStats.totalEntries,
        openQuestions: knowledgeStats.byStatus.unansweredQuestions,
        processStatus: processStatusCounts,
        queuePriority,
      };
      
      if (connectionId === 'broadcast') {
        this.broadcast({
          type: 'dashboard_stats',
          data: dashboardData,
        });
      } else {
        this.sendToConnection(connectionId, {
          type: 'dashboard_stats',
          data: dashboardData,
        });
      }
    } catch (error) {
      this.sendError(connectionId, {
        code: 'DASHBOARD_STATS_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get dashboard stats',
      });
    }
  }

  private async handleGetMetricsData(connectionId: string): Promise<void> {
    try {
      // This would need historical data tracking
      // For now, return current snapshot
      const metricsData = {
        processCount: this.processManager.getAllProcesses().length,
        queueStats: await this.queueManager.getStatistics(),
        knowledgeStats: await this.knowledgeManager.getStatistics(),
      };
      
      this.sendToConnection(connectionId, {
        type: 'metrics_data',
        data: metricsData,
      });
    } catch (error) {
      this.sendError(connectionId, {
        code: 'METRICS_DATA_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get metrics data',
      });
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    // Close all connections
    for (const [connectionId, socket] of this.connections) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close(1001, 'Server shutdown');
      }
    }

    // Shutdown server
    await this.server.shutdown();
    this.server = null;
    this.connections.clear();

    logger.log('SimpleWebSocketServer', 'Server stopped');
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}