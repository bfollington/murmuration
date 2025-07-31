import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { QueuePersistence } from "./persistence.ts";
import { QueueEntry, QueueStatus, createQueueEntry, QueuedProcess } from "./types.ts";

// Helper to create test entries
function createTestEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  const process: QueuedProcess = {
    script_name: "test.sh",
    title: "Test Process",
    priority: 5,
    args: ["--verbose"],
    env_vars: { TEST: "true" },
    metadata: { test: true },
  };
  
  return {
    id: crypto.randomUUID(),
    process,
    status: QueueStatus.pending,
    priority: 5,
    queuedAt: new Date(),
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

// Clean up test files
async function cleanup(filePath: string) {
  try {
    await Deno.remove(filePath);
  } catch {
    // Ignore if file doesn't exist
  }
  
  // Also clean up any backups
  const dir = await Deno.readDir(".");
  for await (const entry of dir) {
    if (entry.name.startsWith(filePath + ".backup-")) {
      try {
        await Deno.remove(entry.name);
      } catch {
        // Ignore
      }
    }
  }
}

Deno.test("QueuePersistence - save and load empty state", async () => {
  const filePath = "./test-queue-empty.json";
  const persistence = new QueuePersistence(filePath);
  
  try {
    // Save empty array
    await persistence.save([]);
    
    // Load should return empty array
    const loaded = await persistence.load();
    assertEquals(loaded.length, 0);
    
    // File should exist
    assertEquals(await persistence.exists(), true);
  } finally {
    await cleanup(filePath);
  }
});

Deno.test("QueuePersistence - save and load entries", async () => {
  const filePath = "./test-queue-entries.json";
  const persistence = new QueuePersistence(filePath);
  
  try {
    // Create test entries with various states
    const entries: QueueEntry[] = [
      createTestEntry({ 
        status: QueueStatus.pending,
      }),
      createTestEntry({ 
        status: QueueStatus.processing,
        startedAt: new Date(),
      }),
      createTestEntry({ 
        status: QueueStatus.completed,
        startedAt: new Date(Date.now() - 5000),
        completedAt: new Date(),
        processId: "proc-123",
      }),
      createTestEntry({ 
        status: QueueStatus.failed,
        error: "Test error",
        retryCount: 2,
      }),
    ];
    
    // Save entries
    await persistence.save(entries);
    
    // Load entries
    const loaded = await persistence.load();
    
    // Verify count
    assertEquals(loaded.length, entries.length);
    
    // Verify each entry
    for (let i = 0; i < entries.length; i++) {
      const original = entries[i];
      const restored = loaded[i];
      
      assertEquals(restored.id, original.id);
      assertEquals(restored.process.script_name, original.process.script_name);
      assertEquals(restored.process.title, original.process.title);
      assertEquals(restored.process.priority, original.process.priority);
      assertEquals(restored.status, original.status);
      assertEquals(restored.priority, original.priority);
      assertEquals(restored.retryCount, original.retryCount);
      assertEquals(restored.maxRetries, original.maxRetries);
      
      // Dates should be close (within 1ms due to serialization)
      assertEquals(
        Math.abs(restored.queuedAt.getTime() - original.queuedAt.getTime()) < 1,
        true
      );
      
      if (original.error) {
        assertEquals(restored.error, original.error);
      }
      
      if (original.processId) {
        assertEquals(restored.processId, original.processId);
      }
    }
  } finally {
    await cleanup(filePath);
  }
});

Deno.test("QueuePersistence - handle missing file", async () => {
  const filePath = "./test-queue-missing.json";
  const persistence = new QueuePersistence(filePath);
  
  // Ensure file doesn't exist
  await cleanup(filePath);
  
  // Load should return empty array
  const loaded = await persistence.load();
  assertEquals(loaded.length, 0);
  
  // Exists should return false
  assertEquals(await persistence.exists(), false);
});

Deno.test("QueuePersistence - validate integrity", async () => {
  const filePath = "./test-queue-validate.json";
  const persistence = new QueuePersistence(filePath);
  
  try {
    // Save valid entries
    const entries = [createTestEntry()];
    await persistence.save(entries);
    
    // Should be valid
    assertEquals(await persistence.validate(), true);
    
    // Corrupt the file
    const state = {
      version: "1.0.0",
      timestamp: new Date(),
      entries: [{ invalid: "data" }], // Invalid entry
    };
    await Deno.writeTextFile(filePath, JSON.stringify(state));
    
    // Should be invalid
    assertEquals(await persistence.validate(), false);
  } finally {
    await cleanup(filePath);
  }
});

Deno.test("QueuePersistence - backup and restore", async () => {
  const filePath = "./test-queue-backup.json";
  const persistence = new QueuePersistence(filePath);
  
  try {
    // Save some entries
    const entries = [
      createTestEntry({ status: QueueStatus.pending }),
      createTestEntry({ status: QueueStatus.completed }),
    ];
    await persistence.save(entries);
    
    // Create backup
    const backupPath = await persistence.backup();
    assertExists(backupPath);
    assertEquals(backupPath.startsWith(filePath + ".backup-"), true);
    
    // Modify the original
    await persistence.save([createTestEntry()]);
    
    // Verify modified
    let loaded = await persistence.load();
    assertEquals(loaded.length, 1);
    
    // Restore from backup
    await persistence.restore(backupPath);
    
    // Verify restored
    loaded = await persistence.load();
    assertEquals(loaded.length, 2);
    assertEquals(loaded[0].status, QueueStatus.pending);
    assertEquals(loaded[1].status, QueueStatus.completed);
    
    // Clean up backup
    await Deno.remove(backupPath);
  } finally {
    await cleanup(filePath);
  }
});

Deno.test("QueuePersistence - delete file", async () => {
  const filePath = "./test-queue-delete.json";
  const persistence = new QueuePersistence(filePath);
  
  try {
    // Save entries
    await persistence.save([createTestEntry()]);
    assertEquals(await persistence.exists(), true);
    
    // Delete
    await persistence.delete();
    assertEquals(await persistence.exists(), false);
    
    // Delete again should not throw
    await persistence.delete();
  } finally {
    await cleanup(filePath);
  }
});

Deno.test("QueuePersistence - handle corrupted JSON", async () => {
  const filePath = "./test-queue-corrupted.json";
  const persistence = new QueuePersistence(filePath);
  
  try {
    // Write invalid JSON
    await Deno.writeTextFile(filePath, "{ invalid json");
    
    // Load should throw
    let threw = false;
    try {
      await persistence.load();
    } catch (error) {
      threw = true;
      assertEquals(error.message.includes("Failed to load queue state"), true);
    }
    assertEquals(threw, true);
    
    // Validate should return false
    assertEquals(await persistence.validate(), false);
  } finally {
    await cleanup(filePath);
  }
});