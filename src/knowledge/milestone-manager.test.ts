/**
 * Tests for MilestoneManager
 * 
 * Tests the business logic layer for milestone operations including
 * creation, updates, progress tracking, and issue linking.
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { MilestoneManager } from './milestone-manager.ts';
import { CreateMilestoneRequest, EntryStatus } from './types.ts';
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Test utilities
function createTestMilestoneRequest(overrides: Partial<CreateMilestoneRequest> = {}): CreateMilestoneRequest {
  return {
    title: 'Test Milestone',
    description: 'A test milestone for validation',
    content: 'This is test content for the milestone',
    tags: ['test', 'milestone'],
    progress: 0,
    ...overrides
  };
}

async function cleanupTestFiles() {
  try {
    const testPath = join(Deno.cwd(), '.knowledge', 'GOAL.md');
    await Deno.remove(testPath);
  } catch {
    // Ignore if file doesn't exist
  }
}

Deno.test("MilestoneManager - constructor creates instance", () => {
  const manager = new MilestoneManager();
  assertExists(manager);
});

Deno.test("MilestoneManager - setMilestone creates new milestone", async () => {
  const manager = new MilestoneManager();
  
  // Clean up any existing milestone
  await cleanupTestFiles();
  
  const request = createTestMilestoneRequest({
    title: 'New Project Milestone',
    description: 'Setting up the project foundation',
    progress: 25
  });
  
  const result = await manager.setMilestone(request);
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.title, 'New Project Milestone');
  assertEquals(result.data!.progress, 25);
  assertEquals(result.data!.status, EntryStatus.OPEN);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - setMilestone validates input", async () => {
  const manager = new MilestoneManager();
  
  const invalidRequest = {
    title: '', // Invalid: empty title
    description: 'Test description',
    content: 'Test content'
  } as CreateMilestoneRequest;
  
  const result = await manager.setMilestone(invalidRequest);
  
  assertEquals(result.success, false);
  assertExists(result.error);
});

Deno.test("MilestoneManager - getCurrentMilestone returns milestone", async () => {
  const manager = new MilestoneManager();
  
  // Clean up first
  await cleanupTestFiles();
  
  // Create a milestone first
  const request = createTestMilestoneRequest();
  await manager.setMilestone(request);
  
  // Get current milestone
  const result = await manager.getCurrentMilestone();
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.title, 'Test Milestone');
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - getCurrentMilestone creates default if none exists", async () => {
  const manager = new MilestoneManager();
  
  // Clean up any existing milestone
  await cleanupTestFiles();
  
  const result = await manager.getCurrentMilestone();
  
  assertEquals(result.success, true);
  assertExists(result.data);
  // Should have created a default milestone
  assertExists(result.data!.title);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - updateMilestoneProgress updates progress", async () => {
  const manager = new MilestoneManager();
  
  // Clean up and create milestone
  await cleanupTestFiles();
  const request = createTestMilestoneRequest({ progress: 0 });
  await manager.setMilestone(request);
  
  // Update progress
  const result = await manager.updateMilestoneProgress(75);
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.progress, 75);
  assertEquals(result.data!.status, EntryStatus.IN_PROGRESS);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - updateMilestoneProgress validates progress range", async () => {
  const manager = new MilestoneManager();
  
  // Test invalid progress values
  const invalidValues = [-1, 101, NaN];
  
  for (const invalidValue of invalidValues) {
    const result = await manager.updateMilestoneProgress(invalidValue);
    
    assertEquals(result.success, false);
    assertExists(result.error);
  }
});

Deno.test("MilestoneManager - updateMilestoneProgress sets status based on progress", async () => {
  const manager = new MilestoneManager();
  
  // Clean up and create milestone
  await cleanupTestFiles();
  const request = createTestMilestoneRequest({ progress: 0 });
  await manager.setMilestone(request);
  
  // Test 100% progress sets COMPLETED status
  const result100 = await manager.updateMilestoneProgress(100);
  assertEquals(result100.success, true);
  assertEquals(result100.data!.status, EntryStatus.COMPLETED);
  
  // Test >0% progress sets IN_PROGRESS status
  const result50 = await manager.updateMilestoneProgress(50);
  assertEquals(result50.success, true);
  assertEquals(result50.data!.status, EntryStatus.IN_PROGRESS);
  
  // Test 0% progress sets OPEN status
  const result0 = await manager.updateMilestoneProgress(0);
  assertEquals(result0.success, true);
  assertEquals(result0.data!.status, EntryStatus.OPEN);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - addRelatedIssue adds issue to milestone", async () => {
  const manager = new MilestoneManager();
  
  // Clean up and create milestone
  await cleanupTestFiles();
  const request = createTestMilestoneRequest();
  await manager.setMilestone(request);
  
  // Add related issue
  const result = await manager.addRelatedIssue('ISSUE_123');
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.relatedIssueIds.length, 1);
  assertEquals(result.data!.relatedIssueIds[0], 'ISSUE_123');
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - addRelatedIssue validates issue ID format", async () => {
  const manager = new MilestoneManager();
  
  // Test invalid issue ID formats
  const invalidIds = ['ISSUE', 'issue_123', '123', 'TASK_123', ''];
  
  for (const invalidId of invalidIds) {
    const result = await manager.addRelatedIssue(invalidId);
    
    assertEquals(result.success, false);
    assertExists(result.error);
  }
});

Deno.test("MilestoneManager - addRelatedIssue prevents duplicate issues", async () => {
  const manager = new MilestoneManager();
  
  // Clean up and create milestone
  await cleanupTestFiles();
  const request = createTestMilestoneRequest();
  await manager.setMilestone(request);
  
  // Add issue first time
  const result1 = await manager.addRelatedIssue('ISSUE_123');
  assertEquals(result1.success, true);
  
  // Try to add same issue again
  const result2 = await manager.addRelatedIssue('ISSUE_123');
  assertEquals(result2.success, false);
  assertExists(result2.error);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - removeRelatedIssue removes issue from milestone", async () => {
  const manager = new MilestoneManager();
  
  // Clean up and create milestone with issue
  await cleanupTestFiles();
  const request = createTestMilestoneRequest();
  await manager.setMilestone(request);
  await manager.addRelatedIssue('ISSUE_123');
  
  // Remove issue
  const result = await manager.removeRelatedIssue('ISSUE_123');
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.relatedIssueIds.length, 0);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - removeRelatedIssue handles non-existent issue", async () => {
  const manager = new MilestoneManager();
  
  // Clean up and create milestone
  await cleanupTestFiles();
  const request = createTestMilestoneRequest();
  await manager.setMilestone(request);
  
  // Try to remove non-existent issue
  const result = await manager.removeRelatedIssue('ISSUE_999');
  
  assertEquals(result.success, false);
  assertExists(result.error);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - getMilestoneProgress returns progress info", async () => {
  const manager = new MilestoneManager();
  
  // Clean up and create milestone
  await cleanupTestFiles();
  const request = createTestMilestoneRequest({ progress: 42 });
  await manager.setMilestone(request);
  await manager.addRelatedIssue('ISSUE_123');
  await manager.addRelatedIssue('ISSUE_456');
  
  const progressInfo = await manager.getMilestoneProgress();
  
  assertEquals(progressInfo.manualProgress, 42);
  assertEquals(progressInfo.totalIssues, 2);
  assertEquals(progressInfo.useCalculated, false);
  
  // Clean up
  await cleanupTestFiles();
});

Deno.test("MilestoneManager - getEventEmitter returns EventEmitter", () => {
  const manager = new MilestoneManager();
  const emitter = manager.getEventEmitter();
  
  assertExists(emitter);
  assertEquals(typeof emitter.emit, 'function');
  assertEquals(typeof emitter.on, 'function');
});

// Test event emission (basic test)
Deno.test("MilestoneManager - events are emitted on operations", async () => {
  const manager = new MilestoneManager();
  const events: string[] = [];
  
  // Set up event listeners
  const emitter = manager.getEventEmitter();
  emitter.on('milestone:created', () => events.push('created'));
  emitter.on('milestone:updated', () => events.push('updated'));
  emitter.on('milestone:progress_changed', () => events.push('progress_changed'));
  emitter.on('milestone:issue_linked', () => events.push('issue_linked'));
  
  // Clean up and perform operations
  await cleanupTestFiles();
  
  // Create milestone (should emit 'created')
  const request = createTestMilestoneRequest();
  await manager.setMilestone(request);
  
  // Update progress (should emit 'progress_changed')
  await manager.updateMilestoneProgress(50);
  
  // Add issue (should emit 'issue_linked')
  await manager.addRelatedIssue('ISSUE_123');
  
  // Check events were emitted
  assertEquals(events.includes('created'), true);
  assertEquals(events.includes('progress_changed'), true);
  assertEquals(events.includes('issue_linked'), true);
  
  // Clean up
  await cleanupTestFiles();
});