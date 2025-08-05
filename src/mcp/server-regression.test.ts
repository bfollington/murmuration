import { assertEquals, assertExists, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { MCPProcessServer } from './server.ts';
import { ProcessManager } from '../process/manager.ts';
import { ProcessRegistry } from '../process/registry.ts';
import { ProcessMonitoringConfig } from '../process/types.ts';
import { FileKnowledgeManager } from '../knowledge/file-manager.ts';
import { EntryStatus } from '../knowledge/types.ts';
import { IntegratedQueueManager } from '../queue/integrated-manager.ts';
import { MilestoneManager } from '../knowledge/milestone-manager.ts';

/**
 * Create a test ProcessManager instance for testing
 */
function createTestProcessManager(): ProcessManager {
  const registry = new ProcessRegistry();
  const config: ProcessMonitoringConfig = {
    logBufferSize: 100,
    heartbeatInterval: 1000,
    maxRestarts: 1
  };
  return new ProcessManager(registry, config);
}

/**
 * Create test managers for MCP server
 */
function createTestManagers(): {
  processManager: ProcessManager;
  knowledgeManager: FileKnowledgeManager;
  queueManager: IntegratedQueueManager;
  milestoneManager: MilestoneManager;
} {
  const processManager = createTestProcessManager();
  const knowledgeManager = new FileKnowledgeManager();
  const queueManager = new IntegratedQueueManager(processManager, {
    maxConcurrentProcesses: 2,
    autoStart: false, // Don't auto-start in tests
    persistInterval: 0, // Don't persist in tests
    restoreOnStartup: false,
  });
  const milestoneManager = new MilestoneManager();
  
  return { processManager, knowledgeManager, queueManager, milestoneManager };
}

// Test helper to clean up test files
async function cleanupTestFiles() {
  try {
    await Deno.remove('.knowledge', { recursive: true });
  } catch (error) {
    // Ignore if directory doesn't exist
  }
}

/**
 * Regression tests for issue tracking content handling
 */
Deno.test('MCPProcessServer - handleUpdateIssue with missing content', async () => {
  await cleanupTestFiles();
  const { processManager, knowledgeManager, queueManager, milestoneManager } = createTestManagers();
  const server = new MCPProcessServer(processManager, knowledgeManager, queueManager, milestoneManager);
  
  // Create an issue first
  const createResult = await knowledgeManager.createIssue({
    content: '# Test Issue\n\nThis is test content',
    priority: 'medium',
    tags: ['test']
  });
  
  assert(createResult.success);
  const issueId = createResult.data!.id;
  
  // Test updating title when issue has content
  const updateTitleResult = await server.callTool({
    name: 'update_issue',
    arguments: {
      issue_id: issueId,
      title: 'Updated Title'
    }
  });
  
  // Should succeed without throwing split error
  assertExists(updateTitleResult);
  assert(updateTitleResult.content[0].text.includes('updated successfully'));
  
  // Verify content is preserved
  const updatedIssue = await knowledgeManager.getEntry(issueId);
  assertExists(updatedIssue);
  assert(updatedIssue.content.includes('This is test content'));
  assert(updatedIssue.content.includes('Updated Title'));
  
  await cleanupTestFiles();
});

Deno.test('MCPProcessServer - handleUpdateIssue with undefined content field', async () => {
  await cleanupTestFiles();
  const { processManager, knowledgeManager, queueManager, milestoneManager } = createTestManagers();
  const server = new MCPProcessServer(processManager, knowledgeManager, queueManager, milestoneManager);
  
  // Create an issue
  const createResult = await knowledgeManager.createIssue({
    content: 'Minimal content',
    priority: 'low',
    tags: []
  });
  
  assert(createResult.success);
  const issueId = createResult.data!.id;
  
  // Update only status - should not throw error even if content handling has issues
  const updateStatusResult = await server.callTool({
    name: 'update_issue',
    arguments: {
      issue_id: issueId,
      status: 'completed'
    }
  });
  
  assertExists(updateStatusResult);
  assert(updateStatusResult.content[0].text.includes('updated successfully'));
  
  // Verify the update worked
  const updatedIssue = await knowledgeManager.getEntry(issueId);
  assertExists(updatedIssue);
  assertEquals(updatedIssue.status, EntryStatus.COMPLETED);
  assertEquals(updatedIssue.content, 'Minimal content');
  
  await cleanupTestFiles();
});

Deno.test('MCPProcessServer - handleUpdateIssue preserves metadata', async () => {
  await cleanupTestFiles();
  const { processManager, knowledgeManager, queueManager, milestoneManager } = createTestManagers();
  const server = new MCPProcessServer(processManager, knowledgeManager, queueManager, milestoneManager);
  
  // Create an issue with title in metadata
  const createResult = await knowledgeManager.createIssue({
    content: '# Original Title\n\nContent here',
    priority: 'high',
    tags: ['metadata-test'],
    metadata: {
      title: 'Original Title',
      customField: 'test-value'
    }
  });
  
  assert(createResult.success);
  const issueId = createResult.data!.id;
  
  // Update content only
  const updateResult = await server.callTool({
    name: 'update_issue',
    arguments: {
      issue_id: issueId,
      content: 'New content without title header'
    }
  });
  
  assertExists(updateResult);
  
  // Verify metadata is preserved
  const updatedIssue = await knowledgeManager.getEntry(issueId);
  assertExists(updatedIssue);
  assertEquals(updatedIssue.metadata.customField, 'test-value');
  
  await cleanupTestFiles();
});