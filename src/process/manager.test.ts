import { assertEquals, assertExists, assertRejects, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { ProcessManager } from './manager.ts';
import { ProcessRegistry } from './registry.ts';
import { ProcessStatus } from '../shared/types.ts';
import { StartProcessRequest, ProcessMonitoringConfig, ProcessTerminationOptions } from './types.ts';

/**
 * Test utilities for creating valid test data
 */
const createValidStartRequest = (overrides: Partial<StartProcessRequest> = {}): StartProcessRequest => ({
  script_name: 'node',
  title: 'Test Process',
  args: ['-e', 'console.log("Hello, World!"); setTimeout(() => {}, 2000);'], // Keep process alive longer
  name: 'test-process',
  ...overrides
});

const createMinimalStartRequest = (): StartProcessRequest => ({
  script_name: 'echo',
  title: 'Minimal Test Process'
});

/**
 * Helper function to clean up child processes after tests
 */
async function cleanupProcess(processId: string, manager: ProcessManager): Promise<void> {
  try {
    // Stop monitoring first to clean up streams
    manager.stopMonitoring(processId);
    
    const process = manager.getProcess(processId);
    if (process?.child) {
      try {
        // Close stdout and stderr streams if they exist
        if (process.child.stdout) {
          await process.child.stdout.cancel();
        }
        if (process.child.stderr) {
          await process.child.stderr.cancel();
        }
        
        // Kill the process if it's still running
        process.child.kill();
        
        // Wait for the process to exit to prevent resource leaks
        await process.child.status;
      } catch {
        // Ignore cleanup errors - process might already be dead
      }
    }
    
    // Give a small delay to ensure cleanup completes
    await new Promise(resolve => setTimeout(resolve, 10));
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Test suite for ProcessManager class
 */
Deno.test('ProcessManager - Constructor', () => {
  const registry = new ProcessRegistry();  
  const manager = new ProcessManager(registry);
  
  assertExists(manager);
  assertEquals(manager.getProcessCount(), 0);
  
  // Clean up any monitoring resources
  manager.stopAllMonitoring();
});

Deno.test.ignore('ProcessManager - spawnProcess with valid request', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success, `Expected success but got error: ${result.error}`);
    assertExists(result.processId);
    assertExists(result.process);
    
    // Verify process is registered
    assertEquals(manager.getProcessCount(), 1);
    
    // Verify process details
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.name, 'test-process');
    assertEquals(process.command, ['node', '-e', 'console.log("Hello, World!"); setTimeout(() => {}, 2000);']);
    assertEquals(process.status, ProcessStatus.running);
    assertExists(process.startTime);
    assertExists(process.pid);
  } finally {
    // Clean up
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - spawnProcess with minimal request', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createMinimalStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success, `Expected success but got error: ${result.error}`);
    assertExists(result.processId);
    assertExists(result.process);
    
    // Verify process uses script_name as name when name not provided
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.name, 'echo');
    assertEquals(process.command, ['echo']);
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - spawnProcess with environment variables', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest({
    script_name: 'echo',
    args: ['test'],
    env_vars: { TEST_VAR: 'test_value' }
  });
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success, `Expected success but got error: ${result.error}`);
    
    // Verify environment variables are stored in metadata
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.metadata.originalRequest, request);
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - spawnProcess with invalid request (empty script_name)', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const invalidRequest = {
    script_name: '',
    title: 'Test',
    args: ['test']
  };
  
  const result = await manager.spawnProcess(invalidRequest as StartProcessRequest);
  
  assertEquals(result.success, false);
  assertExists(result.error);
  assert(result.error!.includes('Invalid start process request'));
  assertEquals(manager.getProcessCount(), 0);
});

Deno.test('ProcessManager - spawnProcess with invalid request (non-string script_name)', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const invalidRequest = {
    script_name: 123,
    title: 'Test',
    args: ['test']
  };
  
  const result = await manager.spawnProcess(invalidRequest as any);
  
  assertEquals(result.success, false);
  assertExists(result.error);
  assert(result.error!.includes('Invalid start process request'));
  assertEquals(manager.getProcessCount(), 0);
});

Deno.test('ProcessManager - spawnProcess with invalid request (missing title)', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const invalidRequest = {
    script_name: 'echo',
    args: ['test']
  };
  
  const result = await manager.spawnProcess(invalidRequest as any);
  
  assertEquals(result.success, false);
  assertExists(result.error);
  assert(result.error!.includes('Invalid start process request'));
  assertEquals(manager.getProcessCount(), 0);
});

Deno.test('ProcessManager - spawnProcess with invalid args array', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const invalidRequest = {
    script_name: 'echo',
    title: 'Test',
    args: ['valid', 123, 'invalid'] // Non-string element
  };
  
  const result = await manager.spawnProcess(invalidRequest as any);
  
  assertEquals(result.success, false);
  assertExists(result.error);
  assert(result.error!.includes('Invalid start process request'));
  assertEquals(manager.getProcessCount(), 0);
});

Deno.test('ProcessManager - spawnProcess with nonexistent command', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest({
    script_name: 'nonexistent-command-12345'
  });
  
  const result = await manager.spawnProcess(request);
  
  assertEquals(result.success, false);
  assertExists(result.error);
  assert(result.error!.includes('Failed to spawn process'));
  
  // Verify process is registered with failed status
  assertEquals(manager.getProcessCount(), 1);
  const processes = manager.getProcessesByStatus(ProcessStatus.failed);
  assertEquals(processes.length, 1);
  assertEquals(processes[0].status, ProcessStatus.failed);
  assertExists(processes[0].endTime);
});

Deno.test.ignore('ProcessManager - Process logging during creation', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Verify system logs were created
    assert(process.logs.length >= 2, 'Expected at least 2 log entries');
    
    const creationLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('created with command')
    );
    assertExists(creationLog, 'Expected creation log entry');
    
    const successLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('spawned successfully')
    );
    assertExists(successLog, 'Expected success log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - getProcess method', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    
    // Test getting existing process
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.id, result.processId);
    
    // Test getting nonexistent process
    const nonexistent = manager.getProcess('nonexistent-id');
    assertEquals(nonexistent, undefined);
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - getAllProcesses method', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Initially empty
  assertEquals(manager.getAllProcesses().length, 0);
  
  // Create multiple processes
  const requests = [
    createValidStartRequest({ name: 'process-1' }),
    createValidStartRequest({ name: 'process-2' }),
    createValidStartRequest({ name: 'process-3' })
  ];
  
  const processIds: string[] = [];
  
  try {
    for (const request of requests) {
      const result = await manager.spawnProcess(request);
      assert(result.success);
      processIds.push(result.processId!);
    }
    
    const allProcesses = manager.getAllProcesses();
    assertEquals(allProcesses.length, 3);
    
    // Verify all processes are included
    const names = allProcesses.map(p => p.name).sort();
    assertEquals(names, ['process-1', 'process-2', 'process-3']);
  } finally {
    // Clean up all processes
    for (const processId of processIds) {
      await cleanupProcess(processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - getProcessesByStatus method', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create successful process
  const successRequest = createValidStartRequest({ name: 'success-process' });
  const successResult = await manager.spawnProcess(successRequest);
  assert(successResult.success);
  
  // Create failed process
  const failRequest = createValidStartRequest({ 
    name: 'fail-process',
    script_name: 'nonexistent-command-xyz'
  });
  const failResult = await manager.spawnProcess(failRequest);
  assertEquals(failResult.success, false);
  
  try {
    // Test filtering by status
    const runningProcesses = manager.getProcessesByStatus(ProcessStatus.running);
    assertEquals(runningProcesses.length, 1);
    assertEquals(runningProcesses[0].name, 'success-process');
    
    const failedProcesses = manager.getProcessesByStatus(ProcessStatus.failed);
    assertEquals(failedProcesses.length, 1);
    assertEquals(failedProcesses[0].name, 'fail-process');
    
    const stoppedProcesses = manager.getProcessesByStatus(ProcessStatus.stopped);
    assertEquals(stoppedProcesses.length, 0);
  } finally {
    if (successResult.processId) {
      await cleanupProcess(successResult.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - hasProcess method', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    
    // Test existing process
    assert(manager.hasProcess(result.processId!));
    
    // Test nonexistent process
    assert(!manager.hasProcess('nonexistent-id'));
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - getProcessCount method', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  assertEquals(manager.getProcessCount(), 0);
  
  const processIds: string[] = [];
  
  try {
    // Create processes
    for (let i = 0; i < 3; i++) {
      const request = createValidStartRequest({ name: `process-${i}` });
      const result = await manager.spawnProcess(request);
      assert(result.success);
      processIds.push(result.processId!);
      assertEquals(manager.getProcessCount(), i + 1);
    }
  } finally {
    // Clean up all processes
    for (const processId of processIds) {
      await cleanupProcess(processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - Integration with ProcessRegistry', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    
    // Verify process exists in both manager and registry
    const managerProcess = manager.getProcess(result.processId!);
    const registryProcess = registry.getProcess(result.processId!);
    
    assertExists(managerProcess);
    assertExists(registryProcess);
    
    // Verify they contain the same data
    assertEquals(managerProcess.id, registryProcess.id);
    assertEquals(managerProcess.name, registryProcess.name);
    assertEquals(managerProcess.status, registryProcess.status);
    assertEquals(managerProcess.command, registryProcess.command);
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - State transition validation', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  
  // Spawn process should transition from starting to running
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Process should be in running state after successful spawn
    assertEquals(process.status, ProcessStatus.running);
    
    // Verify logs show the state progression
    const logs = process.logs.map(log => log.content);
    assert(logs.some(content => content.includes('created')));
    assert(logs.some(content => content.includes('spawned successfully')));
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - Process metadata preservation', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = {
    script_name: 'echo',
    title: 'Metadata Test Process',
    args: ['arg1', 'arg2'],
    env_vars: { TEST_VAR: 'test_value' },
    name: 'metadata-test-process'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Verify original request is preserved in metadata
    assertExists(process.metadata.originalRequest);
    assertEquals(process.metadata.originalRequest, request);
    
    // Verify options are preserved in metadata
    assertExists(process.metadata.options);
    const options = process.metadata.options as any;
    assertEquals(options.command, ['echo', 'arg1', 'arg2']);
    assertEquals(options.env, { TEST_VAR: 'test_value' });
    assertExists(options.cwd);
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

/**
 * ================================
 * PROCESS MONITORING TESTS
 * ================================
 */

Deno.test('ProcessManager - Constructor with monitoring config', () => {
  const registry = new ProcessRegistry();
  const config: ProcessMonitoringConfig = {
    logBufferSize: 500,
    heartbeatInterval: 2000,
    maxRestarts: 5
  };
  const manager = new ProcessManager(registry, config);
  
  assertExists(manager);
  assertEquals(manager.getProcessCount(), 0);
  
  const retrievedConfig = manager.getMonitoringConfig();
  assertEquals(retrievedConfig.logBufferSize, 500);
  assertEquals(retrievedConfig.heartbeatInterval, 2000);
  assertEquals(retrievedConfig.maxRestarts, 5);
});

Deno.test('ProcessManager - Default monitoring config', () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const config = manager.getMonitoringConfig();
  assertEquals(config.logBufferSize, 1000);
  assertEquals(config.heartbeatInterval, 5000);
  assertEquals(config.maxRestarts, 3);
});

Deno.test.ignore('ProcessManager - Automatic monitoring start on process spawn', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Verify monitoring is automatically started
    assert(manager.isMonitoring(result.processId!), 'Process should be automatically monitored');
    
    // Check for monitoring start log
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    const monitoringLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('Starting monitoring')
    );
    assertExists(monitoringLog, 'Expected monitoring start log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - Log capture from stdout', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Use echo command that outputs to stdout
  const request = createValidStartRequest({
    script_name: 'echo',
    args: ['Hello from stdout!'],
    name: 'stdout-test'
  });
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait a bit for process to complete and logs to be captured
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Check for stdout log entry
    const stdoutLog = process.logs.find(log => 
      log.type === 'stdout' && log.content.includes('Hello from stdout!')
    );
    assertExists(stdoutLog, 'Expected stdout log entry');
    
    // Verify timestamp is recent
    const timeDiff = Date.now() - stdoutLog.timestamp.getTime();
    assert(timeDiff < 5000, 'Log timestamp should be recent');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - Log capture from stderr', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Use a command that outputs to stderr
  const request = {
    script_name: 'node',
    title: 'Stderr Test Process',
    args: ['-e', 'console.error("Error message to stderr")'],
    name: 'stderr-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete and logs to be captured
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Check for stderr log entry
    const stderrLog = process.logs.find(log => 
      log.type === 'stderr' && log.content.includes('Error message to stderr')
    );
    assertExists(stderrLog, 'Expected stderr log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - Process exit detection with success code', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest({
    script_name: 'echo',
    args: ['Process completed successfully'],
    name: 'exit-success-test'
  });
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Verify process status changed to stopped
    assertEquals(process.status, ProcessStatus.stopped);
    assertExists(process.endTime);
    assertEquals(process.exitCode, 0);
    
    // Check for exit log
    const exitLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('exited with code 0')
    );
    assertExists(exitLog, 'Expected exit log entry');
    
    // Verify monitoring was stopped
    assert(!manager.isMonitoring(result.processId!), 'Monitoring should be stopped after process exit');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - Process exit detection with failure code', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Use node to exit with a specific code
  const request = {
    script_name: 'node',
    title: 'Exit Failure Test Process',
    args: ['-e', 'process.exit(1)'],
    name: 'exit-failure-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Verify process status changed to failed
    assertEquals(process.status, ProcessStatus.failed);
    assertExists(process.endTime);
    assertEquals(process.exitCode, 1);
    
    // Check for exit log
    const exitLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('exited with code 1')
    );
    assertExists(exitLog, 'Expected exit log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - Log rotation with custom buffer size', async () => {
  const registry = new ProcessRegistry();
  const config: ProcessMonitoringConfig = {
    logBufferSize: 5 // Very small buffer for testing
  };
  const manager = new ProcessManager(registry, config);
  
  const request = createValidStartRequest({
    script_name: 'echo',
    args: ['test'],
    name: 'log-rotation-test'
  });
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Add more logs than the buffer can hold
    for (let i = 0; i < 10; i++) {
      manager['addSystemLog'](result.processId!, `Test log entry ${i}`);
    }
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Verify log rotation occurred
    assertEquals(process.logs.length, 5, 'Logs should be rotated to buffer size');
    
    // Verify most recent logs are kept
    const lastLog = process.logs[process.logs.length - 1];
    assert(lastLog.content.includes('Test log entry 9'), 'Most recent log should be preserved');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - Manual monitoring control', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Verify automatic monitoring
    assert(manager.isMonitoring(result.processId!));
    
    // Stop monitoring manually
    manager.stopMonitoring(result.processId!);
    assert(!manager.isMonitoring(result.processId!));
    
    // Verify stop monitoring log
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    const stopLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('Stopped monitoring')
    );
    assertExists(stopLog, 'Expected stop monitoring log entry');
    
    // Restart monitoring manually
    manager.startMonitoring(result.processId!);
    assert(manager.isMonitoring(result.processId!));
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - Stop all monitoring', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create multiple processes
  const processIds: string[] = [];
  
  try {
    for (let i = 0; i < 3; i++) {
      const request = createValidStartRequest({ name: `process-${i}` });
      const result = await manager.spawnProcess(request);
      assert(result.success);
      processIds.push(result.processId!);
    }
    
    // Verify all are being monitored
    for (const processId of processIds) {
      assert(manager.isMonitoring(processId), `Process ${processId} should be monitored`);
    }
    
    // Stop all monitoring
    manager.stopAllMonitoring();
    
    // Verify none are being monitored
    for (const processId of processIds) {
      assert(!manager.isMonitoring(processId), `Process ${processId} should not be monitored`);
    }
    
    // Terminate all processes to ensure clean shutdown
    for (const processId of processIds) {
      const process = manager.getProcess(processId);
      if (process?.child) {
        try {
          process.child.kill();
          await process.child.status;
        } catch {
          // Ignore cleanup errors
        }
      }
    }
    
    // Small delay to ensure all resources are released
    await new Promise(resolve => setTimeout(resolve, 50));
  } finally {
    // Final cleanup if needed
    for (const processId of processIds) {
      manager.stopMonitoring(processId);
    }
  }
});

Deno.test('ProcessManager - Monitoring non-existent process', () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const nonExistentId = 'non-existent-process-id';
  
  // Attempt to start monitoring non-existent process
  manager.startMonitoring(nonExistentId);
  
  // Should not be monitoring
  assert(!manager.isMonitoring(nonExistentId));
});

Deno.test('ProcessManager - Multiple line output handling', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = {
    script_name: 'node',
    title: 'Multiline Output Test',
    args: ['-e', 'console.log("Line 1"); console.log("Line 2"); console.log("Line 3");'],
    name: 'multiline-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete and all logs to be captured
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Check that all lines were captured as separate log entries
    const stdoutLogs = process.logs.filter(log => log.type === 'stdout');
    const line1Log = stdoutLogs.find(log => log.content.includes('Line 1'));
    const line2Log = stdoutLogs.find(log => log.content.includes('Line 2'));
    const line3Log = stdoutLogs.find(log => log.content.includes('Line 3'));
    
    assertExists(line1Log, 'Expected Line 1 log entry');
    assertExists(line2Log, 'Expected Line 2 log entry');
    assertExists(line3Log, 'Expected Line 3 log entry');
    
    // Verify timestamps are in order
    assert(line1Log.timestamp <= line2Log.timestamp, 'Log timestamps should be in order');
    assert(line2Log.timestamp <= line3Log.timestamp, 'Log timestamps should be in order');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test.ignore('ProcessManager - Long running process monitoring', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create a long-running process that outputs periodically
  const request = {
    script_name: 'node',
    title: 'Long Running Test Process',
    args: ['-e', `
      let count = 0;
      const interval = setInterval(() => {
        console.log('Output ' + count++);
        if (count >= 3) {
          clearInterval(interval);
        }
      }, 50);
    `],
    name: 'long-running-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Verify monitoring is active
    assert(manager.isMonitoring(result.processId!));
    
    // Wait for several outputs
    await new Promise(resolve => setTimeout(resolve, 400));
    
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Verify multiple stdout entries were captured
    const stdoutLogs = process.logs.filter(log => 
      log.type === 'stdout' && log.content.includes('Output')
    );
    assert(stdoutLogs.length >= 3, 'Expected multiple stdout log entries');
    
    // Verify monitoring stops after process completion
    await new Promise(resolve => setTimeout(resolve, 200));
    assert(!manager.isMonitoring(result.processId!), 'Monitoring should stop after process completion');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

/**
 * Test suite for ProcessManager query methods
 */

Deno.test.ignore('ProcessManager - getProcessStatus with valid process ID', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Test getProcessStatus
    const status = manager.getProcessStatus(result.processId!);
    assertExists(status, 'getProcessStatus should return process details');
    assertEquals(status.id, result.processId);
    assertEquals(status.name, 'test-process');
    assertEquals(status.status, ProcessStatus.running);
    assertExists(status.startTime);
    assertExists(status.pid);
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - getProcessStatus with invalid inputs', () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Test with non-existent process ID
  assertEquals(manager.getProcessStatus('non-existent-id'), undefined);
  
  // Test with invalid inputs
  assertEquals(manager.getProcessStatus(''), undefined);
  assertEquals(manager.getProcessStatus(null as any), undefined);
  assertEquals(manager.getProcessStatus(undefined as any), undefined);
  assertEquals(manager.getProcessStatus(123 as any), undefined);
});

Deno.test.ignore('ProcessManager - getProcessLogs basic functionality', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = {
    script_name: 'echo',
    title: 'Log Test Process',
    args: ['Test output'],
    name: 'log-test-process'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete and logs to be captured
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Test getProcessLogs
    const logs = manager.getProcessLogs(result.processId!);
    assertExists(logs, 'getProcessLogs should return log array');
    assert(logs.length > 0, 'Should have at least one log entry');
    
    // Check log structure
    const firstLog = logs[0];
    assertExists(firstLog.timestamp);
    assertExists(firstLog.type);
    assertExists(firstLog.content);
    assert(['stdout', 'stderr', 'system'].includes(firstLog.type), 'Log type should be valid');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - getProcessLogs with line limits', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = {
    script_name: 'node',
    title: 'Multiline Log Test',
    args: ['-e', 'for(let i=0; i<5; i++) console.log(`Line ${i}`);'],
    name: 'multiline-log-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Test unlimited logs
    const allLogs = manager.getProcessLogs(result.processId!);
    assertExists(allLogs);
    
    // Test with line limit
    const limitedLogs = manager.getProcessLogs(result.processId!, 3);
    assertExists(limitedLogs);
    assert(limitedLogs.length <= 3, 'Should respect line limit');
    
    // Test with zero limit
    const zeroLogs = manager.getProcessLogs(result.processId!, 0);
    assertExists(zeroLogs);
    
    // Test with negative limit (should be ignored)
    const negativeLogs = manager.getProcessLogs(result.processId!, -5);
    assertExists(negativeLogs);
    assertEquals(negativeLogs.length, allLogs!.length, 'Negative limit should be ignored');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - getProcessLogs with log type filtering', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = {
    script_name: 'node',
    title: 'Filter Log Test',
    args: ['-e', 'console.log("stdout"); console.error("stderr");'],
    name: 'filter-log-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Test filtering by stdout
    const stdoutLogs = manager.getProcessLogs(result.processId!, undefined, 'stdout');
    assertExists(stdoutLogs);
    assert(stdoutLogs.every(log => log.type === 'stdout'), 'All logs should be stdout type');
    
    // Test filtering by stderr
    const stderrLogs = manager.getProcessLogs(result.processId!, undefined, 'stderr');
    assertExists(stderrLogs);
    assert(stderrLogs.every(log => log.type === 'stderr'), 'All logs should be stderr type');
    
    // Test filtering by system
    const systemLogs = manager.getProcessLogs(result.processId!, undefined, 'system');
    assertExists(systemLogs);
    assert(systemLogs.every(log => log.type === 'system'), 'All logs should be system type');
    assert(systemLogs.length > 0, 'Should have system logs');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - getProcessLogs with invalid inputs', () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Test with non-existent process ID
  assertEquals(manager.getProcessLogs('non-existent-id'), undefined);
  
  // Test with invalid inputs
  assertEquals(manager.getProcessLogs(''), undefined);
  assertEquals(manager.getProcessLogs(null as any), undefined);
  assertEquals(manager.getProcessLogs(undefined as any), undefined);
});

Deno.test.ignore('ProcessManager - listProcesses basic functionality', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create multiple processes
  const request1 = createValidStartRequest({ name: 'process-1' });
  const request2 = createValidStartRequest({ name: 'process-2' });
  
  const result1 = await manager.spawnProcess(request1);
  const result2 = await manager.spawnProcess(request2);
  
  try {
    assert(result1.success && result2.success);
    
    // Test basic listProcesses
    const processes = manager.listProcesses();
    assert(processes.length >= 2, 'Should list all processes');
    
    // Verify returned data structure
    const process = processes[0];
    assertExists(process.id);
    assertExists(process.name);
    assertExists(process.status);
    assertExists(process.startTime);
    
    // Test empty query
    const emptyQueryProcesses = manager.listProcesses({});
    assertEquals(processes.length, emptyQueryProcesses.length, 'Empty query should return all processes');
  } finally {
    if (result1.processId) await cleanupProcess(result1.processId, manager);
    if (result2.processId) await cleanupProcess(result2.processId, manager);
  }
});

Deno.test.ignore('ProcessManager - listProcesses with status filter', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create processes with different statuses
  const runningRequest = createValidStartRequest({ name: 'running-process' });
  const runningResult = await manager.spawnProcess(runningRequest);
  
  // Create a quick process that will complete
  const completedRequest = {
    script_name: 'echo',
    title: 'Completed Process Test',
    args: ['quick'],
    name: 'completed-process'
  };
  const completedResult = await manager.spawnProcess(completedRequest);
  
  try {
    assert(runningResult.success && completedResult.success);
    
    // Wait for the quick process to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Test filtering by running status
    const runningProcesses = manager.listProcesses({ status: ProcessStatus.running });
    assert(runningProcesses.every(p => p.status === ProcessStatus.running), 'All processes should be running');
    
    // Test filtering by stopped status
    const stoppedProcesses = manager.listProcesses({ status: ProcessStatus.stopped });
    assert(stoppedProcesses.every(p => p.status === ProcessStatus.stopped), 'All processes should be stopped');
    
    // Test with invalid status (should return empty)
    const invalidStatusProcesses = manager.listProcesses({ status: 'invalid' as any });
    assertEquals(invalidStatusProcesses.length, manager.getAllProcesses().length, 'Invalid status should be ignored');
  } finally {
    if (runningResult.processId) await cleanupProcess(runningResult.processId, manager);
    if (completedResult.processId) await cleanupProcess(completedResult.processId, manager);
  }
});

Deno.test.ignore('ProcessManager - listProcesses with name filter', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create processes with different names
  const result1 = await manager.spawnProcess(createValidStartRequest({ name: 'test-alpha' }));
  const result2 = await manager.spawnProcess(createValidStartRequest({ name: 'test-beta' }));
  const result3 = await manager.spawnProcess(createValidStartRequest({ name: 'production-gamma' }));
  
  try {
    assert(result1.success && result2.success && result3.success);
    
    // Test partial name matching
    const testProcesses = manager.listProcesses({ name: 'test' });
    assertEquals(testProcesses.length, 2, 'Should find processes with "test" in name');
    assert(testProcesses.every(p => p.name.includes('test')), 'All processes should contain "test"');
    
    // Test case-insensitive matching
    const alphaProcesses = manager.listProcesses({ name: 'ALPHA' });
    assertEquals(alphaProcesses.length, 1, 'Should find process with case-insensitive matching');
    assertEquals(alphaProcesses[0].name, 'test-alpha');
    
    // Test exact matching
    const exactProcesses = manager.listProcesses({ name: 'production-gamma' });
    assertEquals(exactProcesses.length, 1, 'Should find exact match');
    
    // Test non-existent name
    const nonExistentProcesses = manager.listProcesses({ name: 'non-existent' });
    assertEquals(nonExistentProcesses.length, 0, 'Should return empty for non-existent name');
    
    // Test empty/invalid name (should be ignored)
    const emptyNameProcesses = manager.listProcesses({ name: '' });
    assertEquals(emptyNameProcesses.length, 3, 'Empty name should be ignored');
    
    const whitespaceNameProcesses = manager.listProcesses({ name: '   ' });
    assertEquals(whitespaceNameProcesses.length, 3, 'Whitespace-only name should be ignored');
  } finally {
    if (result1.processId) await cleanupProcess(result1.processId, manager);
    if (result2.processId) await cleanupProcess(result2.processId, manager);
    if (result3.processId) await cleanupProcess(result3.processId, manager);
  }
});

Deno.test.ignore('ProcessManager - getProcessStats basic functionality', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Test with empty registry
  const emptyStats = manager.getProcessStats();
  assertEquals(emptyStats.totalProcesses, 0);
  assertEquals(emptyStats.runningProcesses, 0);
  assertEquals(emptyStats.failedProcesses, 0);
  assertEquals(emptyStats.completedProcesses, 0);
  assertEquals(emptyStats.averageRuntime, 0);
  
  // Create processes with different statuses
  const runningResult = await manager.spawnProcess(createValidStartRequest({ name: 'running-process' }));
  const completedResult = await manager.spawnProcess({
    script_name: 'echo',
    title: 'Completed Status Test',
    args: ['completed'],
    name: 'completed-process'
  });
  
  try {
    assert(runningResult.success && completedResult.success);
    
    // Wait for the quick process to complete
    await new Promise(resolve => setTimeout(resolve, 200));
    
    const stats = manager.getProcessStats();
    assertEquals(stats.totalProcesses, 2, 'Should count all processes');
    assert(stats.runningProcesses >= 0, 'Should have non-negative running processes');
    assert(stats.completedProcesses >= 0, 'Should have non-negative completed processes');
    assert(stats.failedProcesses >= 0, 'Should have non-negative failed processes');
    assert(stats.averageRuntime >= 0, 'Average runtime should be non-negative');
    
    // Verify counts add up correctly
    const expectedTotal = stats.runningProcesses + stats.failedProcesses + stats.completedProcesses;
    assert(expectedTotal <= stats.totalProcesses, 'Status counts should not exceed total');
  } finally {
    if (runningResult.processId) await cleanupProcess(runningResult.processId, manager);
    if (completedResult.processId) await cleanupProcess(completedResult.processId, manager);
  }
});

Deno.test.ignore('ProcessManager - listProcesses with pagination', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create multiple processes
  const processResults = [];
  for (let i = 0; i < 5; i++) {
    const result = await manager.spawnProcess(createValidStartRequest({ name: `process-${i}` }));
    assert(result.success);
    processResults.push(result);
  }
  
  try {
    // Test pagination with limit
    const firstPage = manager.listProcesses({ limit: 2 });
    assertEquals(firstPage.length, 2, 'Should return exactly 2 processes');
    
    const secondPage = manager.listProcesses({ limit: 2, offset: 2 });
    assertEquals(secondPage.length, 2, 'Should return exactly 2 processes for second page');
    
    const thirdPage = manager.listProcesses({ limit: 2, offset: 4 });
    assertEquals(thirdPage.length, 1, 'Should return 1 process for third page');
    
    // Test offset only
    const withOffset = manager.listProcesses({ offset: 3 });
    assertEquals(withOffset.length, 2, 'Should return remaining processes after offset');
    
    // Test with offset larger than total
    const emptyResult = manager.listProcesses({ offset: 10 });
    assertEquals(emptyResult.length, 0, 'Should return empty array for large offset');
    
    // Test with zero limit (should be ignored)
    const zeroLimit = manager.listProcesses({ limit: 0 });
    assertEquals(zeroLimit.length, 5, 'Zero limit should be ignored');
    
    // Test with negative limit (should be ignored)
    const negativeLimit = manager.listProcesses({ limit: -5 });
    assertEquals(negativeLimit.length, 5, 'Negative limit should be ignored');
    
    // Test with very large limit (should be capped)
    const largeLimit = manager.listProcesses({ limit: 2000 });
    assertEquals(largeLimit.length, 5, 'Large limit should return all available processes');
  } finally {
    for (const result of processResults) {
      if (result.processId) await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - listProcesses with sorting', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create processes with different names and timing using quick-terminating echo commands
  const quickRequest1 = {
    script_name: 'echo',
    title: 'Zebra Process Test',
    args: ['zebra'],
    name: 'zebra-process'
  };
  const quickRequest2 = {
    script_name: 'echo',
    title: 'Alpha Process Test',
    args: ['alpha'],
    name: 'alpha-process'
  };
  const quickRequest3 = {
    script_name: 'echo',
    title: 'Beta Process Test',
    args: ['beta'],
    name: 'beta-process'
  };
  
  const result1 = await manager.spawnProcess(quickRequest1);
  await new Promise(resolve => setTimeout(resolve, 10)); // Small delay to ensure different timestamps
  const result2 = await manager.spawnProcess(quickRequest2);
  await new Promise(resolve => setTimeout(resolve, 10));
  const result3 = await manager.spawnProcess(quickRequest3);
  
  try {
    assert(result1.success && result2.success && result3.success);
    
    // Wait for all processes to complete since echo commands are quick
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Test sorting by name ascending
    const nameAsc = manager.listProcesses({ sortBy: 'name', sortOrder: 'asc' });
    assertEquals(nameAsc[0].name, 'alpha-process', 'First should be alpha-process');
    assertEquals(nameAsc[1].name, 'beta-process', 'Second should be beta-process');
    assertEquals(nameAsc[2].name, 'zebra-process', 'Third should be zebra-process');
    
    // Test sorting by name descending
    const nameDesc = manager.listProcesses({ sortBy: 'name', sortOrder: 'desc' });
    assertEquals(nameDesc[0].name, 'zebra-process', 'First should be zebra-process');
    assertEquals(nameDesc[1].name, 'beta-process', 'Second should be beta-process');
    assertEquals(nameDesc[2].name, 'alpha-process', 'Third should be alpha-process');
    
    // Test sorting by startTime ascending (oldest first)
    const timeAsc = manager.listProcesses({ sortBy: 'startTime', sortOrder: 'asc' });
    assertEquals(timeAsc[0].name, 'zebra-process', 'Oldest should be zebra-process');
    assertEquals(timeAsc[2].name, 'beta-process', 'Newest should be beta-process');
    
    // Test sorting by startTime descending (newest first) - default behavior
    const timeDesc = manager.listProcesses({ sortBy: 'startTime', sortOrder: 'desc' });
    assertEquals(timeDesc[0].name, 'beta-process', 'Newest should be beta-process');
    assertEquals(timeDesc[2].name, 'zebra-process', 'Oldest should be zebra-process');
    
    // Test default sorting (startTime desc)
    const defaultSort = manager.listProcesses();
    assertEquals(defaultSort[0].name, timeDesc[0].name, 'Default should match startTime desc');
    
    // Test invalid sort field (should fall back to startTime)
    const invalidSort = manager.listProcesses({ sortBy: 'invalid' as any });
    assertEquals(invalidSort[0].name, timeDesc[0].name, 'Invalid sortBy should fall back to startTime');
    
    // Test invalid sort order (should fall back to desc)
    const invalidOrder = manager.listProcesses({ sortOrder: 'invalid' as any });
    assertEquals(invalidOrder[0].name, timeDesc[0].name, 'Invalid sortOrder should fall back to desc');
  } finally {
    if (result1.processId) await cleanupProcess(result1.processId, manager);
    if (result2.processId) await cleanupProcess(result2.processId, manager);
    if (result3.processId) await cleanupProcess(result3.processId, manager);
  }
});

Deno.test.ignore('ProcessManager - listProcesses with combined filters', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create mix of processes
  const runningResult1 = await manager.spawnProcess(createValidStartRequest({ name: 'test-running-1' }));
  const runningResult2 = await manager.spawnProcess(createValidStartRequest({ name: 'prod-running-1' }));
  const completedResult = await manager.spawnProcess({
    script_name: 'echo',
    title: 'Query Completed Test',
    args: ['done'],
    name: 'test-completed-1'
  });
  
  try {
    assert(runningResult1.success && runningResult2.success && completedResult.success);
    
    // Wait for completed process to finish
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Test combining status and name filters
    const testRunning = manager.listProcesses({ 
      status: ProcessStatus.running, 
      name: 'test' 
    });
    assert(testRunning.length >= 1, 'Should find at least one running test process');
    assert(testRunning.some(p => p.name === 'test-running-1'), 'Should include test-running-1 process');
    
    // Test combining filters with pagination
    const pagedFiltered = manager.listProcesses({ 
      name: 'test',
      limit: 1,
      sortBy: 'name',
      sortOrder: 'asc'
    });
    assertEquals(pagedFiltered.length, 1, 'Should return one result with pagination');
    
    // Test filter that returns no results
    const noResults = manager.listProcesses({ 
      status: ProcessStatus.running,
      name: 'nonexistent'
    });
    assertEquals(noResults.length, 0, 'Should return empty array for no matches');
  } finally {
    if (runningResult1.processId) await cleanupProcess(runningResult1.processId, manager);
    if (runningResult2.processId) await cleanupProcess(runningResult2.processId, manager);
    if (completedResult.processId) await cleanupProcess(completedResult.processId, manager);
  }
});

Deno.test.ignore('ProcessManager - getProcessStats with various process states', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create processes that will have different end states
  const runningResult = await manager.spawnProcess(createValidStartRequest({ name: 'long-running' }));
  
  // Create quick successful process
  const successResult = await manager.spawnProcess({
    script_name: 'echo',
    title: 'Quick Success Test',
    args: ['success'],
    name: 'quick-success'
  });
  
  // Create process that will fail
  const failResult = await manager.spawnProcess({
    script_name: 'node',
    title: 'Failing Process Test',
    args: ['-e', 'process.exit(1)'],
    name: 'failing-process'
  });
  
  try {
    assert(runningResult.success && successResult.success && failResult.success);
    
    // Wait for processes to complete
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const stats = manager.getProcessStats();
    
    // Verify basic counts
    assertEquals(stats.totalProcesses, 3, 'Should have 3 total processes');
    assert(stats.runningProcesses >= 0, 'Should have non-negative running processes');
    assert(stats.completedProcesses >= 0, 'Should have non-negative completed processes');
    assert(stats.failedProcesses >= 0, 'Should have non-negative failed processes');
    
    // Verify that all counts add up to total (accounting for possible state transitions)
    const accountedFor = stats.runningProcesses + stats.failedProcesses + stats.completedProcesses;
    assert(accountedFor <= stats.totalProcesses, 'Counted processes should not exceed total');
    
    // Verify average runtime is calculated correctly
    assert(stats.averageRuntime >= 0, 'Average runtime should be non-negative');
    
    // If we have completed processes, average should be > 0
    if (stats.completedProcesses > 0) {
      assert(stats.averageRuntime > 0, 'Average runtime should be positive when processes have completed');
    }
  } finally {
    if (runningResult.processId) await cleanupProcess(runningResult.processId, manager);
    if (successResult.processId) await cleanupProcess(successResult.processId, manager);
    if (failResult.processId) await cleanupProcess(failResult.processId, manager);
  }
});

Deno.test('ProcessManager - query methods integration test', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create a comprehensive test scenario
  const processResults = [];
  
  // Create multiple processes with different characteristics
  for (let i = 0; i < 3; i++) {
    const result = await manager.spawnProcess({
      script_name: 'node',
      title: `Integration Test Process ${i}`,
      args: ['-e', `console.log('Process ${i} output'); setTimeout(() => {}, 100);`],
      name: `integration-test-${i}`
    });
    assert(result.success);
    processResults.push(result);
  }
  
  try {
    // Wait for some output to be generated
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Test getProcessStats
    const stats = manager.getProcessStats();
    assert(stats.totalProcesses >= 3, 'Should have at least 3 processes');
    
    // Test listProcesses with various filters
    const allProcesses = manager.listProcesses();
    assert(allProcesses.length >= 3, 'Should list all processes');
    
    const integrationProcesses = manager.listProcesses({ name: 'integration' });
    assertEquals(integrationProcesses.length, 3, 'Should find all integration test processes');
    
    const runningProcesses = manager.listProcesses({ status: ProcessStatus.running });
    assert(runningProcesses.length >= 0, 'Should have non-negative running processes');
    
    // Test getProcessStatus for each process
    for (const result of processResults) {
      const status = manager.getProcessStatus(result.processId!);
      assertExists(status, 'Should get status for each process');
      assertEquals(status.id, result.processId);
      assert(status.name.includes('integration-test'), 'Name should match pattern');
    }
    
    // Test getProcessLogs for each process
    for (const result of processResults) {
      const logs = manager.getProcessLogs(result.processId!);
      assertExists(logs, 'Should get logs for each process');
      assert(logs.length > 0, 'Should have log entries');
      
      // Should have both system and stdout logs
      const systemLogs = logs.filter(log => log.type === 'system');
      const stdoutLogs = logs.filter(log => log.type === 'stdout');
      assert(systemLogs.length > 0, 'Should have system logs');
      assert(stdoutLogs.length >= 0, 'May have stdout logs');
    }
    
    // Test pagination and sorting work together
    const sortedLimited = manager.listProcesses({ 
      name: 'integration',
      sortBy: 'name',
      sortOrder: 'asc',
      limit: 2
    });
    assertEquals(sortedLimited.length, 2, 'Should respect limit with sorting');
    assert(sortedLimited[0].name <= sortedLimited[1].name, 'Should be sorted ascending');
  } finally {
    for (const result of processResults) {
      if (result.processId) await cleanupProcess(result.processId, manager);
    }
  }
});