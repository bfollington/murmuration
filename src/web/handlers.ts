import { WebSocketConnection, WebSocketMessage } from './types.ts';
import { ProcessManager } from '../process/manager.ts';
import { logger } from '../shared/logger.ts';
import { ProcessStatus } from '../shared/types.ts';
import { ProcessQuery, ProcessSortField, SortOrder } from '../process/types.ts';

/**
 * WebSocket message handlers for process management
 * 
 * Each handler receives a connection and message data, and returns
 * a response through the connection's send method.
 */
export class ProcessWebSocketHandlers {
  constructor(private processManager: ProcessManager) {}

  /**
   * Handle process list request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleListProcesses(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      // Parse query parameters
      const query = this.parseProcessQuery(data);
      
      // Get processes from manager
      // Note: listProcesses doesn't exist on ProcessManager, we need to query the registry
      const allProcesses = this.processManager['registry'].getAllProcesses();
      
      // Apply filters
      let processes = allProcesses;
      if (query.status) {
        processes = processes.filter(p => 
          Array.isArray(query.status) ? query.status.includes(p.status) : p.status === query.status
        );
      }
      if (query.name) {
        processes = processes.filter(p => p.name.includes(query.name));
      }
      if (query.title) {
        processes = processes.filter(p => p.title.includes(query.title));
      }
      
      // Apply sorting
      if (query.sortBy) {
        processes.sort((a, b) => {
          const aVal = a[query.sortBy!];
          const bVal = b[query.sortBy!];
          const order = query.sortOrder === 'desc' ? -1 : 1;
          return aVal < bVal ? -order : order;
        });
      }
      
      // Apply pagination
      const page = query.page || 1;
      const pageSize = query.pageSize || 20;
      const start = (page - 1) * pageSize;
      const paginatedProcesses = processes.slice(start, start + pageSize);
      
      const result = {
        processes: paginatedProcesses,
        total: processes.length,
        page,
        pageSize,
      };
      
      // Send response
      await this.sendResponse(connection, {
        type: 'process_list',
        data: {
          processes: result.processes,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        },
      });
    } catch (error) {
      logger.error('ProcessWebSocketHandlers', 'Error handling list_processes', error);
      await this.sendError(connection, 'Failed to list processes', error);
    }
  }

  /**
   * Handle get process status request
   * @param connection WebSocket connection
   * @param data Request data containing processId
   */
  async handleGetProcessStatus(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const { processId } = this.validateProcessIdRequest(data);
      
      // Get process from manager
      const process = this.processManager.getProcessStatus(processId);
      const result = process ? { success: true, process } : { success: false };
      
      if (result.success && result.process) {
        await this.sendResponse(connection, {
          type: 'process_status',
          data: {
            process: result.process,
          },
        });
      } else {
        await this.sendError(connection, 'Process not found', new Error(`Process ${processId} not found`));
      }
    } catch (error) {
      logger.error('ProcessWebSocketHandlers', 'Error handling get_process_status', error);
      await this.sendError(connection, 'Failed to get process status', error);
    }
  }

  /**
   * Handle start process request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleStartProcess(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const request = this.validateStartProcessRequest(data);
      
      // Start process
      const result = await this.processManager.spawnProcess(request);
      
      if (result.success && result.processId) {
        await this.sendResponse(connection, {
          type: 'process_started',
          data: {
            processId: result.processId,
            message: 'Process started successfully',
          },
        });
      } else {
        await this.sendError(connection, result.error?.message || 'Failed to start process');
      }
    } catch (error) {
      logger.error('ProcessWebSocketHandlers', 'Error handling start_process', error);
      await this.sendError(connection, 'Failed to start process', error);
    }
  }

  /**
   * Handle stop process request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleStopProcess(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const { processId, force } = this.validateStopProcessRequest(data);
      
      // Stop process
      try {
        await this.processManager.stopProcess(processId, { force });
        const result = { success: true };
      
        await this.sendResponse(connection, {
          type: 'process_stopped',
          data: {
            processId,
            message: 'Process stop initiated',
          },
        });
      } catch (error) {
        await this.sendError(connection, error instanceof Error ? error.message : 'Failed to stop process');
      }
    } catch (error) {
      logger.error('ProcessWebSocketHandlers', 'Error handling stop_process', error);
      await this.sendError(connection, 'Failed to stop process', error);
    }
  }

  /**
   * Handle get process logs request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleGetProcessLogs(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const request = this.validateGetLogsRequest(data);
      
      // Get logs from manager
      const logs = this.processManager.getProcessLogs(
        request.processId,
        request.limit,
        request.type
      );
      
      const result = logs ? {
        success: true,
        logs: request.offset ? logs.slice(request.offset) : logs,
        total: logs.length
      } : {
        success: false,
        error: { message: 'Process not found' }
      };
      
      if (result.success && result.logs) {
        await this.sendResponse(connection, {
          type: 'process_logs',
          data: {
            processId: request.processId,
            logs: result.logs,
            total: result.total || result.logs.length,
          },
        });
      } else {
        await this.sendError(connection, result.error?.message || 'Failed to get logs');
      }
    } catch (error) {
      logger.error('ProcessWebSocketHandlers', 'Error handling get_process_logs', error);
      await this.sendError(connection, 'Failed to get process logs', error);
    }
  }

  /**
   * Parse process query from request data
   * @param data Raw request data
   * @returns Parsed ProcessQuery
   */
  private parseProcessQuery(data: unknown): ProcessQuery {
    if (!data || typeof data !== 'object') {
      return {}; // Return empty query
    }

    const obj = data as Record<string, unknown>;
    const query: ProcessQuery = {};

    // Parse status filter
    if (obj.status) {
      if (typeof obj.status === 'string' && Object.values(ProcessStatus).includes(obj.status as ProcessStatus)) {
        query.status = obj.status as ProcessStatus;
      } else if (Array.isArray(obj.status)) {
        query.status = obj.status.filter(s => 
          typeof s === 'string' && Object.values(ProcessStatus).includes(s as ProcessStatus)
        ) as ProcessStatus[];
      }
    }

    // Parse name filter
    if (typeof obj.name === 'string') {
      query.name = obj.name;
    }

    // Parse title filter
    if (typeof obj.title === 'string') {
      query.title = obj.title;
    }

    // Parse sorting
    if (typeof obj.sortBy === 'string' && ['startTime', 'name', 'status'].includes(obj.sortBy)) {
      query.sortBy = obj.sortBy as ProcessSortField;
    }
    if (typeof obj.sortOrder === 'string' && ['asc', 'desc'].includes(obj.sortOrder)) {
      query.sortOrder = obj.sortOrder as SortOrder;
    }

    // Parse pagination
    if (typeof obj.page === 'number' && obj.page > 0) {
      query.page = obj.page;
    }
    if (typeof obj.pageSize === 'number' && obj.pageSize > 0) {
      query.pageSize = Math.min(obj.pageSize, 100); // Cap at 100
    }

    return query;
  }

  /**
   * Validate process ID request
   * @param data Request data
   * @returns Validated request with processId
   */
  private validateProcessIdRequest(data: unknown): { processId: string } {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid request data');
    }

    const obj = data as Record<string, unknown>;
    if (typeof obj.processId !== 'string' || !obj.processId) {
      throw new Error('processId is required');
    }

    return { processId: obj.processId };
  }

  /**
   * Validate start process request
   * @param data Request data
   * @returns Validated start process request
   */
  private validateStartProcessRequest(data: unknown): {
    script_name: string;
    title: string;
    args?: string[];
    env_vars?: Record<string, string>;
    name?: string;
  } {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid request data');
    }

    const obj = data as Record<string, unknown>;
    
    if (typeof obj.script_name !== 'string' || !obj.script_name) {
      throw new Error('script_name is required');
    }
    
    if (typeof obj.title !== 'string' || !obj.title) {
      throw new Error('title is required');
    }

    const request: {
      script_name: string;
      title: string;
      args?: string[];
      env_vars?: Record<string, string>;
      name?: string;
    } = {
      script_name: obj.script_name,
      title: obj.title,
    };

    // Optional fields
    if (Array.isArray(obj.args)) {
      request.args = obj.args.filter(arg => typeof arg === 'string');
    }
    
    if (obj.env_vars && typeof obj.env_vars === 'object') {
      request.env_vars = obj.env_vars as Record<string, string>;
    }
    
    if (typeof obj.name === 'string') {
      request.name = obj.name;
    }

    return request;
  }

  /**
   * Validate stop process request
   * @param data Request data
   * @returns Validated request with processId and force flag
   */
  private validateStopProcessRequest(data: unknown): { processId: string; force?: boolean } {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid request data');
    }

    const obj = data as Record<string, unknown>;
    if (typeof obj.processId !== 'string' || !obj.processId) {
      throw new Error('processId is required');
    }

    return {
      processId: obj.processId,
      force: obj.force === true,
    };
  }

  /**
   * Validate get logs request
   * @param data Request data
   * @returns Validated logs request
   */
  private validateGetLogsRequest(data: unknown): {
    processId: string;
    limit?: number;
    offset?: number;
    type?: 'stdout' | 'stderr' | 'system';
  } {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid request data');
    }

    const obj = data as Record<string, unknown>;
    if (typeof obj.processId !== 'string' || !obj.processId) {
      throw new Error('processId is required');
    }

    const request: {
      processId: string;
      limit?: number;
      offset?: number;
      type?: 'stdout' | 'stderr' | 'system';
    } = {
      processId: obj.processId,
    };

    // Optional fields
    if (typeof obj.limit === 'number' && obj.limit > 0) {
      request.limit = Math.min(obj.limit, 1000); // Cap at 1000
    }
    
    if (typeof obj.offset === 'number' && obj.offset >= 0) {
      request.offset = obj.offset;
    }
    
    if (typeof obj.type === 'string' && ['stdout', 'stderr', 'system'].includes(obj.type)) {
      request.type = obj.type as 'stdout' | 'stderr' | 'system';
    }

    return request;
  }

  /**
   * Send response message to connection
   * @param connection WebSocket connection
   * @param message Message to send
   */
  private async sendResponse(connection: WebSocketConnection, message: WebSocketMessage): Promise<void> {
    if (connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message to connection
   * @param connection WebSocket connection
   * @param message Error message
   * @param error Optional error object
   */
  private async sendError(connection: WebSocketConnection, message: string, error?: unknown): Promise<void> {
    await this.sendResponse(connection, {
      type: 'error',
      data: {
        code: 'REQUEST_ERROR',
        message,
        details: error instanceof Error ? error.message : undefined,
      },
    });
  }

  /**
   * Register all handlers with the WebSocket server
   * @param server WebSocket server instance
   */
  registerHandlers(server: { registerHandler: (type: string, handler: (connection: WebSocketConnection, data: unknown) => Promise<void>) => void }): void {
    server.registerHandler('list_processes', this.handleListProcesses.bind(this));
    server.registerHandler('get_process_status', this.handleGetProcessStatus.bind(this));
    server.registerHandler('start_process', this.handleStartProcess.bind(this));
    server.registerHandler('stop_process', this.handleStopProcess.bind(this));
    server.registerHandler('get_process_logs', this.handleGetProcessLogs.bind(this));
    
    logger.log('ProcessWebSocketHandlers', 'Registered 5 message handlers');
  }
}