import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { QueueManager } from "./manager.ts";
import { IntegratedQueueManager } from "./integrated-manager.ts";
import { ProcessManager } from "../process/manager.ts";
import { ProcessRegistry } from "../process/registry.ts";
import { QueuedProcess, QueueStatus } from "./types.ts";

// Helper to create test process
function createTestProcess(overrides: Partial<QueuedProcess> = {}): QueuedProcess {
  return {
    script_name: "echo",
    title: "Test Process",
    priority: 5,
    args: ["test"],
    ...overrides,
  };
}

// Helper for delays
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.test("Batch Operations - add multiple processes", () => {
  const manager = new QueueManager();
  
  // Create batch of processes
  const processes = [
    createTestProcess({ title: "Batch 1", priority: 10 }),
    createTestProcess({ title: "Batch 2", priority: 5 }),
    createTestProcess({ title: "Batch 3", priority: 8 }),
    createTestProcess({ title: "Batch 4", priority: 5 }),
    createTestProcess({ title: "Batch 5", priority: 1 }),
  ];
  
  // Add batch
  const result = manager.addBatch(processes);
  
  // Verify result
  assertEquals(result.totalCount, 5);
  assertEquals(result.successCount, 5);
  assertEquals(result.failureCount, 0);
  assertEquals(result.successful.length, 5);
  assertExists(result.batchId);
  
  // Verify all have same batch ID
  const entries = manager.getAllEntries();
  assertEquals(entries.length, 5);
  
  const batchId = entries[0].process.batchId;
  assertExists(batchId);
  assertEquals(entries.every(e => e.process.batchId === batchId), true);
  
  // Verify priority ordering
  assertEquals(entries[0].priority, 10); // Highest priority first
  assertEquals(entries[1].priority, 8);
  assertEquals(entries[2].priority, 5); // Two with priority 5
  assertEquals(entries[3].priority, 5);
  assertEquals(entries[4].priority, 1); // Lowest priority last
});

Deno.test("Batch Operations - partial failure handling", () => {
  const manager = new QueueManager({ maxQueueSize: 3 });
  
  // Try to add 5 processes when max is 3
  const processes = [
    createTestProcess({ title: "Success 1" }),
    createTestProcess({ title: "Success 2" }),
    createTestProcess({ title: "Success 3" }),
    createTestProcess({ title: "Fail 1" }),
    createTestProcess({ title: "Fail 2" }),
  ];
  
  const result = manager.addBatch(processes);
  
  // Verify partial success
  assertEquals(result.totalCount, 5);
  assertEquals(result.successCount, 3);
  assertEquals(result.failureCount, 2);
  assertEquals(result.successful.length, 3);
  assertEquals(result.failed.length, 2);
  
  // Check failed entries have proper error
  assertEquals(result.failed[0].error.includes("Queue is full"), true);
  assertEquals(result.failed[1].error.includes("Queue is full"), true);
});

Deno.test("Batch Operations - cancel multiple entries", () => {
  const manager = new QueueManager();
  
  // Add individual processes
  const id1 = manager.addToQueue(createTestProcess({ title: "Cancel 1" }));
  const id2 = manager.addToQueue(createTestProcess({ title: "Keep 1" }));
  const id3 = manager.addToQueue(createTestProcess({ title: "Cancel 2" }));
  const id4 = manager.addToQueue(createTestProcess({ title: "Keep 2" }));
  const id5 = manager.addToQueue(createTestProcess({ title: "Cancel 3" }));
  
  // Cancel batch
  const result = manager.cancelBatch([id1, id3, id5]);
  
  // Verify result
  assertEquals(result.totalCount, 3);
  assertEquals(result.successCount, 3);
  assertEquals(result.failureCount, 0);
  
  // Check remaining entries
  const remaining = manager.getAllEntries()
    .filter(e => e.status === QueueStatus.pending);
  assertEquals(remaining.length, 2);
  assertEquals(remaining[0].process.title, "Keep 1");
  assertEquals(remaining[1].process.title, "Keep 2");
  
  // Check cancelled entries
  const cancelled = manager.getAllEntries()
    .filter(e => e.status === QueueStatus.cancelled);
  assertEquals(cancelled.length, 3);
});

Deno.test("Batch Operations - batch completion tracking", async () => {
  const manager = new QueueManager({ retryFailedProcesses: false });
  
  // Track batch completion
  let batchCompleted = false;
  let completedBatchId = "";
  
  manager.on('batch_completed', (event) => {
    batchCompleted = true;
    completedBatchId = event.data.batchId || "";
  });
  
  // Add batch
  const processes = [
    createTestProcess({ title: "Batch Item 1" }),
    createTestProcess({ title: "Batch Item 2" }),
    createTestProcess({ title: "Batch Item 3" }),
  ];
  
  const batchResult = manager.addBatch(processes);
  
  // Process all entries
  const entry1 = manager.getNext();
  const entry2 = manager.getNext();
  const entry3 = manager.getNext();
  
  assertExists(entry1);
  assertExists(entry2);
  assertExists(entry3);
  
  // Complete 2, fail 1
  manager.markCompleted(entry1.id, "proc-1");
  manager.markCompleted(entry2.id, "proc-2");
  
  // Batch not complete yet
  assertEquals(batchCompleted, false);
  
  // Fail the last one - should trigger batch completion
  manager.markFailed(entry3.id, "Test error");
  
  // Give event time to propagate
  await delay(10);
  
  // Verify batch completed
  assertEquals(batchCompleted, true);
  assertEquals(completedBatchId, batchResult.batchId);
});

Deno.test.ignore("Batch Operations - integrated batch processing", async () => {
  const registry = new ProcessRegistry();
  const processManager = new ProcessManager(registry);
  const manager = new IntegratedQueueManager(processManager, {
    autoStart: true,
    persistQueue: false,
    maxConcurrentProcesses: 3,
  });
  
  try {
    // Track batch events
    let batchStarted = false;
    let batchCompleted = false;
    
    manager.on('batch_started', () => {
      batchStarted = true;
    });
    
    manager.on('batch_completed', () => {
      batchCompleted = true;
    });
    
    // Add batch of processes
    const processes = [
      createTestProcess({ title: "Integrated 1", args: ["batch-1"] }),
      createTestProcess({ title: "Integrated 2", args: ["batch-2"] }),
      createTestProcess({ title: "Integrated 3", args: ["batch-3"] }),
    ];
    
    const result = manager.addBatch(processes);
    assertEquals(result.successCount, 3);
    assertEquals(batchStarted, true);
    
    // Wait for processing
    await delay(200);
    
    // Check all completed
    const entries = manager.getAllQueueEntries();
    const completed = entries.filter(e => e.status === QueueStatus.completed);
    assertEquals(completed.length, 3);
    
    // Batch should be completed
    assertEquals(batchCompleted, true);
    
    // Verify processes in registry
    const processes_in_registry = registry.getAllProcesses();
    assertEquals(processes_in_registry.length, 3);
    assertEquals(processes_in_registry.some(p => p.title === "Integrated 1"), true);
    assertEquals(processes_in_registry.some(p => p.title === "Integrated 2"), true);
    assertEquals(processes_in_registry.some(p => p.title === "Integrated 3"), true);
  } finally {
    // Cleanup
    for (const proc of registry.getAllProcesses()) {
      if (proc.child) {
        try {
          proc.child.kill();
        } catch {
          // Ignore
        }
      }
    }
    await manager.shutdown();
  }
});

Deno.test("Batch Operations - batch with mixed priorities", () => {
  const manager = new QueueManager();
  
  // Create processes with different priorities
  const processes = [];
  for (let i = 0; i < 10; i++) {
    processes.push(createTestProcess({
      title: `Priority ${10 - i}`,
      priority: (10 - i) as any, // 10, 9, 8, ..., 1
    }));
  }
  
  // Add as batch
  const result = manager.addBatch(processes);
  assertEquals(result.successCount, 10);
  
  // Verify they're ordered by priority
  const entries = manager.getAllEntries();
  for (let i = 0; i < entries.length - 1; i++) {
    assertEquals(
      entries[i].priority >= entries[i + 1].priority,
      true,
      `Entry ${i} priority ${entries[i].priority} should be >= entry ${i + 1} priority ${entries[i + 1].priority}`
    );
  }
  
  // All should have same batch ID
  const batchId = entries[0].process.batchId;
  assertExists(batchId);
  assertEquals(entries.every(e => e.process.batchId === batchId), true);
});

Deno.test("Batch Operations - atomic batch operations", () => {
  const manager = new QueueManager();
  
  // Add some individual processes
  manager.addToQueue(createTestProcess({ title: "Individual 1" }));
  manager.addToQueue(createTestProcess({ title: "Individual 2" }));
  
  // Add a batch
  const batchProcesses = [
    createTestProcess({ title: "Batch A-1" }),
    createTestProcess({ title: "Batch A-2" }),
    createTestProcess({ title: "Batch A-3" }),
  ];
  
  const batchA = manager.addBatch(batchProcesses);
  
  // Add another batch
  const batchProcesses2 = [
    createTestProcess({ title: "Batch B-1" }),
    createTestProcess({ title: "Batch B-2" }),
  ];
  
  const batchB = manager.addBatch(batchProcesses2);
  
  // Verify we have 7 total entries
  const allEntries = manager.getAllEntries();
  assertEquals(allEntries.length, 7);
  
  // Count by batch
  const noBatch = allEntries.filter(e => !e.process.batchId).length;
  const batchACount = allEntries.filter(e => e.process.batchId === batchA.batchId).length;
  const batchBCount = allEntries.filter(e => e.process.batchId === batchB.batchId).length;
  
  assertEquals(noBatch, 2);
  assertEquals(batchACount, 3);
  assertEquals(batchBCount, 2);
  
  // Cancel entire batch A
  const cancelResult = manager.cancelBatch(batchA.successful);
  assertEquals(cancelResult.successCount, 3);
  
  // Verify only batch A was cancelled
  const remaining = manager.getAllEntries()
    .filter(e => e.status === QueueStatus.pending);
  assertEquals(remaining.length, 4); // 2 individual + 2 from batch B
});