/**
 * Tests for file-based search utilities
 */

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { 
  searchEntries,
  listEntries,
  findEntriesById,
  countEntries,
  getAllFilePaths,
  getFileStatistics
} from './file-search.ts';
import { 
  KnowledgeType, 
  EntryStatus,
  KNOWLEDGE_ROOT,
  STATUS_FOLDERS 
} from './types.ts';
import { KNOWLEDGE_FILE_EXTENSION } from './file-format.ts';
import { serializeToMarkdown } from './file-io.ts';
import { ensureKnowledgeDirectories } from './file-io.ts';

// Test data setup
const testEntries = [
  {
    id: 'QUESTION_1',
    type: KnowledgeType.QUESTION,
    content: 'How do I configure the timeout setting?',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    lastUpdated: new Date('2024-01-01T10:00:00Z'),
    tags: ['configuration', 'timeout'],
    status: EntryStatus.OPEN,
    metadata: {},
    answered: false,
    answerIds: [],
    priority: 'medium' as const
  },
  {
    id: 'ANSWER_1',
    type: KnowledgeType.ANSWER,
    content: 'You can set the timeout in the config file using the processTimeout property.',
    timestamp: new Date('2024-01-01T11:00:00Z'),
    lastUpdated: new Date('2024-01-01T11:00:00Z'),
    tags: ['configuration', 'answer'],
    status: EntryStatus.OPEN,
    metadata: {},
    questionId: 'QUESTION_1',
    accepted: true,
    votes: 5
  },
  {
    id: 'NOTE_1',
    type: KnowledgeType.NOTE,
    content: 'Process performance seems to degrade after running for several hours.',
    timestamp: new Date('2024-01-01T12:00:00Z'),
    lastUpdated: new Date('2024-01-01T12:00:00Z'),
    tags: ['performance', 'observation'],
    status: EntryStatus.IN_PROGRESS,
    metadata: { severity: 'medium' },
    category: 'observation',
    relatedIds: []
  },
  {
    id: 'ISSUE_1',
    type: KnowledgeType.ISSUE,
    content: 'Memory leak detected in the process manager after 24-hour run.',
    timestamp: new Date('2024-01-01T13:00:00Z'),
    lastUpdated: new Date('2024-01-01T13:00:00Z'),
    tags: ['bug', 'memory', 'critical'],
    status: EntryStatus.COMPLETED,
    metadata: { reporter: 'system' },
    priority: 'high' as const,
    assignee: 'dev-team',
    dueDate: new Date('2024-01-15T00:00:00Z'),
    relatedIds: ['NOTE_1']
  }
];

async function setupTestFiles(): Promise<void> {
  await ensureKnowledgeDirectories();
  
  for (const entry of testEntries) {
    const statusFolder = STATUS_FOLDERS[entry.status];
    const filePath = join(KNOWLEDGE_ROOT, statusFolder, `${entry.id}${KNOWLEDGE_FILE_EXTENSION}`);
    const markdown = serializeToMarkdown(entry as any);
    await Deno.writeTextFile(filePath, markdown);
  }
}

async function cleanupTestFiles(): Promise<void> {
  try {
    await Deno.remove(KNOWLEDGE_ROOT, { recursive: true });
  } catch (error) {
    // Directory might not exist, that's ok
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn('Failed to cleanup test files:', error);
    }
  }
}

Deno.test("file-search - listEntries should return all entries", async () => {
  await setupTestFiles();
  
  try {
    const results = await listEntries();
    
    assertEquals(results.length, 4);
    
    // Check that we have all expected IDs
    const ids = results.map(r => r.entry.id).sort();
    assertEquals(ids, ['ANSWER_1', 'ISSUE_1', 'NOTE_1', 'QUESTION_1']);
    
    // Verify entries have all expected fields
    for (const result of results) {
      assertExists(result.entry.id);
      assertExists(result.entry.type);
      assertExists(result.entry.content);
      assertExists(result.entry.timestamp);
      assertExists(result.entry.lastUpdated);
      assertExists(result.filePath);
    }
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - listEntries should filter by type", async () => {
  await setupTestFiles();
  
  try {
    const results = await listEntries({ type: KnowledgeType.QUESTION });
    
    assertEquals(results.length, 1);
    assertEquals(results[0].entry.id, 'QUESTION_1');
    assertEquals(results[0].entry.type, KnowledgeType.QUESTION);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - listEntries should filter by status", async () => {
  await setupTestFiles();
  
  try {
    const results = await listEntries({ status: EntryStatus.OPEN });
    
    assertEquals(results.length, 2);
    const ids = results.map(r => r.entry.id).sort();
    assertEquals(ids, ['ANSWER_1', 'QUESTION_1']);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - listEntries should filter by tags", async () => {
  await setupTestFiles();
  
  try {
    const results = await listEntries({ tags: ['configuration'] });
    
    assertEquals(results.length, 2);
    const ids = results.map(r => r.entry.id).sort();
    assertEquals(ids, ['ANSWER_1', 'QUESTION_1']);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - listEntries should apply pagination", async () => {
  await setupTestFiles();
  
  try {
    const page1 = await listEntries({ limit: 2, offset: 0, sortBy: 'id', sortOrder: 'asc' });
    const page2 = await listEntries({ limit: 2, offset: 2, sortBy: 'id', sortOrder: 'asc' });
    
    assertEquals(page1.length, 2);
    assertEquals(page2.length, 2);
    assertEquals(page1[0].entry.id, 'ANSWER_1');
    assertEquals(page1[1].entry.id, 'ISSUE_1');
    assertEquals(page2[0].entry.id, 'NOTE_1');
    assertEquals(page2[1].entry.id, 'QUESTION_1');
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - listEntries should sort correctly", async () => {
  await setupTestFiles();
  
  try {
    // Sort by timestamp ascending
    const byTime = await listEntries({ sortBy: 'timestamp', sortOrder: 'asc' });
    assertEquals(byTime[0].entry.id, 'QUESTION_1');
    assertEquals(byTime[3].entry.id, 'ISSUE_1');
    
    // Sort by type descending
    const byType = await listEntries({ sortBy: 'type', sortOrder: 'desc' });
    assertEquals(byType[0].entry.type, KnowledgeType.QUESTION);
    assertEquals(byType[3].entry.type, KnowledgeType.ANSWER);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - searchEntries should find content matches", async () => {
  await setupTestFiles();
  
  try {
    const results = await searchEntries({ 
      query: 'timeout',
      searchFields: ['content'] 
    });
    
    assertEquals(results.length, 2);
    
    // Should find both question and answer about timeout
    const ids = results.map(r => r.entry.id).sort();
    assertEquals(ids, ['ANSWER_1', 'QUESTION_1']);
    
    // Results should be scored
    for (const result of results) {
      assertExists(result.score);
      assert(result.score! > 0);
    }
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - searchEntries should find tag matches", async () => {
  await setupTestFiles();
  
  try {
    const results = await searchEntries({ 
      query: 'performance',
      searchFields: ['tags'] 
    });
    
    assertEquals(results.length, 1);
    assertEquals(results[0].entry.id, 'NOTE_1');
    assert(results[0].score! >= 5); // Tags get higher scores
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - searchEntries should handle case sensitivity", async () => {
  await setupTestFiles();
  
  try {
    // Case insensitive (default)
    const insensitive = await searchEntries({ 
      query: 'TIMEOUT',
      searchFields: ['content'] 
    });
    assertEquals(insensitive.length, 2);
    
    // Case sensitive
    const sensitive = await searchEntries({ 
      query: 'TIMEOUT',
      searchFields: ['content'],
      caseSensitive: true 
    });
    assertEquals(sensitive.length, 0);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - findEntriesById should find existing entries", async () => {
  await setupTestFiles();
  
  try {
    const results = await findEntriesById(['QUESTION_1', 'NOTE_1', 'NONEXISTENT_1']);
    
    assertEquals(results.size, 2);
    
    const question = results.get('QUESTION_1');
    assertExists(question);
    assertEquals(question.entry.type, KnowledgeType.QUESTION);
    
    const note = results.get('NOTE_1');
    assertExists(note);
    assertEquals(note.entry.type, KnowledgeType.NOTE);
    
    assertEquals(results.get('NONEXISTENT_1'), undefined);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - countEntries should return correct counts", async () => {
  await cleanupTestFiles(); // Clean first
  await setupTestFiles();
  
  try {
    const total = await countEntries();
    assertEquals(total, 4);
    
    const questions = await countEntries({ type: KnowledgeType.QUESTION });
    assertEquals(questions, 1);
    
    const openEntries = await countEntries({ status: EntryStatus.OPEN });
    assertEquals(openEntries, 2);
    
    const configEntries = await countEntries({ tags: ['configuration'] });
    assertEquals(configEntries, 2);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - getAllFilePaths should return all file paths", async () => {
  await setupTestFiles();
  
  try {
    const allPaths = await getAllFilePaths();
    assertEquals(allPaths.length, 4);
    
    // All paths should end with .md
    for (const path of allPaths) {
      assert(path.endsWith(KNOWLEDGE_FILE_EXTENSION));
      assert(path.includes(KNOWLEDGE_ROOT));
    }
    
    // Test filtering by status
    const openPaths = await getAllFilePaths(EntryStatus.OPEN);
    assertEquals(openPaths.length, 2);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - getFileStatistics should return correct statistics", async () => {
  await setupTestFiles();
  
  try {
    const stats = await getFileStatistics();
    
    assertEquals(stats.totalFiles, 4);
    assertEquals(stats.byType[KnowledgeType.QUESTION], 1);
    assertEquals(stats.byType[KnowledgeType.ANSWER], 1);
    assertEquals(stats.byType[KnowledgeType.NOTE], 1);
    assertEquals(stats.byType[KnowledgeType.ISSUE], 1);
    
    assertEquals(stats.byStatus[EntryStatus.OPEN], 2);
    assertEquals(stats.byStatus[EntryStatus.IN_PROGRESS], 1);
    assertEquals(stats.byStatus[EntryStatus.COMPLETED], 1);
    assertEquals(stats.byStatus[EntryStatus.ARCHIVED], 0);
    
    // Check folder distribution
    assertExists(stats.byFolder['open']);
    assertExists(stats.byFolder['in-progress']);
    assertExists(stats.byFolder['completed']);
    assertExists(stats.byFolder['archived']);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("file-search - should handle empty knowledge base", async () => {
  await cleanupTestFiles(); // Ensure clean state
  
  const results = await listEntries();
  assertEquals(results.length, 0);
  
  const count = await countEntries();
  assertEquals(count, 0);
  
  const paths = await getAllFilePaths();
  assertEquals(paths.length, 0);
  
  const stats = await getFileStatistics();
  assertEquals(stats.totalFiles, 0);
});

Deno.test("file-search - should handle invalid files gracefully", async () => {
  await cleanupTestFiles(); // Ensure clean state first
  await ensureKnowledgeDirectories();
  
  try {
    // Create an invalid file that doesn't follow the naming convention
    const invalidPath = join(KNOWLEDGE_ROOT, 'open', 'INVALID_1.md');
    await Deno.writeTextFile(invalidPath, 'This is not valid markdown with frontmatter');
    
    // Should not throw, but should skip the invalid file
    const results = await listEntries();
    assertEquals(results.length, 0);
    
    // Count should also be 0 since invalid files are skipped
    const count = await countEntries();
    assertEquals(count, 0);
  } finally {
    await cleanupTestFiles();
  }
});