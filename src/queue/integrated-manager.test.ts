import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { IntegratedQueueManager } from "./integrated-manager.ts";
import { ProcessManager } from "../process/manager.ts";
import { ProcessRegistry } from "../process/registry.ts";
import { QueuedProcess, QueueStatus } from "./types.ts";

// Helper to create test process
function createTestProcess(overrides: Partial<QueuedProcess> = {}): QueuedProcess {
  return {
    script_name: "echo",
    title: "Test Echo",
    priority: 5,
    args: ["test"],
    ...overrides,
  };
}

// Helper to wait for async operations
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Clean up test files
async function cleanup(filePath?: string) {
  if (filePath) {
    try {
      await Deno.remove(filePath);
    } catch {
      // Ignore
    }
  }
}

Deno.test("IntegratedQueueManager - basic queue operations", async () => {
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  const manager = new IntegratedQueueManager(processManager, {
    autoStart: false,
    persistQueue: false,
  });
  
  try {
    // Add to queue
    const process = createTestProcess();
    const id = manager.addToQueue(process);
    assertExists(id);
    
    // Check entry
    const entry = manager.getQueueEntry(id);
    assertExists(entry);
    assertEquals(entry.process.title, "Test Echo");
    assertEquals(entry.status, QueueStatus.pending);
    
    // Get statistics
    const stats = manager.getStatistics();
    assertEquals(stats.totalQueued, 1);
    assertEquals(stats.processing, 0);
  } finally {
    await manager.shutdown();
  }
});

Deno.test("IntegratedQueueManager - process execution", async () => {
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  const manager = new IntegratedQueueManager(processManager, {
    autoStart: true,
    persistQueue: false,
    maxConcurrentProcesses: 1,
  });
  
  try {
    let processStarted = false;
    manager.on('process_started', () => {
      processStarted = true;
    });
    
    // Add process to queue
    const process = createTestProcess();
    const id = manager.addToQueue(process);
    
    // Wait for processing
    await delay(100);
    
    // Check that process started
    assertEquals(processStarted, true);
    
    // Check entry is completed
    const entry = manager.getQueueEntry(id);
    assertExists(entry);
    assertEquals(entry.status, QueueStatus.completed);
    assertExists(entry.processId);
    
    // Check process in registry
    const processEntry = registry.getProcess(entry.processId!);
    assertExists(processEntry);
    assertEquals(processEntry.title, "Test Echo");
  } finally {
    // Clean up processes
    for (const proc of registry.getAllProcesses()) {
      if (proc.child) {
        try {
          // Cancel streams first
          if (proc.child.stdout) {
            await proc.child.stdout.cancel();
          }
          if (proc.child.stderr) {
            await proc.child.stderr.cancel();
          }
          proc.child.kill();
        } catch {
          // Ignore if already terminated
        }
      }
    }
    await manager.shutdown();
  }
});

Deno.test("IntegratedQueueManager - batch operations", async () => {
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  const manager = new IntegratedQueueManager(processManager, {
    autoStart: false,
    persistQueue: false,
  });
  
  try {
    // Add batch
    const processes = [
      createTestProcess({ title: "Batch 1", priority: 8 }),
      createTestProcess({ title: "Batch 2", priority: 3 }),
      createTestProcess({ title: "Batch 3", priority: 5 }),
    ];
    
    const result = manager.addBatch(processes);
    assertEquals(result.totalCount, 3);
    assertEquals(result.successCount, 3);
    
    // Check queue order (highest priority first)
    const entries = manager.getAllQueueEntries();
    assertEquals(entries[0].process.priority, 8);
    assertEquals(entries[0].process.title, "Batch 1");
  } finally {
    await manager.shutdown();
  }
});

Deno.test.ignore("IntegratedQueueManager - concurrency limits", async () => {
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  const manager = new IntegratedQueueManager(processManager, {
    autoStart: true,
    persistQueue: false,
    maxConcurrentProcesses: 2,
  });
  
  try {
    // Add 4 processes that take time to complete
    for (let i = 0; i < 4; i++) {
      manager.addToQueue(createTestProcess({ 
        title: `Process ${i}`,
        script_name: "sh",
        args: ["-c", "sleep 0.2"], // Sleep longer to ensure they're still running
      }));
    }
    
    // Wait for processing to start
    await delay(100);
    
    // Check that only 2 are processing
    const stats = manager.getStatistics();
    assertEquals(stats.processing, 2);
    assertEquals(stats.totalQueued, 2);
    
    // Wait for all to complete
    await delay(500);
  } finally {
    // Clean up processes
    for (const proc of registry.getAllProcesses()) {
      if (proc.child) {
        try {
          // Cancel streams first
          if (proc.child.stdout) {
            await proc.child.stdout.cancel();
          }
          if (proc.child.stderr) {
            await proc.child.stderr.cancel();
          }
          proc.child.kill();
        } catch {
          // Ignore if already terminated
        }
      }
    }
    await manager.shutdown();
  }
});

Deno.test.ignore("IntegratedQueueManager - persistence", async () => {
  const filePath = "./test-integrated-queue.json";
  
  try {
    const registry1 = new ProcessRegistry();
    const processManager1 = new ProcessManager(registry1);
    const manager1 = new IntegratedQueueManager(processManager1, {
      autoStart: false,
      persistQueue: true,
      persistPath: filePath,
      restoreOnStartup: false,
    });
    
    // Add some processes
    manager1.addToQueue(createTestProcess({ title: "Persist 1" }));
    manager1.addToQueue(createTestProcess({ title: "Persist 2" }));
    
    // Persist
    await manager1.persistQueue();
    await manager1.shutdown();
    
    // Create new manager with restore
    const registry2 = new ProcessRegistry();
    const processManager2 = new ProcessManager(registry2);
    const manager2 = new IntegratedQueueManager(processManager2, {
      autoStart: false,
      persistQueue: true,
      persistPath: filePath,
      restoreOnStartup: true,
    });
    
    // Wait for restore
    await delay(100);
    
    // Check restored entries
    const entries = manager2.getAllQueueEntries();
    assertEquals(entries.length, 2);
    assertEquals(entries.some(e => e.process.title === "Persist 1"), true);
    assertEquals(entries.some(e => e.process.title === "Persist 2"), true);
    
    await manager2.shutdown();
  } finally {
    await cleanup(filePath);
  }
});

Deno.test("IntegratedQueueManager - cancel operations", () => {
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  const manager = new IntegratedQueueManager(processManager, {
    autoStart: false,
    persistQueue: false,
  });
  
  try {
    // Add processes
    const id1 = manager.addToQueue(createTestProcess({ title: "Cancel 1" }));
    const id2 = manager.addToQueue(createTestProcess({ title: "Keep 1" }));
    const id3 = manager.addToQueue(createTestProcess({ title: "Cancel 2" }));
    
    // Cancel batch
    const result = manager.cancelBatch([id1, id3]);
    assertEquals(result.successCount, 2);
    
    // Check remaining
    const entries = manager.getAllQueueEntries();
    const pending = entries.filter(e => e.status === QueueStatus.pending);
    assertEquals(pending.length, 1);
    assertEquals(pending[0].process.title, "Keep 1");
  } finally {
    manager.shutdown();
  }
});

Deno.test("IntegratedQueueManager - immediate process start", async () => {
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  const manager = new IntegratedQueueManager(processManager, {
    autoStart: false,
    persistQueue: false,
  });
  
  try {
    // Start process immediately (bypass queue)
    const result = await manager.startProcessImmediately({
      script_name: "echo",
      title: "Immediate Process",
      args: ["immediate"],
    });
    
    assertEquals(result.success, true);
    assertExists(result.processId);
    
    // Check it's not in queue
    const entries = manager.getAllQueueEntries();
    assertEquals(entries.length, 0);
    
    // Check it's in registry
    const process = registry.getProcess(result.processId!);
    assertExists(process);
    assertEquals(process.title, "Immediate Process");
  } finally {
    // Clean up
    for (const proc of registry.getAllProcesses()) {
      if (proc.child) {
        proc.child.kill();
      }
    }
    await manager.shutdown();
  }
});