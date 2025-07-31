import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  createQueueEntry,
  DEFAULT_QUEUE_CONFIG,
  isValidQueuedProcess,
  isValidQueuePriority,
  queueComparator,
  QueuedProcess,
  QueueEntry,
  QueueStatus,
} from "./types.ts";

Deno.test("isValidQueuePriority - validates priority range", () => {
  // Valid priorities
  for (let i = 1; i <= 10; i++) {
    assertEquals(isValidQueuePriority(i), true, `Priority ${i} should be valid`);
  }
  
  // Invalid priorities
  assertEquals(isValidQueuePriority(0), false);
  assertEquals(isValidQueuePriority(11), false);
  assertEquals(isValidQueuePriority(-1), false);
  assertEquals(isValidQueuePriority(5.5), false);
  assertEquals(isValidQueuePriority(NaN), false);
});

Deno.test("isValidQueuedProcess - validates process structure", () => {
  const validProcess: QueuedProcess = {
    script_name: "test.sh",
    title: "Test Process",
    priority: 5,
  };
  
  assertEquals(isValidQueuedProcess(validProcess), true);
  
  // With optional fields
  const processWithOptionals: QueuedProcess = {
    script_name: "test.sh",
    title: "Test Process",
    priority: 7,
    args: ["--verbose"],
    env_vars: { NODE_ENV: "test" },
    name: "test-process",
    batchId: "batch-123",
    metadata: { key: "value" },
  };
  
  assertEquals(isValidQueuedProcess(processWithOptionals), true);
  
  // Invalid cases
  assertEquals(isValidQueuedProcess(null), false);
  assertEquals(isValidQueuedProcess(undefined), false);
  assertEquals(isValidQueuedProcess("string"), false);
  assertEquals(isValidQueuedProcess({}), false);
  assertEquals(isValidQueuedProcess({ script_name: "test.sh" }), false); // missing title
  assertEquals(isValidQueuedProcess({ script_name: "test.sh", title: "Test", priority: 0 }), false); // invalid priority
});

Deno.test("createQueueEntry - creates entry with defaults", () => {
  const process: QueuedProcess = {
    script_name: "test.sh",
    title: "Test Process",
    priority: 8,
  };
  
  const entry = createQueueEntry(process);
  
  assertEquals(entry.process, process);
  assertEquals(entry.status, QueueStatus.pending);
  assertEquals(entry.priority, 8);
  assertEquals(entry.retryCount, 0);
  assertEquals(entry.maxRetries, DEFAULT_QUEUE_CONFIG.defaultMaxRetries);
  assertEquals(typeof entry.id, "string");
  assertEquals(entry.id.length, 36); // UUID length
  assertEquals(entry.queuedAt instanceof Date, true);
});

Deno.test("queueComparator - sorts by priority then FIFO", () => {
  const now = new Date();
  
  const entry1: QueueEntry = {
    id: "1",
    process: { script_name: "test1.sh", title: "Test 1", priority: 5 },
    status: QueueStatus.pending,
    priority: 5,
    queuedAt: new Date(now.getTime() - 1000),
    retryCount: 0,
    maxRetries: 3,
  };
  
  const entry2: QueueEntry = {
    id: "2",
    process: { script_name: "test2.sh", title: "Test 2", priority: 5 },
    status: QueueStatus.pending,
    priority: 5,
    queuedAt: new Date(now.getTime()),
    retryCount: 0,
    maxRetries: 3,
  };
  
  const entry3: QueueEntry = {
    id: "3",
    process: { script_name: "test3.sh", title: "Test 3", priority: 8 },
    status: QueueStatus.pending,
    priority: 8,
    queuedAt: new Date(now.getTime() - 500),
    retryCount: 0,
    maxRetries: 3,
  };
  
  // Same priority - should be FIFO
  assertEquals(queueComparator(entry1, entry2) < 0, true); // entry1 comes first
  
  // Different priority - higher priority first
  assertEquals(queueComparator(entry3, entry1) < 0, true); // entry3 (priority 8) comes first
  assertEquals(queueComparator(entry3, entry2) < 0, true); // entry3 (priority 8) comes first
  
  // Test array sorting
  const entries = [entry2, entry3, entry1];
  entries.sort(queueComparator);
  
  assertEquals(entries[0].id, "3"); // Highest priority
  assertEquals(entries[1].id, "1"); // Same priority as entry2, but queued earlier
  assertEquals(entries[2].id, "2"); // Same priority as entry1, but queued later
});