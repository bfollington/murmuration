import { ProcessRegistry } from './registry.ts';
import { ProcessEntry, ProcessStatus, LogEntry } from '../shared/types.ts';
import {
  StartProcessRequest,
  ProcessOptions,
  ProcessCreationResult,
  ProcessMonitoringConfig,
  ProcessTerminationOptions,
  ProcessQuery,
  ProcessStats,
  ProcessEvents,
  isValidStartProcessRequest,
  isValidStateTransition
} from './types.ts';
import { logger } from '../shared/logger.ts';
import { EventEmitter } from '../shared/event-emitter.ts';

/**
 * ProcessManager - Core process orchestration and lifecycle management
 * 
 * Provides high-level process management operations including spawning,
 * monitoring, and state management. Uses ProcessRegistry for persistence
 * and Deno.Command for process execution.
 */
export class ProcessManager {
  private readonly registry: ProcessRegistry;
  private readonly monitoringConfig: ProcessMonitoringConfig;
  private readonly activeMonitors = new Map<string, AbortController>();
  private readonly events = new EventEmitter<ProcessEvents>();

  /**
   * Initialize ProcessManager with dependency-injected ProcessRegistry
   * @param registry - ProcessRegistry instance for process storage
   * @param monitoringConfig - Configuration for process monitoring
   */
  constructor(registry: ProcessRegistry, monitoringConfig: ProcessMonitoringConfig = {}) {
    this.registry = registry;
    this.monitoringConfig = {
      logBufferSize: 1000,
      heartbeatInterval: 5000,
      maxRestarts: 3,
      ...monitoringConfig
    };
  }

  /**
   * Spawn a new process from a StartProcessRequest
   * @param request - The process start request containing script and options
   * @returns ProcessCreationResult with success status and process details
   */
  async spawnProcess(request: StartProcessRequest): Promise<ProcessCreationResult> {
    // Validate input request
    if (!isValidStartProcessRequest(request)) {
      return {
        success: false,
        error: 'Invalid start process request: missing or invalid required fields'
      };
    }

    try {
      // Generate unique process ID
      const processId = ProcessRegistry.generateProcessId();
      
      // Convert StartProcessRequest to ProcessOptions
      const processOptions = this.convertRequestToOptions(request);
      
      // Create initial ProcessEntry with 'starting' status
      const processEntry: ProcessEntry = {
        id: processId,
        title: request.title,
        name: request.name || request.script_name,
        command: processOptions.command,
        status: ProcessStatus.starting,
        startTime: new Date(),
        logs: [],
        metadata: {
          originalRequest: { ...request },
          options: { ...processOptions }
        }
      };

      // Register process in 'starting' state
      this.registry.addProcess(processEntry);

      // Create system log entry for process creation
      const creationLog: LogEntry = {
        timestamp: new Date(),
        type: 'system',
        content: `Process ${processId} created with command: ${processOptions.command.join(' ')}`
      };

      // Spawn the actual process using Deno.Command
      let childProcess: Deno.ChildProcess;
      try {
        const command = new Deno.Command(processOptions.command[0], {
          args: processOptions.command.slice(1),
          cwd: processOptions.cwd,
          env: processOptions.env,
          stdout: 'piped',
          stderr: 'piped',
          stdin: 'null'
        });

        childProcess = command.spawn();
      } catch (spawnError) {
        // Handle spawn failure - update status to failed
        const errorMessage = spawnError instanceof Error ? spawnError.message : 'Unknown spawn error';
        const failureLog: LogEntry = {
          timestamp: new Date(),
          type: 'system',
          content: `Process spawn failed: ${errorMessage}`
        };

        this.registry.updateProcess(processId, {
          status: ProcessStatus.failed,
          endTime: new Date(),
          logs: [creationLog, failureLog]
        });
        
        const failedProcess = this.registry.getProcess(processId);
        if (failedProcess) {
          this.events.emit('process:state_changed', {
            processId,
            from: ProcessStatus.starting,
            to: ProcessStatus.failed
          });
          this.events.emit('process:failed', {
            processId,
            process: failedProcess,
            error: errorMessage
          });
        }

        return {
          success: false,
          processId,
          error: `Failed to spawn process: ${errorMessage}`
        };
      }

      // Process spawned successfully - update to running status
      const successLog: LogEntry = {
        timestamp: new Date(),
        type: 'system',
        content: `Process ${processId} spawned successfully with PID: ${childProcess.pid}`
      };

      // Validate state transition from starting to running
      if (!isValidStateTransition(ProcessStatus.starting, ProcessStatus.running)) {
        throw new Error('Invalid state transition from starting to running');
      }

      const updatedProcess = this.registry.updateProcess(processId, {
        status: ProcessStatus.running,
        pid: childProcess.pid,
        child: childProcess,
        logs: [creationLog, successLog]
      });
      
      // Emit state change event
      if (updatedProcess) {
        this.events.emit('process:state_changed', {
          processId,
          from: ProcessStatus.starting,
          to: ProcessStatus.running
        });
      }

      if (!updatedProcess) {
        return {
          success: false,
          processId,
          error: 'Failed to update process status after spawn'
        };
      }

      // Get the updated process entry to return
      const finalProcess = this.registry.getProcess(processId);
      if (!finalProcess) {
        return {
          success: false,
          processId,
          error: 'Process disappeared after creation'
        };
      }

      // Start monitoring the spawned process
      this.startMonitoring(processId);
      
      // Emit process started event
      this.events.emit('process:started', {
        processId,
        process: finalProcess
      });

      return {
        success: true,
        processId,
        process: finalProcess
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during process creation';
      
      return {
        success: false,
        error: `Process creation failed: ${errorMessage}`
      };
    }
  }

  /**
   * Convert StartProcessRequest to internal ProcessOptions format
   * @param request - The incoming start process request
   * @returns ProcessOptions for internal use
   * @private
   */
  private convertRequestToOptions(request: StartProcessRequest): ProcessOptions {
    const command = [request.script_name, ...(request.args || [])];
    
    return {
      command,
      env: request.env_vars,
      // Set default working directory to current directory
      cwd: Deno.cwd()
    };
  }

  /**
   * Get process by ID from registry
   * @param processId - The process ID to retrieve
   * @returns ProcessEntry if found, undefined otherwise
   */
  getProcess(processId: string): ProcessEntry | undefined {
    return this.registry.getProcess(processId);
  }

  /**
   * Get all processes from registry
   * @returns Array of all ProcessEntry objects
   */
  getAllProcesses(): ProcessEntry[] {
    return this.registry.getAllProcesses();
  }

  /**
   * Get processes by status
   * @param status - The ProcessStatus to filter by
   * @returns Array of ProcessEntry objects with matching status
   */
  getProcessesByStatus(status: ProcessStatus): ProcessEntry[] {
    return this.registry.getProcessesByStatus(status);
  }

  /**
   * Check if a process exists
   * @param processId - The process ID to check
   * @returns true if process exists, false otherwise
   */
  hasProcess(processId: string): boolean {
    return this.registry.hasProcess(processId);
  }

  /**
   * Get total number of managed processes
   * @returns Number of processes in registry
   */
  getProcessCount(): number {
    return this.registry.getProcessCount();
  }

  /**
   * Get detailed process status information by ID
   * @param processId - The process ID to retrieve status for
   * @returns ProcessEntry if found, undefined if process doesn't exist
   */
  getProcessStatus(processId: string): ProcessEntry | undefined {
    if (!processId || typeof processId !== 'string') {
      return undefined;
    }
    
    return this.registry.getProcess(processId);
  }

  /**
   * Get process logs with optional filtering and line limits
   * @param processId - The process ID to get logs for
   * @param lines - Optional maximum number of recent log lines to return
   * @param logType - Optional filter for log type ('stdout', 'stderr', 'system')
   * @returns Array of LogEntry objects, or undefined if process doesn't exist
   */
  getProcessLogs(processId: string, lines?: number, logType?: 'stdout' | 'stderr' | 'system'): LogEntry[] | undefined {
    if (!processId || typeof processId !== 'string') {
      return undefined;
    }

    const process = this.registry.getProcess(processId);
    if (!process) {
      return undefined;
    }

    let logs = process.logs;

    // Filter by log type if specified
    if (logType) {
      logs = logs.filter(log => log.type === logType);
    }

    // Apply line limit if specified
    if (lines && lines > 0) {
      logs = logs.slice(-lines);
    }

    // Return a copy to prevent mutations
    return logs.map(log => ({ ...log, timestamp: new Date(log.timestamp) }));
  }

  /**
   * List processes with comprehensive filtering, pagination, and sorting
   * @param query - Optional ProcessQuery with filtering and pagination options
   * @returns Array of ProcessEntry objects matching the query criteria
   */
  listProcesses(query: ProcessQuery = {}): ProcessEntry[] {
    // Validate and sanitize query parameters
    const validatedQuery = this.validateProcessQuery(query);
    let processes = this.registry.getAllProcesses();

    // Apply status filter
    if (validatedQuery.status) {
      processes = processes.filter(process => process.status === validatedQuery.status);
    }

    // Apply name filter (supports partial matching)
    if (validatedQuery.name) {
      const namePattern = validatedQuery.name.toLowerCase();
      processes = processes.filter(process => 
        process.name.toLowerCase().includes(namePattern)
      );
    }

    // Apply sorting
    const sortBy = validatedQuery.sortBy || 'startTime';
    const sortOrder = validatedQuery.sortOrder || 'desc';
    
    processes.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case 'startTime':
          comparison = a.startTime.getTime() - b.startTime.getTime();
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        default:
          comparison = a.startTime.getTime() - b.startTime.getTime();
      }
      
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // Apply pagination
    const offset = Math.max(0, validatedQuery.offset || 0);
    const limit = validatedQuery.limit;
    
    if (limit) {
      return processes.slice(offset, offset + limit);
    } else if (offset > 0) {
      return processes.slice(offset);
    }
    
    return processes;
  }

  /**
   * Generate comprehensive process statistics for monitoring
   * @returns ProcessStats object with counts and metrics
   */
  getProcessStats(): ProcessStats {
    const allProcesses = this.registry.getAllProcesses();
    const totalProcesses = allProcesses.length;
    
    // Count processes by status
    const runningProcesses = allProcesses.filter(p => p.status === ProcessStatus.running).length;
    const failedProcesses = allProcesses.filter(p => p.status === ProcessStatus.failed).length;
    const completedProcesses = allProcesses.filter(p => p.status === ProcessStatus.stopped).length;
    
    // Calculate average runtime for completed processes
    const completedWithEndTime = allProcesses.filter(p => 
      p.status === ProcessStatus.stopped && p.endTime
    );
    
    let averageRuntime = 0;
    if (completedWithEndTime.length > 0) {
      const totalRuntime = completedWithEndTime.reduce((sum, process) => {
        if (process.endTime) {
          return sum + (process.endTime.getTime() - process.startTime.getTime());
        }
        return sum;
      }, 0);
      averageRuntime = totalRuntime / completedWithEndTime.length;
    }

    return {
      totalProcesses,
      runningProcesses,
      failedProcesses,
      completedProcesses,
      averageRuntime
    };
  }

  /**
   * Validate ProcessQuery parameters and apply defaults for invalid values
   * @param query - The ProcessQuery to validate
   * @returns Validated ProcessQuery with sanitized values
   * @private
   */
  private validateProcessQuery(query: ProcessQuery): ProcessQuery {
    const validatedQuery: ProcessQuery = {};

    // Validate status filter
    if (query.status && Object.values(ProcessStatus).includes(query.status)) {
      validatedQuery.status = query.status;
    }

    // Validate name filter (must be non-empty string)
    if (query.name && typeof query.name === 'string' && query.name.trim().length > 0) {
      validatedQuery.name = query.name.trim();
    }

    // Validate limit (must be positive integer)
    if (query.limit && Number.isInteger(query.limit) && query.limit > 0) {
      validatedQuery.limit = Math.min(query.limit, 1000); // Cap at 1000 for performance
    }

    // Validate offset (must be non-negative integer)
    if (query.offset && Number.isInteger(query.offset) && query.offset >= 0) {
      validatedQuery.offset = query.offset;
    }

    // Validate sortBy field
    const validSortFields = ['startTime', 'name', 'status'] as const;
    if (query.sortBy && validSortFields.includes(query.sortBy)) {
      validatedQuery.sortBy = query.sortBy;
    }

    // Validate sortOrder
    if (query.sortOrder && (query.sortOrder === 'asc' || query.sortOrder === 'desc')) {
      validatedQuery.sortOrder = query.sortOrder;
    }

    return validatedQuery;
  }

  /**
   * Start comprehensive monitoring for a process including stream capture and exit detection
   * @param processId - The process ID to monitor
   */
  startMonitoring(processId: string): void {
    const process = this.registry.getProcess(processId);
    if (!process?.child) {
      this.addSystemLog(processId, `Cannot start monitoring: process ${processId} not found or has no child process`);
      return;
    }

    // Create abort controller for this monitoring session
    const abortController = new AbortController();
    this.activeMonitors.set(processId, abortController);

    this.addSystemLog(processId, `Starting monitoring for process ${processId}`);

    // Start stdout stream monitoring
    if (process.child.stdout) {
      this.monitorStream(processId, process.child.stdout, 'stdout', abortController.signal);
    }

    // Start stderr stream monitoring
    if (process.child.stderr) {
      this.monitorStream(processId, process.child.stderr, 'stderr', abortController.signal);
    }

    // Start process exit monitoring
    this.monitorProcessExit(processId, process.child, abortController.signal);
  }

  /**
   * Monitor a readable stream and convert output to LogEntry objects
   * @param processId - The process ID being monitored
   * @param stream - The readable stream to monitor
   * @param logType - The type of log entry ('stdout' or 'stderr')
   * @param signal - AbortSignal for cleanup
   * @private
   */
  private async monitorStream(
    processId: string, 
    stream: ReadableStream<Uint8Array>, 
    logType: 'stdout' | 'stderr',
    signal: AbortSignal
  ): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    
    try {
      reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        try {
          const { done, value } = await reader.read();
          
          if (done) {
            // Process any remaining buffer content
            if (buffer.trim()) {
              this.addStreamLog(processId, logType, buffer.trim());
            }
            break;
          }

          if (value) {
            buffer += decoder.decode(value, { stream: true });
            
            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
              if (line.trim()) {
                this.addStreamLog(processId, logType, line);
              }
            }
          }
        } catch (streamError) {
          if (!signal.aborted) {
            this.addSystemLog(processId, `Stream monitoring error (${logType}): ${streamError}`);
          }
          break;
        }
      }
    } catch (error) {
      if (!signal.aborted) {
        this.addSystemLog(processId, `Failed to monitor ${logType} stream: ${error}`);
      }
    } finally {
      // Ensure reader is properly released
      if (reader) {
        try {
          reader.releaseLock();
        } catch {
          // Ignore release errors
        }
      }
    }
  }

  /**
   * Monitor process exit and update status accordingly
   * @param processId - The process ID being monitored
   * @param childProcess - The child process to monitor
   * @param signal - AbortSignal for cleanup
   * @private
   */
  private async monitorProcessExit(
    processId: string, 
    childProcess: Deno.ChildProcess,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const status = await childProcess.status;
      
      if (signal.aborted) {
        return;
      }

      const endTime = new Date();
      const exitCode = status.code;
      const exitSignal = status.signal;

      // Determine final status based on exit conditions
      const finalStatus = exitCode === 0 ? ProcessStatus.stopped : ProcessStatus.failed;
      
      // Create exit log message
      let exitMessage = `Process ${processId} exited with code ${exitCode}`;
      if (exitSignal) {
        exitMessage += ` (signal: ${exitSignal})`;
      }

      // Validate state transition
      const currentProcess = this.registry.getProcess(processId);
      if (currentProcess && isValidStateTransition(currentProcess.status, finalStatus)) {
        const previousStatus = currentProcess.status;
        
        // Update process status with exit information
        const updateData: Partial<ProcessEntry> = {
          status: finalStatus,
          endTime,
          exitCode
        };
        
        if (exitSignal) {
          updateData.exitSignal = exitSignal;
        }
        
        this.registry.updateProcess(processId, updateData);

        this.addSystemLog(processId, exitMessage);
        
        // Emit state change event
        this.events.emit('process:state_changed', {
          processId,
          from: previousStatus,
          to: finalStatus
        });
        
        // Get updated process for event
        const updatedProcess = this.registry.getProcess(processId);
        if (updatedProcess) {
          if (finalStatus === ProcessStatus.stopped) {
            this.events.emit('process:stopped', {
              processId,
              process: updatedProcess
            });
          } else {
            this.events.emit('process:failed', {
              processId,
              process: updatedProcess,
              error: `Process exited with code ${exitCode}`
            });
          }
        }
      } else {
        this.addSystemLog(processId, `Invalid state transition for process exit: ${currentProcess?.status} -> ${finalStatus}`);
      }

      // Clean up monitoring and resources
      this.cleanupProcess(processId);

    } catch (error) {
      if (!signal.aborted) {
        this.addSystemLog(processId, `Process exit monitoring failed: ${error}`);
        
        // Get current process for previous status
        const currentProcess = this.registry.getProcess(processId);
        const previousStatus = currentProcess?.status || ProcessStatus.running;
        
        // Try to update to failed status
        this.registry.updateProcess(processId, {
          status: ProcessStatus.failed,
          endTime: new Date()
        });
        
        // Emit events
        if (currentProcess) {
          this.events.emit('process:state_changed', {
            processId,
            from: previousStatus,
            to: ProcessStatus.failed
          });
          
          const failedProcess = this.registry.getProcess(processId);
          if (failedProcess) {
            this.events.emit('process:failed', {
              processId,
              process: failedProcess,
              error: error instanceof Error ? error.message : 'Process monitoring failed'
            });
          }
        }
        
        this.cleanupProcess(processId);
      }
    }
  }

  /**
   * Stop monitoring for a specific process
   * @param processId - The process ID to stop monitoring
   */
  stopMonitoring(processId: string): void {
    const abortController = this.activeMonitors.get(processId);
    if (abortController) {
      abortController.abort();
      this.activeMonitors.delete(processId);
      
      // Add system log only if the process still exists in registry
      if (this.registry.hasProcess(processId)) {
        this.addSystemLog(processId, `Stopped monitoring for process ${processId}`);
      }
    }
  }

  /**
   * Add a system log entry to a process
   * @param processId - The process ID to add the log to
   * @param content - The log content
   * @private
   */
  private addSystemLog(processId: string, content: string): void {
    const logEntry: LogEntry = {
      timestamp: new Date(),
      type: 'system',
      content
    };

    this.addLogEntry(processId, logEntry);
  }

  /**
   * Add a stream log entry to a process
   * @param processId - The process ID to add the log to
   * @param logType - The type of stream log ('stdout' or 'stderr')
   * @param content - The log content
   * @private
   */
  private addStreamLog(processId: string, logType: 'stdout' | 'stderr', content: string): void {
    const logEntry: LogEntry = {
      timestamp: new Date(),
      type: logType,
      content
    };

    this.addLogEntry(processId, logEntry);
  }

  /**
   * Add a log entry to a process with log rotation
   * @param processId - The process ID to add the log to
   * @param logEntry - The log entry to add
   * @private
   */
  private addLogEntry(processId: string, logEntry: LogEntry): void {
    const process = this.registry.getProcess(processId);
    if (!process) {
      return;
    }

    // Add new log entry
    const updatedLogs = [...process.logs, logEntry];

    // Apply log rotation if buffer exceeds configured limit
    const maxLogs = this.monitoringConfig.logBufferSize || 1000;
    if (updatedLogs.length > maxLogs) {
      // Keep only the most recent entries
      const rotatedLogs = updatedLogs.slice(-maxLogs);
      this.registry.updateProcess(processId, { logs: rotatedLogs });
    } else {
      this.registry.updateProcess(processId, { logs: updatedLogs });
    }
    
    // Emit log added event
    this.events.emit('process:log_added', {
      processId,
      log: logEntry
    });
  }

  /**
   * Get monitoring status for a process
   * @param processId - The process ID to check
   * @returns true if process is being monitored, false otherwise
   */
  isMonitoring(processId: string): boolean {
    return this.activeMonitors.has(processId);
  }

  /**
   * Stop all active monitoring sessions
   */
  stopAllMonitoring(): void {
    for (const [processId] of this.activeMonitors) {
      this.stopMonitoring(processId);
    }
  }

  /**
   * Get the current monitoring configuration
   * @returns ProcessMonitoringConfig object
   */
  getMonitoringConfig(): ProcessMonitoringConfig {
    return { ...this.monitoringConfig };
  }

  /**
   * Stop a running process with optional termination options
   * @param processId - The process ID to terminate
   * @param options - Optional termination options (force, timeout)
   * @returns Promise that resolves when termination is complete
   */
  async stopProcess(processId: string, options: ProcessTerminationOptions = {}): Promise<void> {
    const process = this.registry.getProcess(processId);
    if (!process) {
      this.addSystemLog(processId, `Cannot stop process ${processId}: process not found`);
      return;
    }

    // Check if process is already terminated
    if (process.status === ProcessStatus.stopped || process.status === ProcessStatus.failed) {
      this.addSystemLog(processId, `Process ${processId} is already terminated (status: ${process.status})`);
      return;
    }

    // Check if process has no child process to terminate
    if (!process.child) {
      this.addSystemLog(processId, `Cannot stop process ${processId}: no child process found`);
      // Update status to stopped since there's nothing to terminate
      if (isValidStateTransition(process.status, ProcessStatus.stopped)) {
        this.registry.updateProcess(processId, {
          status: ProcessStatus.stopped,
          endTime: new Date()
        });
      }
      return;
    }

    // Validate state transition to stopping
    if (!isValidStateTransition(process.status, ProcessStatus.stopping)) {
      this.addSystemLog(processId, `Invalid state transition: cannot stop process in ${process.status} state`);
      return;
    }

    // Update status to stopping
    this.registry.updateProcess(processId, {
      status: ProcessStatus.stopping
    });

    const { force = false, timeout = 5000 } = options;
    
    this.addSystemLog(processId, `Terminating process ${processId} (PID: ${process.child.pid}, force: ${force}, timeout: ${timeout}ms)`);

    try {
      if (force) {
        // Forced termination with SIGKILL
        await this.forceTerminateProcess(processId, process.child);
      } else {
        // Graceful termination with timeout escalation
        await this.gracefullyTerminateProcess(processId, process.child, timeout);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown termination error';
      this.addSystemLog(processId, `Termination failed: ${errorMessage}`);
      
      // Update to failed status if still in stopping state
      const currentProcess = this.registry.getProcess(processId);
      if (currentProcess?.status === ProcessStatus.stopping && 
          isValidStateTransition(ProcessStatus.stopping, ProcessStatus.failed)) {
        this.registry.updateProcess(processId, {
          status: ProcessStatus.failed,
          endTime: new Date()
        });
      }
      
      // Ensure cleanup happens even if termination fails
      this.cleanupProcess(processId);
      throw error;
    }
  }

  /**
   * Gracefully terminate a process with timeout escalation to forced termination
   * @param processId - The process ID being terminated
   * @param childProcess - The child process to terminate
   * @param timeout - Grace period before forcing termination
   * @private
   */
  private async gracefullyTerminateProcess(
    processId: string, 
    childProcess: Deno.ChildProcess, 
    timeout: number
  ): Promise<void> {
    this.addSystemLog(processId, `Sending SIGTERM to process ${processId}`);
    
    try {
      // Send SIGTERM for graceful shutdown
      childProcess.kill('SIGTERM');
      
      // Wait for graceful exit with timeout
      const gracefulExitPromise = childProcess.status;
      let timeoutId: number | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Graceful termination timeout')), timeout);
      });
      
      try {
        await Promise.race([gracefulExitPromise, timeoutPromise]);
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        this.addSystemLog(processId, `Process ${processId} terminated gracefully`);
        
        // Update process with termination metadata
        this.updateProcessOnTermination(processId, 'graceful');
      } catch (timeoutError) {
        // Graceful termination timed out, escalate to forced termination
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        this.addSystemLog(processId, `Graceful termination timed out after ${timeout}ms, escalating to SIGKILL`);
        await this.forceTerminateProcess(processId, childProcess);
      }
    } catch (error) {
      // SIGTERM failed, try SIGKILL immediately
      this.addSystemLog(processId, `SIGTERM failed, attempting SIGKILL: ${error}`);
      await this.forceTerminateProcess(processId, childProcess);
    }
  }

  /**
   * Force terminate a process using SIGKILL
   * @param processId - The process ID being terminated
   * @param childProcess - The child process to terminate
   * @private
   */
  private async forceTerminateProcess(processId: string, childProcess: Deno.ChildProcess): Promise<void> {
    this.addSystemLog(processId, `Sending SIGKILL to process ${processId}`);
    
    try {
      childProcess.kill('SIGKILL');
      
      // Wait for forced exit (should be immediate)
      await childProcess.status;
      this.addSystemLog(processId, `Process ${processId} force terminated`);
      
      // Update process with termination metadata
      this.updateProcessOnTermination(processId, 'forced');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown force termination error';
      this.addSystemLog(processId, `Force termination failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Update process entry with termination metadata
   * @param processId - The process ID that was terminated
   * @param method - The termination method used ('graceful' or 'forced')
   * @private
   */
  private updateProcessOnTermination(processId: string, method: 'graceful' | 'forced'): void {
    const process = this.registry.getProcess(processId);
    if (!process) return;

    // Update metadata with termination method
    const updatedMetadata = {
      ...process.metadata,
      terminationMethod: method,
      terminationTime: new Date().toISOString()
    };

    this.registry.updateProcess(processId, {
      metadata: updatedMetadata
    });
  }

  /**
   * Clean up resources associated with a process
   * @param processId - The process ID to clean up
   * @private
   */
  private cleanupProcess(processId: string): void {
    // Stop monitoring to clean up streams and abort controllers
    this.stopMonitoring(processId);
    
    const process = this.registry.getProcess(processId);
    if (!process) return;

    // Stream cleanup is handled by monitorStream() when abort signal is triggered
    // No need to manually clean up streams here as it can cause reader conflicts

    this.addSystemLog(processId, `Cleaned up resources for process ${processId}`);
  }

  /**
   * Shutdown the ProcessManager, terminating all running processes and cleaning up resources
   * @param options - Optional shutdown options
   * @returns Promise that resolves when shutdown is complete
   */
  async shutdown(options: { timeout?: number; force?: boolean } = {}): Promise<void> {
    const { timeout = 10000, force = false } = options;
    
    this.addSystemWideLog(`ProcessManager shutdown initiated (timeout: ${timeout}ms, force: ${force})`);
    
    // Get all processes that need termination
    const runningProcesses = this.registry.getAllProcesses().filter(p => 
      p.status === ProcessStatus.running || p.status === ProcessStatus.starting
    );
    
    if (runningProcesses.length === 0) {
      this.addSystemWideLog('No running processes to terminate during shutdown');
      this.stopAllMonitoring();
      return;
    }

    this.addSystemWideLog(`Terminating ${runningProcesses.length} running processes`);
    
    // Terminate all running processes
    const terminationPromises = runningProcesses.map(async (process) => {
      try {
        await this.stopProcess(process.id, { force, timeout: Math.floor(timeout / 2) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.addSystemWideLog(`Failed to stop process ${process.id} during shutdown: ${errorMessage}`);
      }
    });

    // Wait for all terminations with overall timeout
    try {
      const shutdownPromise = Promise.all(terminationPromises);
      let shutdownTimeoutId: number | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        shutdownTimeoutId = setTimeout(() => reject(new Error('Shutdown timeout exceeded')), timeout);
      });
      
      await Promise.race([shutdownPromise, timeoutPromise]);
      if (shutdownTimeoutId !== undefined) clearTimeout(shutdownTimeoutId);
      this.addSystemWideLog('All processes terminated successfully during shutdown');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown shutdown error';
      this.addSystemWideLog(`Shutdown timeout exceeded or failed: ${errorMessage}`);
      
      // Force terminate any remaining processes
      const stillRunning = this.registry.getAllProcesses().filter(p => 
        p.status === ProcessStatus.running || p.status === ProcessStatus.starting || p.status === ProcessStatus.stopping
      );
      
      if (stillRunning.length > 0) {
        this.addSystemWideLog(`Force terminating ${stillRunning.length} remaining processes`);
        await Promise.all(stillRunning.map(async (process) => {
          try {
            if (process.child) {
              process.child.kill('SIGKILL');
              await process.child.status;
            }
            this.cleanupProcess(process.id);
          } catch {
            // Ignore force termination errors
          }
        }));
      }
    }

    // Final cleanup
    this.stopAllMonitoring();
    this.addSystemWideLog('ProcessManager shutdown complete');
  }

  /**
   * Add a system log entry for system-wide events
   * @param content - The log content
   * @private
   */
  private addSystemWideLog(content: string): void {
    // For system-wide logs, we use logger for immediate feedback
    // In a production system, this could be sent to a centralized logging system
    logger.log('ProcessManager', content);
  }
  
  /**
   * Subscribe to process events
   * @param event Event name
   * @param listener Event listener
   * @returns Unsubscribe function
   */
  on<K extends keyof ProcessEvents>(event: K, listener: (data: ProcessEvents[K]) => void): () => void {
    return this.events.on(event, listener);
  }
  
  /**
   * Unsubscribe from all events of a specific type
   * @param event Event name
   */
  off<K extends keyof ProcessEvents>(event?: K): void {
    this.events.removeAllListeners(event);
  }
}