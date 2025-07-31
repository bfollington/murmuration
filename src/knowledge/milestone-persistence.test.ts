/**
 * Tests for milestone persistence module
 */

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import {
  loadMilestone,
  saveMilestone,
  createDefaultMilestone,
  getMilestoneFilePath,
  milestoneExists,
  deleteMilestone
} from './milestone-persistence.ts';
import {
  Milestone,
  KnowledgeType,
  EntryStatus,
  KNOWLEDGE_ROOT
} from './types.ts';

// Test utilities
async function cleanupTestFiles() {
  try {
    await Deno.remove(KNOWLEDGE_ROOT, { recursive: true });
  } catch (error) {
    // Ignore if directory doesn't exist
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

function createTestMilestone(): Milestone {
  return {
    id: 'MILESTONE_1',
    type: KnowledgeType.MILESTONE,
    content: 'Test milestone content with detailed description',
    timestamp: new Date('2025-07-31T10:00:00.000Z'),
    lastUpdated: new Date('2025-07-31T12:00:00.000Z'),
    tags: ['test', 'milestone'],
    status: EntryStatus.IN_PROGRESS,
    processId: 'test-process-123',
    metadata: { owner: 'test-user', priority: 'high' },
    title: 'Test Milestone',
    description: 'A test milestone for validation',
    targetDate: new Date('2025-08-31T00:00:00.000Z'),
    progress: 50,
    relatedIssueIds: ['ISSUE_1', 'ISSUE_2']
  };
}

async function createCorruptedMilestoneFile() {
  const filePath = getMilestoneFilePath();
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await Deno.mkdir(dir, { recursive: true });
  
  // Create file with invalid YAML
  const corruptedContent = `---
id: MILESTONE_1
type: milestone
invalid_yaml: [unclosed array
---

Corrupted milestone content`;
  
  await Deno.writeTextFile(filePath, corruptedContent);
}

async function createInvalidMilestoneFile() {
  const filePath = getMilestoneFilePath();
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await Deno.mkdir(dir, { recursive: true });
  
  // Create file with missing frontmatter delimiter
  const invalidContent = `This is not a valid markdown file with frontmatter`;
  
  await Deno.writeTextFile(filePath, invalidContent);
}

// Tests for getMilestoneFilePath
Deno.test("getMilestoneFilePath - returns correct path", () => {
  const path = getMilestoneFilePath();
  assertEquals(path, join(KNOWLEDGE_ROOT, 'GOAL.md'));
});

// Tests for milestoneExists
Deno.test("milestoneExists - returns false when file doesn't exist", async () => {
  await cleanupTestFiles();
  const exists = await milestoneExists();
  assertEquals(exists, false);
});

Deno.test("milestoneExists - returns true when file exists", async () => {
  await cleanupTestFiles();
  const milestone = createTestMilestone();
  await saveMilestone(milestone);
  
  const exists = await milestoneExists();
  assertEquals(exists, true);
  
  await cleanupTestFiles();
});

// Tests for loadMilestone
Deno.test("loadMilestone - returns undefined when file doesn't exist", async () => {
  await cleanupTestFiles();
  
  const result = await loadMilestone();
  assertEquals(result.success, true);
  assertEquals(result.data, undefined);
});

Deno.test("loadMilestone - successfully loads valid milestone", async () => {
  await cleanupTestFiles();
  const milestone = createTestMilestone();
  await saveMilestone(milestone);
  
  const result = await loadMilestone();
  assertEquals(result.success, true);
  assertExists(result.data);
  
  const data = result.data!;
  assertEquals(data.id, milestone.id);
  assertEquals(data.title, milestone.title);
  assertEquals(data.type, KnowledgeType.MILESTONE);
  assertEquals(data.progress, 50);
  assertEquals(data.relatedIssueIds.length, 2);
  assertEquals(data.tags.includes('test'), true);
  
  await cleanupTestFiles();
});

Deno.test("loadMilestone - handles corrupted YAML frontmatter", async () => {
  await cleanupTestFiles();
  await createCorruptedMilestoneFile();
  
  const result = await loadMilestone();
  assertEquals(result.success, false);
  assert(result.error?.includes('invalid YAML frontmatter'));
  
  await cleanupTestFiles();
});

Deno.test("loadMilestone - handles invalid markdown format", async () => {
  await cleanupTestFiles();
  await createInvalidMilestoneFile();
  
  const result = await loadMilestone();
  assertEquals(result.success, false);
  assert(result.error?.includes('invalid format'));
  
  await cleanupTestFiles();
});

Deno.test("loadMilestone - handles wrong entry type", async () => {
  await cleanupTestFiles();
  
  // Create a file with non-milestone type
  const filePath = getMilestoneFilePath();
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await Deno.mkdir(dir, { recursive: true });
  
  const wrongTypeContent = `---
id: QUESTION_1
type: question
status: open
timestamp: 2025-07-31T10:00:00.000Z
lastUpdated: 2025-07-31T10:00:00.000Z
tags: []
---

This is not a milestone`;
  
  await Deno.writeTextFile(filePath, wrongTypeContent);
  
  const result = await loadMilestone();
  assertEquals(result.success, false);
  assert(result.error?.includes('Expected milestone type'));
  
  await cleanupTestFiles();
});

// Tests for saveMilestone
Deno.test("saveMilestone - successfully saves milestone", async () => {
  await cleanupTestFiles();
  const milestone = createTestMilestone();
  
  const result = await saveMilestone(milestone);
  assertEquals(result.success, true);
  
  // Verify file was created
  const exists = await milestoneExists();
  assertEquals(exists, true);
  
  // Verify content can be loaded back
  const loadResult = await loadMilestone();
  assertEquals(loadResult.success, true);
  assertEquals(loadResult.data?.id, milestone.id);
  
  await cleanupTestFiles();
});

Deno.test("saveMilestone - creates directory if needed", async () => {
  await cleanupTestFiles();
  
  // Ensure knowledge directory doesn't exist
  const knowledgeExists = async () => {
    try {
      await Deno.stat(KNOWLEDGE_ROOT);
      return true;
    } catch {
      return false;
    }
  };
  
  assertEquals(await knowledgeExists(), false);
  
  const milestone = createTestMilestone();
  const result = await saveMilestone(milestone);
  assertEquals(result.success, true);
  
  // Verify directory was created
  assertEquals(await knowledgeExists(), true);
  
  await cleanupTestFiles();
});

Deno.test("saveMilestone - uses atomic write pattern", async () => {
  await cleanupTestFiles();
  const milestone = createTestMilestone();
  
  // Mock a failure during rename to test atomic behavior
  const originalRename = Deno.rename;
  let renameCalled = false;
  
  // Override rename to track call
  (Deno as any).rename = async (oldPath: string, newPath: string) => {
    renameCalled = true;
    return originalRename(oldPath, newPath);
  };
  
  const result = await saveMilestone(milestone);
  assertEquals(result.success, true);
  assertEquals(renameCalled, true);
  
  // Restore original function
  (Deno as any).rename = originalRename;
  
  await cleanupTestFiles();
});

// Tests for createDefaultMilestone
Deno.test("createDefaultMilestone - creates milestone with defaults", async () => {
  await cleanupTestFiles();
  
  const result = await createDefaultMilestone();
  assertEquals(result.success, true);
  assertExists(result.data);
  
  const data = result.data!;
  assertEquals(data.id, 'MILESTONE_1');
  assertEquals(data.type, KnowledgeType.MILESTONE);
  assertEquals(data.title, 'Project Milestone');
  assertEquals(data.progress, 0);
  assertEquals(data.status, EntryStatus.OPEN);
  assert(data.tags.includes('milestone'));
  
  // Verify file was created
  const exists = await milestoneExists();
  assertEquals(exists, true);
  
  await cleanupTestFiles();
});

Deno.test("createDefaultMilestone - accepts custom request", async () => {
  await cleanupTestFiles();
  
  const customRequest = {
    title: 'Custom Milestone',
    description: 'Custom milestone description',
    content: 'Custom milestone content',
    tags: ['custom', 'test'],
    progress: 25,
    targetDate: new Date('2025-12-31T00:00:00.000Z'),
    relatedIssueIds: ['ISSUE_10'],
    metadata: { department: 'engineering' }
  };
  
  const result = await createDefaultMilestone(customRequest);
  assertEquals(result.success, true);
  assertExists(result.data);
  
  const data = result.data!;
  assertEquals(data.title, 'Custom Milestone');
  assertEquals(data.progress, 25);
  assertEquals(data.tags.includes('custom'), true);
  assertEquals(data.relatedIssueIds.includes('ISSUE_10'), true);
  assertEquals(data.metadata.department, 'engineering');
  
  await cleanupTestFiles();
});

Deno.test("createDefaultMilestone - fails if milestone already exists", async () => {
  await cleanupTestFiles();
  
  // Create first milestone
  const result1 = await createDefaultMilestone();
  assertEquals(result1.success, true);
  
  // Try to create second milestone
  const result2 = await createDefaultMilestone();
  assertEquals(result2.success, false);
  assert(result2.error?.includes('already exists'));
  
  await cleanupTestFiles();
});

// Tests for deleteMilestone
Deno.test("deleteMilestone - successfully deletes existing milestone", async () => {
  await cleanupTestFiles();
  const milestone = createTestMilestone();
  await saveMilestone(milestone);
  
  // Verify file exists
  assertEquals(await milestoneExists(), true);
  
  const result = await deleteMilestone();
  assertEquals(result.success, true);
  
  // Verify file was deleted
  assertEquals(await milestoneExists(), false);
  
  await cleanupTestFiles();
});

Deno.test("deleteMilestone - fails when milestone doesn't exist", async () => {
  await cleanupTestFiles();
  
  const result = await deleteMilestone();
  assertEquals(result.success, false);
  assert(result.error?.includes('does not exist'));
});

// Integration tests
Deno.test("milestone-persistence - full workflow integration", async () => {
  await cleanupTestFiles();
  
  // Step 1: Create default milestone
  const createResult = await createDefaultMilestone({
    title: 'Integration Test Milestone',
    progress: 30
  });
  assertEquals(createResult.success, true);
  assertExists(createResult.data);
  
  // Step 2: Load milestone
  const loadResult = await loadMilestone();
  assertEquals(loadResult.success, true);
  assertExists(loadResult.data);
  assertEquals(loadResult.data.title, 'Integration Test Milestone');
  assertEquals(loadResult.data.progress, 30);
  
  // Step 3: Modify and save milestone
  const milestone = loadResult.data!;
  milestone.progress = 75;
  milestone.lastUpdated = new Date();
  milestone.relatedIssueIds.push('ISSUE_NEW');
  
  const saveResult = await saveMilestone(milestone);
  assertEquals(saveResult.success, true);
  
  // Step 4: Verify changes persisted
  const loadResult2 = await loadMilestone();
  assertEquals(loadResult2.success, true);
  assertExists(loadResult2.data);
  assertEquals(loadResult2.data.progress, 75);
  assertEquals(loadResult2.data.relatedIssueIds.includes('ISSUE_NEW'), true);
  
  // Step 5: Delete milestone
  const deleteResult = await deleteMilestone();
  assertEquals(deleteResult.success, true);
  
  // Step 6: Verify deletion
  const finalLoadResult = await loadMilestone();
  assertEquals(finalLoadResult.success, true);
  assertEquals(finalLoadResult.data, undefined);
  
  await cleanupTestFiles();
});

// Error handling tests
Deno.test("milestone-persistence - handles date conversion correctly", async () => {
  await cleanupTestFiles();
  const milestone = createTestMilestone();
  await saveMilestone(milestone);
  
  const result = await loadMilestone();
  assertEquals(result.success, true);
  assertExists(result.data);
  
  // Verify dates are properly converted
  const data = result.data!;
  assert(data.timestamp instanceof Date);
  assert(data.lastUpdated instanceof Date);
  assert(data.targetDate instanceof Date);
  
  await cleanupTestFiles();
});

Deno.test("milestone-persistence - preserves all milestone fields", async () => {
  await cleanupTestFiles();
  const originalMilestone = createTestMilestone();
  
  await saveMilestone(originalMilestone);
  const result = await loadMilestone();
  
  assertEquals(result.success, true);
  assertExists(result.data);
  
  // Verify all fields are preserved
  const loaded = result.data!;
  assertEquals(loaded.id, originalMilestone.id);
  assertEquals(loaded.type, originalMilestone.type);
  assertEquals(loaded.content, originalMilestone.content);
  assertEquals(loaded.tags.length, originalMilestone.tags.length);
  assertEquals(loaded.status, originalMilestone.status);
  assertEquals(loaded.processId, originalMilestone.processId);
  assertEquals(loaded.title, originalMilestone.title);
  assertEquals(loaded.progress, originalMilestone.progress);
  assertEquals(loaded.relatedIssueIds.length, originalMilestone.relatedIssueIds.length);
  assertEquals(loaded.metadata.owner, originalMilestone.metadata.owner);
  
  await cleanupTestFiles();
});