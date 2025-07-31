import { assertEquals, assertExists, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { QueueManager, QueueEventMap } from "./manager.ts";
import { QueuedProcess, QueueStatus, QueueConfig, QueueEvent, BatchResult } from "./types.ts";

// Helper function to create test processes
function createTestProcess(overrides: Partial<QueuedProcess> = {}): QueuedProcess {
  return {
    script_name: "test.sh",
    title: "Test Process",
    priority: 5,
    ...overrides,
  };
}

// Helper to wait for events
function waitForEvent(
  manager: QueueManager,
  eventType: keyof QueueEventMap,
  timeout = 1000
): Promise<QueueEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Event timeout")), timeout);
    const unsubscribe = manager.on(eventType, (event: QueueEvent) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
  });
}

Deno.test("QueueManager - constructor and configuration", () => {
  const manager = new QueueManager();
  const config = manager.getConfig();
  
  assertEquals(config.maxConcurrentProcesses, 5);
  assertEquals(config.defaultPriority, 5);
  assertEquals(config.maxQueueSize, 1000);
  
  // Custom config
  const customManager = new QueueManager({
    maxConcurrentProcesses: 10,
    maxQueueSize: 50,
  });
  
  const customConfig = customManager.getConfig();
  assertEquals(customConfig.maxConcurrentProcesses, 10);
  assertEquals(customConfig.maxQueueSize, 50);
});

Deno.test("QueueManager - addToQueue basic functionality", async () => {
  const manager = new QueueManager();
  const process = createTestProcess();
  
  const eventPromise = waitForEvent(manager, 'entry_added');
  const id = manager.addToQueue(process);
  
  assertExists(id);
  assertEquals(typeof id, "string");
  assertEquals(id.length, 36); // UUID length
  
  const event = await eventPromise;
  assertEquals(event.type, 'entry_added');
  assertEquals(event.data.queueId, id);
  assertExists(event.data.entry);
});

Deno.test("QueueManager - queue size limit", () => {
  const manager = new QueueManager({ maxQueueSize: 2 });
  
  manager.addToQueue(createTestProcess());
  manager.addToQueue(createTestProcess());
  
  // Third should fail
  assertThrows(
    () => manager.addToQueue(createTestProcess()),
    Error,
    "Queue is full"
  );
});

Deno.test("QueueManager - priority ordering", () => {
  const manager = new QueueManager();
  
  // Add processes with different priorities
  const id1 = manager.addToQueue(createTestProcess({ priority: 3, title: "Low" }));
  const id2 = manager.addToQueue(createTestProcess({ priority: 8, title: "High" }));
  const id3 = manager.addToQueue(createTestProcess({ priority: 5, title: "Medium" }));
  
  // Get next should return highest priority first
  const entry1 = manager.getNext();
  assertExists(entry1);
  assertEquals(entry1.priority, 8);
  assertEquals(entry1.process.title, "High");
  
  const entry2 = manager.getNext();
  assertExists(entry2);
  assertEquals(entry2.priority, 5);
  assertEquals(entry2.process.title, "Medium");
  
  const entry3 = manager.getNext();
  assertExists(entry3);
  assertEquals(entry3.priority, 3);
  assertEquals(entry3.process.title, "Low");
});

Deno.test("QueueManager - FIFO within same priority", () => {
  const manager = new QueueManager();
  
  // Add processes with same priority
  const id1 = manager.addToQueue(createTestProcess({ priority: 5, title: "First" }));
  const id2 = manager.addToQueue(createTestProcess({ priority: 5, title: "Second" }));
  const id3 = manager.addToQueue(createTestProcess({ priority: 5, title: "Third" }));
  
  // Should return in FIFO order
  const entry1 = manager.getNext();
  assertEquals(entry1?.process.title, "First");
  
  const entry2 = manager.getNext();
  assertEquals(entry2?.process.title, "Second");
  
  const entry3 = manager.getNext();
  assertEquals(entry3?.process.title, "Third");
});

Deno.test("QueueManager - concurrency limits", () => {
  const manager = new QueueManager({ maxConcurrentProcesses: 2 });
  
  // Add 4 processes
  for (let i = 0; i < 4; i++) {
    manager.addToQueue(createTestProcess({ title: `Process ${i}` }));
  }
  
  // Get first two
  const entry1 = manager.getNext();
  const entry2 = manager.getNext();
  assertExists(entry1);
  assertExists(entry2);
  
  // Third should be undefined due to concurrency limit
  const entry3 = manager.getNext();
  assertEquals(entry3, undefined);
  
  // Complete one
  manager.markCompleted(entry1.id, "process-123");
  
  // Now we can get another
  const entry4 = manager.getNext();
  assertExists(entry4);
});

Deno.test("QueueManager - markCompleted", async () => {
  const manager = new QueueManager();
  const id = manager.addToQueue(createTestProcess());
  
  const entry = manager.getNext();
  assertExists(entry);
  
  const eventPromise = waitForEvent(manager, 'entry_completed');
  manager.markCompleted(entry.id, "process-123");
  
  const event = await eventPromise;
  assertEquals(event.type, 'entry_completed');
  assertEquals(event.data.queueId, entry.id);
  assertEquals(event.data.processId, "process-123");
  
  // Check entry status
  const completedEntry = manager.getEntry(entry.id);
  assertExists(completedEntry);
  assertEquals(completedEntry.status, QueueStatus.completed);
  assertEquals(completedEntry.processId, "process-123");
  assertExists(completedEntry.completedAt);
});

Deno.test("QueueManager - markFailed with retry", async () => {
  const manager = new QueueManager({
    retryFailedProcesses: true,
    defaultMaxRetries: 2,
  });
  
  const id = manager.addToQueue(createTestProcess());
  const entry = manager.getNext();
  assertExists(entry);
  
  // First failure - should retry
  const retryPromise = waitForEvent(manager, 'entry_retried');
  manager.markFailed(entry.id, "Connection timeout");
  
  const retryEvent = await retryPromise;
  assertEquals(retryEvent.type, 'entry_retried');
  assertEquals(retryEvent.data.metadata?.retryCount, 1);
  
  // Entry should be back in queue
  const retryEntry = manager.getNext();
  assertExists(retryEntry);
  assertEquals(retryEntry.id, entry.id);
  assertEquals(retryEntry.retryCount, 1);
  
  // Second failure - should retry again
  manager.markFailed(retryEntry.id, "Connection timeout");
  
  const retryEntry2 = manager.getNext();
  assertExists(retryEntry2);
  assertEquals(retryEntry2.id, entry.id);
  assertEquals(retryEntry2.retryCount, 2);
  
  // Third failure - should not retry (max retries reached)
  const failPromise = waitForEvent(manager, 'entry_failed');
  manager.markFailed(retryEntry2.id, "Connection timeout");
  
  const failEvent = await failPromise;
  assertEquals(failEvent.type, 'entry_failed');
  
  // Should not be in queue anymore
  const noEntry = manager.getNext();
  assertEquals(noEntry, undefined);
  
  // Check final status
  const failedEntry = manager.getEntry(entry.id);
  assertExists(failedEntry);
  assertEquals(failedEntry.status, QueueStatus.failed);
  assertEquals(failedEntry.error, "Connection timeout");
});

Deno.test("QueueManager - cancel queued entry", async () => {
  const manager = new QueueManager();
  
  const id1 = manager.addToQueue(createTestProcess({ title: "To Cancel" }));
  const id2 = manager.addToQueue(createTestProcess({ title: "To Keep" }));
  
  const eventPromise = waitForEvent(manager, 'entry_cancelled');
  const cancelled = manager.cancel(id1);
  
  assertEquals(cancelled, true);
  
  const event = await eventPromise;
  assertEquals(event.type, 'entry_cancelled');
  assertEquals(event.data.queueId, id1);
  
  // Should only get the second entry
  const entry = manager.getNext();
  assertExists(entry);
  assertEquals(entry.process.title, "To Keep");
  
  // No more entries
  const noEntry = manager.getNext();
  assertEquals(noEntry, undefined);
});

Deno.test("QueueManager - cannot cancel processing entry", () => {
  const manager = new QueueManager();
  
  const id = manager.addToQueue(createTestProcess());
  const entry = manager.getNext();
  assertExists(entry);
  
  // Try to cancel while processing
  const cancelled = manager.cancel(entry.id);
  assertEquals(cancelled, false);
  
  // Entry should still be processing
  const checkEntry = manager.getEntry(entry.id);
  assertExists(checkEntry);
  assertEquals(checkEntry.status, QueueStatus.processing);
});

Deno.test("QueueManager - batch operations", async () => {
  const manager = new QueueManager();
  
  const processes = [
    createTestProcess({ title: "Batch 1" }),
    createTestProcess({ title: "Batch 2" }),
    createTestProcess({ title: "Batch 3" }),
  ];
  
  const eventPromise = waitForEvent(manager, 'batch_started');
  const result = manager.addBatch(processes);
  
  assertEquals(result.totalCount, 3);
  assertEquals(result.successCount, 3);
  assertEquals(result.failureCount, 0);
  assertEquals(result.successful.length, 3);
  
  const event = await eventPromise;
  assertEquals(event.type, 'batch_started');
  assertEquals(event.data.batchId, result.batchId);
  
  // All entries should have same batch ID
  const entries = manager.getAllEntries();
  assertEquals(entries.length, 3);
  entries.forEach(entry => {
    assertEquals(entry.process.batchId, result.batchId);
  });
});

Deno.test("QueueManager - batch completion event", async () => {
  const manager = new QueueManager();
  
  const processes = [
    createTestProcess({ title: "Batch 1" }),
    createTestProcess({ title: "Batch 2" }),
  ];
  
  const batchResult = manager.addBatch(processes);
  
  // Process both entries
  const entry1 = manager.getNext();
  const entry2 = manager.getNext();
  assertExists(entry1);
  assertExists(entry2);
  
  // Complete first
  manager.markCompleted(entry1.id, "proc-1");
  
  // Batch not complete yet
  let batchComplete = false;
  manager.on((event) => {
    if (event.type === 'batch_completed') {
      batchComplete = true;
    }
  });
  
  // Complete second - should trigger batch completion
  const batchPromise = waitForEvent(manager, 'batch_completed');
  manager.markCompleted(entry2.id, "proc-2");
  
  const event = await batchPromise;
  assertEquals(event.type, 'batch_completed');
  assertEquals(event.data.batchId, batchResult.batchId);
  
  const metadata = event.data.metadata as BatchResult;
  assertEquals(metadata.successCount, 2);
  assertEquals(metadata.failureCount, 0);
});

Deno.test("QueueManager - statistics", () => {
  const manager = new QueueManager();
  
  // Add some processes
  manager.addToQueue(createTestProcess({ priority: 10 }));
  manager.addToQueue(createTestProcess({ priority: 5 }));
  manager.addToQueue(createTestProcess({ priority: 5 }));
  manager.addToQueue(createTestProcess({ priority: 1 }));
  
  // Process some
  const entry1 = manager.getNext();
  assertExists(entry1);
  manager.markCompleted(entry1.id, "proc-1");
  
  const entry2 = manager.getNext();
  assertExists(entry2);
  
  const stats = manager.getStatistics();
  
  assertEquals(stats.totalQueued, 2); // 2 still in queue
  assertEquals(stats.processing, 1); // 1 processing
  assertEquals(stats.completed, 1); // 1 completed
  assertEquals(stats.failed, 0);
  assertEquals(stats.cancelled, 0);
  
  // Check priority distribution
  assertEquals(stats.queuedByPriority.get(5), 1);
  assertEquals(stats.queuedByPriority.get(1), 1);
  assertEquals(stats.queuedByPriority.get(10), 0); // Already processed
});

Deno.test("QueueManager - clearHistory", () => {
  const manager = new QueueManager({ retryFailedProcesses: false });
  
  // Create some history
  const id1 = manager.addToQueue(createTestProcess());
  const id2 = manager.addToQueue(createTestProcess());
  const id3 = manager.addToQueue(createTestProcess());
  
  const entry1 = manager.getNext();
  assertExists(entry1);
  manager.markCompleted(entry1.id, "proc-1");
  
  const entry2 = manager.getNext();
  assertExists(entry2);
  manager.markFailed(entry2.id, "Error");
  
  manager.cancel(id3);
  
  // Verify history exists
  let stats = manager.getStatistics();
  assertEquals(stats.completed, 1);
  assertEquals(stats.failed, 1);
  assertEquals(stats.cancelled, 1);
  
  // Clear history
  manager.clearHistory();
  
  // Verify history cleared
  stats = manager.getStatistics();
  assertEquals(stats.completed, 0);
  assertEquals(stats.failed, 0);
  assertEquals(stats.cancelled, 0);
});