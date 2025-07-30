import { assertEquals, assertExists, assertRejects, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { ProcessManager } from './manager.ts';
import { ProcessRegistry } from './registry.ts';
import { ProcessStatus } from '../shared/types.ts';
import { StartProcessRequest, ProcessMonitoringConfig, ProcessTerminationOptions } from './types.ts';

/**
 * Test utilities for creating valid test data
 */
const createValidStartRequest = (overrides: Partial<StartProcessRequest> = {}): StartProcessRequest => ({
  script_name: 'echo',
  args: ['Hello, World!'],
  name: 'test-process',
  ...overrides
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
 * ================================
 * PROCESS TERMINATION TESTS
 * ================================
 */

Deno.test('ProcessManager - stopProcess with graceful termination', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create a long-running process
  const request = {
    script_name: 'node',
    args: ['-e', 'setInterval(() => console.log("running"), 100);'],
    name: 'long-running-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Verify process is running
    let process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.status, ProcessStatus.running);
    
    // Stop the process gracefully
    await manager.stopProcess(result.processId!);
    
    // Verify process was terminated
    process = manager.getProcess(result.processId!);
    assertExists(process);
    assert(process.status === ProcessStatus.stopped || process.status === ProcessStatus.failed);
    assertExists(process.endTime);
    
    // Check for termination logs
    const terminationLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('Terminating process')
    );
    assertExists(terminationLog, 'Expected termination log entry');
    
    // Verify monitoring was stopped
    assert(!manager.isMonitoring(result.processId!));
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - stopProcess with forced termination', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create a long-running process
  const request = {
    script_name: 'node',
    args: ['-e', `
      // Ignore SIGTERM to test forced termination
      process.on('SIGTERM', () => {
        console.log('Ignoring SIGTERM');
      });
      setInterval(() => console.log('still running'), 100);
    `],
    name: 'stubborn-process'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Stop the process with force option
    const options: ProcessTerminationOptions = { force: true };
    await manager.stopProcess(result.processId!, options);
    
    // Verify process was terminated
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assert(process.status === ProcessStatus.stopped || process.status === ProcessStatus.failed);
    
    // Check for forced termination logs
    const sigkillLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('SIGKILL')
    );
    assertExists(sigkillLog, 'Expected SIGKILL log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - stopProcess with timeout escalation', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create a process that ignores SIGTERM
  const request = {
    script_name: 'node',
    args: ['-e', `
      process.on('SIGTERM', () => {
        console.log('Received SIGTERM, ignoring...');
      });
      setInterval(() => console.log('still running'), 50);
    `],
    name: 'timeout-escalation-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to be fully running
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Stop with short timeout to force escalation
    const options: ProcessTerminationOptions = { timeout: 100 };
    await manager.stopProcess(result.processId!, options);
    
    // Verify process was terminated
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assert(process.status === ProcessStatus.stopped || process.status === ProcessStatus.failed);
    
    // Check for escalation logs
    const escalationLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('escalating to SIGKILL')
    );
    assertExists(escalationLog, 'Expected escalation log entry');
    
    // Check for termination metadata
    const metadata = process.metadata;
    assert(metadata.terminationMethod === 'forced', 'Expected forced termination method in metadata');
    assertExists(metadata.terminationTime);
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - stopProcess on already stopped process', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest({
    script_name: 'echo',
    args: ['quick exit']
  });
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete naturally
    await new Promise(resolve => setTimeout(resolve, 200));
    
    let process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.status, ProcessStatus.stopped);
    
    // Try to stop already stopped process
    await manager.stopProcess(result.processId!);
    
    // Verify status hasn't changed
    process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.status, ProcessStatus.stopped);
    
    // Check for appropriate log message
    const alreadyTerminatedLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('already terminated')
    );
    assertExists(alreadyTerminatedLog, 'Expected already terminated log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - stopProcess on non-existent process', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const nonExistentId = 'non-existent-process-id';
  
  // Should not throw, just handle gracefully
  await manager.stopProcess(nonExistentId);
  
  // Verify nothing was added to registry
  assertEquals(manager.getProcessCount(), 0);
});

/**
 * ================================
 * LIFECYCLE TESTS
 * ================================
 */

Deno.test('ProcessManager - Complete process lifecycle', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create process
  const request = {
    script_name: 'node',
    args: ['-e', `
      console.log('Process started');
      let count = 0;
      const interval = setInterval(() => {
        console.log('Working: ' + count++);
        if (count >= 3) {
          clearInterval(interval);
        }
      }, 50);
    `],
    name: 'lifecycle-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Verify process starts in running state
    let process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.status, ProcessStatus.running);
    assert(manager.isMonitoring(result.processId!));
    
    // Wait for some output
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify logs were captured
    process = manager.getProcess(result.processId!);
    assertExists(process);
    const outputLogs = process.logs.filter(log => log.type === 'stdout');
    assert(outputLogs.length >= 1, 'Expected stdout logs to be captured');
    
    // Stop the process
    await manager.stopProcess(result.processId!);
    
    // Verify final state
    process = manager.getProcess(result.processId!);
    assertExists(process);
    assert(process.status === ProcessStatus.stopped || process.status === ProcessStatus.failed);
    assertExists(process.endTime);
    assert(!manager.isMonitoring(result.processId!));
    
    // Verify cleanup logs
    const cleanupLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('Cleaned up resources')
    );
    assertExists(cleanupLog, 'Expected cleanup log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - Concurrent termination of multiple processes', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create multiple long-running processes
  const processIds: string[] = [];
  
  try {
    for (let i = 0; i < 3; i++) {
      const request = {
        script_name: 'node',
        args: ['-e', `setInterval(() => console.log('Process ${i} running'), 100);`],
        name: `concurrent-test-${i}`
      };
      
      const result = await manager.spawnProcess(request);
      assert(result.success);
      processIds.push(result.processId!);
    }
    
    // Verify all processes are running
    assertEquals(manager.getProcessesByStatus(ProcessStatus.running).length, 3);
    
    // Terminate all processes concurrently
    const terminationPromises = processIds.map(id => 
      manager.stopProcess(id, { timeout: 1000 })
    );
    
    await Promise.all(terminationPromises);
    
    // Verify all processes are terminated
    const runningProcesses = manager.getProcessesByStatus(ProcessStatus.running);
    assertEquals(runningProcesses.length, 0);
    
    // Verify all processes have end times
    for (const processId of processIds) {
      const process = manager.getProcess(processId);
      assertExists(process);
      assertExists(process.endTime);
      assert(!manager.isMonitoring(processId));
    }
  } finally {
    for (const processId of processIds) {
      await cleanupProcess(processId, manager);
    }
  }
});

/**
 * ================================
 * MANAGER SHUTDOWN TESTS
 * ================================
 */

Deno.test('ProcessManager - shutdown with no running processes', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Test shutdown with no processes
  await manager.shutdown();
  
  assertEquals(manager.getProcessCount(), 0);
});

Deno.test('ProcessManager - shutdown with running processes', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create multiple processes
  const processIds: string[] = [];
  
  try {
    for (let i = 0; i < 2; i++) {
      const request = {
        script_name: 'node',
        args: ['-e', `setInterval(() => console.log('Process ${i}'), 100);`],
        name: `shutdown-test-${i}`
      };
      
      const result = await manager.spawnProcess(request);
      assert(result.success);
      processIds.push(result.processId!);
    }
    
    // Verify processes are running
    assertEquals(manager.getProcessesByStatus(ProcessStatus.running).length, 2);
    
    // Shutdown manager
    await manager.shutdown({ timeout: 2000 });
    
    // Verify all processes are terminated
    const runningProcesses = manager.getProcessesByStatus(ProcessStatus.running);
    assertEquals(runningProcesses.length, 0);
    
    // Verify no processes are being monitored
    for (const processId of processIds) {
      assert(!manager.isMonitoring(processId));
    }
  } finally {
    // Processes should already be cleaned up by shutdown
    for (const processId of processIds) {
      try {
        await cleanupProcess(processId, manager);
      } catch {
        // Ignore cleanup errors after shutdown
      }
    }
  }
});

Deno.test('ProcessManager - shutdown with force option', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create a stubborn process that ignores SIGTERM
  const request = {
    script_name: 'node',
    args: ['-e', `
      process.on('SIGTERM', () => {
        console.log('Ignoring SIGTERM');
      });
      setInterval(() => console.log('stubborn process'), 100);
    `],
    name: 'stubborn-shutdown-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Shutdown with force option and short timeout
    await manager.shutdown({ force: true, timeout: 500 });
    
    // Verify process is terminated
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assert(process.status === ProcessStatus.stopped || process.status === ProcessStatus.failed);
  } finally {
    if (result.processId) {
      try {
        await cleanupProcess(result.processId, manager);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

/**
 * ================================
 * ERROR HANDLING TESTS
 * ================================
 */

Deno.test('ProcessManager - termination error handling', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = createValidStartRequest();
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete naturally
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Manually clear the child process to simulate termination failure scenario
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    
    // Create a process entry without child to test error handling
    registry.updateProcess(result.processId!, { child: undefined });
    
    // Try to stop process without child - should handle gracefully
    await manager.stopProcess(result.processId!);
    
    // Should have logged appropriate message
    const updatedProcess = manager.getProcess(result.processId!);
    assertExists(updatedProcess);
    const terminationLog = updatedProcess.logs.find(log => 
      log.type === 'system' && (
        log.content.includes('Cannot stop process') || 
        log.content.includes('already terminated')
      )
    );
    assertExists(terminationLog, 'Expected termination handling log entry');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

/**
 * ================================
 * RESOURCE MANAGEMENT TESTS
 * ================================
 */

Deno.test('ProcessManager - Resource cleanup during termination', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = {
    script_name: 'node',
    args: ['-e', `
      console.log('Starting process');
      console.error('Error output');
      setInterval(() => {
        console.log('Regular output');
        console.error('Regular error');
      }, 50);
    `],
    name: 'resource-cleanup-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Let it run for a bit to generate logs
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Verify monitoring is active
    assert(manager.isMonitoring(result.processId!));
    
    // Stop the process
    await manager.stopProcess(result.processId!);
    
    // Verify monitoring is stopped
    assert(!manager.isMonitoring(result.processId!));
    
    // Verify cleanup log exists
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    const cleanupLog = process.logs.find(log => 
      log.type === 'system' && log.content.includes('Cleaned up resources')
    );
    assertExists(cleanupLog, 'Expected resource cleanup log');
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});

Deno.test('ProcessManager - Memory leak prevention', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  // Create and terminate multiple processes to test for leaks
  const processCount = 5;
  
  for (let i = 0; i < processCount; i++) {
    const request = {
      script_name: 'echo',
      args: [`Process ${i}`],
      name: `leak-test-${i}`
    };
    
    const result = await manager.spawnProcess(request);
    assert(result.success);
    assertExists(result.processId);
    
    // Wait for process to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify process completed
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.status, ProcessStatus.stopped);
    
    // Verify monitoring was cleaned up
    assert(!manager.isMonitoring(result.processId!));
  }
  
  // Verify all processes are properly tracked
  assertEquals(manager.getProcessCount(), processCount);
  
  // Stop all monitoring to ensure no leaks
  manager.stopAllMonitoring();
});

Deno.test('ProcessManager - Concurrent termination requests', async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const request = {
    script_name: 'node',
    args: ['-e', 'setInterval(() => console.log("running"), 100);'],
    name: 'concurrent-termination-test'
  };
  
  const result = await manager.spawnProcess(request);
  
  try {
    assert(result.success);
    assertExists(result.processId);
    
    // Make multiple concurrent termination requests
    const terminationPromises = [
      manager.stopProcess(result.processId!),
      manager.stopProcess(result.processId!),
      manager.stopProcess(result.processId!)
    ];
    
    // All should complete without error
    await Promise.all(terminationPromises);
    
    // Verify process is terminated
    const process = manager.getProcess(result.processId!);
    assertExists(process);
    assert(process.status === ProcessStatus.stopped || process.status === ProcessStatus.failed);
    assert(!manager.isMonitoring(result.processId!));
  } finally {
    if (result.processId) {
      await cleanupProcess(result.processId, manager);
    }
  }
});