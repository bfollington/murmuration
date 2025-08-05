import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { FileKnowledgeManager } from "./file-manager.ts";
import { KnowledgeType, EntryStatus } from "./types.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Test helper to clean up test files
async function cleanupTestFiles() {
  try {
    await Deno.remove('.knowledge', { recursive: true });
  } catch (error) {
    // Ignore if directory doesn't exist
  }
}

// Regression tests for issue tracking bugs
Deno.test("FileKnowledgeManager - getEntry returns issue with content field", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create an issue
  const createResult = await manager.createIssue({
    content: "Test issue content",
    priority: "high",
    tags: ["bug"]
  });
  assertEquals(createResult.success, true);
  const issueId = createResult.data!.id;
  
  // Get the issue and verify content is included
  const entry = await manager.getEntry(issueId);
  assertExists(entry);
  assertEquals(entry.type, KnowledgeType.ISSUE);
  assertEquals(entry.content, "Test issue content");
  assertExists(entry.timestamp);
  assertExists(entry.lastUpdated);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - updateEntry preserves content when updating other fields", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create an issue with content
  const createResult = await manager.createIssue({
    content: "# Original Title\n\nOriginal content",
    priority: "medium",
    tags: ["test"]
  });
  assertEquals(createResult.success, true);
  const issueId = createResult.data!.id;
  
  // Update only the status
  const updateResult = await manager.updateEntry(issueId, {
    status: EntryStatus.IN_PROGRESS
  });
  assertEquals(updateResult.success, true);
  
  // Verify content is preserved
  const updated = await manager.getEntry(issueId);
  assertExists(updated);
  assertEquals(updated.content, "# Original Title\n\nOriginal content");
  assertEquals(updated.status, EntryStatus.IN_PROGRESS);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - handles empty content gracefully", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create an issue with minimal content
  const createResult = await manager.createIssue({
    content: "",
    priority: "low",
    tags: []
  });
  assertEquals(createResult.success, false); // Should fail validation
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - searchEntries returns issues with content", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create multiple issues
  await manager.createIssue({
    content: "Issue 1 content",
    priority: "high",
    tags: ["search-test"]
  });
  
  await manager.createIssue({
    content: "Issue 2 content",
    priority: "medium",
    tags: ["search-test"]
  });
  
  // Search for issues
  const searchResult = await manager.searchEntries({
    type: KnowledgeType.ISSUE,
    tags: ["search-test"]
  });
  
  assertEquals(searchResult.length, 2);
  
  // Verify all entries have content
  for (const entry of searchResult) {
    assertExists(entry.content);
    assert(entry.content.includes("content"));
  }
  
  await cleanupTestFiles();
});