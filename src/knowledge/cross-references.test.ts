/**
 * Tests for cross-reference resolution utilities
 */

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { 
  resolveCrossReferences,
  findRelatedEntries,
  validateReferences,
  updateReferences,
  findBrokenReferences,
  getReferenceStatistics,
  extractReferenceIds,
  replaceReferences,
  validateCrossReferenceSyntax
} from './cross-references.ts';
import { 
  KnowledgeType, 
  EntryStatus,
  KNOWLEDGE_ROOT,
  STATUS_FOLDERS 
} from './types.ts';
import { KNOWLEDGE_FILE_EXTENSION } from './file-format.ts';
import { serializeToMarkdown, ensureKnowledgeDirectories } from './file-io.ts';

// Test data with cross-references
const testEntries = [
  {
    id: 'QUESTION_1',
    type: KnowledgeType.QUESTION,
    content: 'How do I fix the memory leak mentioned in [[ISSUE_1]]?',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    lastUpdated: new Date('2024-01-01T10:00:00Z'),
    tags: ['help', 'memory'],
    status: EntryStatus.OPEN,
    metadata: {},
    answered: false,
    answerIds: [],
    priority: 'high' as const
  },
  {
    id: 'ANSWER_1',
    type: KnowledgeType.ANSWER,
    content: 'The memory leak can be fixed by following the steps in [[NOTE_1]]. Also see [[ISSUE_1]] for background.',
    timestamp: new Date('2024-01-01T11:00:00Z'),
    lastUpdated: new Date('2024-01-01T11:00:00Z'),
    tags: ['solution', 'memory'],
    status: EntryStatus.OPEN,
    metadata: {},
    questionId: 'QUESTION_1',
    accepted: true,
    votes: 3
  },
  {
    id: 'NOTE_1',
    type: KnowledgeType.NOTE,
    content: 'Memory leak fix procedure:\n1. Stop the process\n2. Clear cache\n3. Restart with --memory-limit flag',
    timestamp: new Date('2024-01-01T12:00:00Z'),
    lastUpdated: new Date('2024-01-01T12:00:00Z'),
    tags: ['procedure', 'memory'],
    status: EntryStatus.COMPLETED,
    metadata: {},
    category: 'documentation',
    relatedIds: []
  },
  {
    id: 'ISSUE_1',
    type: KnowledgeType.ISSUE,
    content: 'Memory usage grows continuously during batch processing. Related to [[NOTE_1]] observations.',
    timestamp: new Date('2024-01-01T13:00:00Z'),
    lastUpdated: new Date('2024-01-01T13:00:00Z'),
    tags: ['bug', 'memory'],
    status: EntryStatus.IN_PROGRESS,
    metadata: {},
    priority: 'high' as const,
    assignee: 'dev-team',
    relatedIds: []
  },
  {
    id: 'NOTE_2',
    type: KnowledgeType.NOTE,
    content: 'This note references a non-existent entry [[QUESTION_999]] and also [[QUESTION_1]].',
    timestamp: new Date('2024-01-01T14:00:00Z'),
    lastUpdated: new Date('2024-01-01T14:00:00Z'),
    tags: ['test'],
    status: EntryStatus.OPEN,
    metadata: {},
    category: 'test',
    relatedIds: []
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
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn('Failed to cleanup test files:', error);
    }
  }
}

Deno.test("cross-references - resolveCrossReferences should find valid and invalid references", async () => {
  await cleanupTestFiles();
  await setupTestFiles();
  
  try {
    const content = 'See [[QUESTION_1]] and [[QUESTION_999]] for details.';
    const validations = await resolveCrossReferences(content);
    
    assertEquals(validations.length, 2);
    
    const questionRef = validations.find(v => v.reference.id === 'QUESTION_1');
    assertExists(questionRef);
    assertEquals(questionRef.exists, true);
    assertExists(questionRef.entry);
    assertEquals(questionRef.entry.type, KnowledgeType.QUESTION);
    
    const missingRef = validations.find(v => v.reference.id === 'QUESTION_999');
    assertExists(missingRef);
    assertEquals(missingRef.exists, false);
    assertEquals(missingRef.entry, undefined);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - findRelatedEntries should find bidirectional relationships", async () => {
  await setupTestFiles();
  
  try {
    const related = await findRelatedEntries('ISSUE_1');
    
    // ISSUE_1 references NOTE_1
    assertEquals(related.references.length, 1);
    assertEquals(related.references[0].entry.id, 'NOTE_1');
    
    // QUESTION_1 and ANSWER_1 reference ISSUE_1
    assertEquals(related.referencedBy.length, 2);
    const referencingIds = related.referencedBy.map(r => r.entry.id).sort();
    assertEquals(referencingIds, ['ANSWER_1', 'QUESTION_1']);
    
    // No bidirectional references in this case
    assertEquals(related.bidirectional.length, 0);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - findRelatedEntries should find bidirectional references", async () => {
  await setupTestFiles();
  
  try {
    const related = await findRelatedEntries('NOTE_1');
    
    // NOTE_1 doesn't reference anything
    assertEquals(related.references.length, 0);
    
    // ANSWER_1 and ISSUE_1 reference NOTE_1
    assertEquals(related.referencedBy.length, 2);
    const referencingIds = related.referencedBy.map(r => r.entry.id).sort();
    assertEquals(referencingIds, ['ANSWER_1', 'ISSUE_1']);
    
    // No bidirectional references
    assertEquals(related.bidirectional.length, 0);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - validateReferences should validate entry references", async () => {
  await cleanupTestFiles();
  await setupTestFiles();
  
  try {
    const entry = testEntries.find(e => e.id === 'NOTE_2')!;
    const validations = await validateReferences(entry as any);
    
    assertEquals(validations.length, 2);
    
    const validRef = validations.find(v => v.reference.id === 'QUESTION_1');
    assertExists(validRef);
    assertEquals(validRef.exists, true);
    
    const invalidRef = validations.find(v => v.reference.id === 'QUESTION_999');
    assertExists(invalidRef);
    assertEquals(invalidRef.exists, false);
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - updateReferences should update all references", async () => {
  await setupTestFiles();
  
  try {
    // Update all references from ISSUE_1 to ISSUE_2
    const updates = await updateReferences('ISSUE_1', 'ISSUE_2', true); // dry run
    
    assertEquals(updates.length, 2); // QUESTION_1 and ANSWER_1 reference ISSUE_1
    
    // Check the updates
    for (const update of updates) {
      assert(update.originalContent.includes('[[ISSUE_1]]'));
      assert(update.updatedContent.includes('[[ISSUE_2]]'));
      assert(!update.updatedContent.includes('[[ISSUE_1]]'));
      assert(update.changesCount >= 1);
    }
    
    // Verify dry run didn't actually change files
    const originalContent = await Deno.readTextFile(updates[0].filePath);
    assert(originalContent.includes('[[ISSUE_1]]'));
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - updateReferences should actually update files", async () => {
  await setupTestFiles();
  
  try {
    // Update references for real
    const updates = await updateReferences('ISSUE_1', 'ISSUE_2', false);
    
    assertEquals(updates.length, 2);
    
    // Verify files were actually updated
    for (const update of updates) {
      const updatedContent = await Deno.readTextFile(update.filePath);
      assert(updatedContent.includes('[[ISSUE_2]]'));
      assert(!updatedContent.includes('[[ISSUE_1]]'));
    }
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - findBrokenReferences should find all broken references", async () => {
  await cleanupTestFiles();
  await setupTestFiles();
  
  try {
    const broken = await findBrokenReferences();
    
    assertEquals(broken.length, 1); // Only NOTE_2 has a broken reference
    assertEquals(broken[0].entryId, 'NOTE_2');
    assertEquals(broken[0].brokenReferences.length, 1);
    assertEquals(broken[0].brokenReferences[0].reference.id, 'QUESTION_999');
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - getReferenceStatistics should return correct stats", async () => {
  await cleanupTestFiles();
  await setupTestFiles();
  
  try {
    const stats = await getReferenceStatistics();
    
    // Total references: QUESTION_1(1), ANSWER_1(2), ISSUE_1(1), NOTE_2(2) = 6
    assertEquals(stats.totalReferences, 6);
    
    // Unique referenced entries: ISSUE_1, NOTE_1, QUESTION_1, QUESTION_999 = 4
    assertEquals(stats.uniqueReferencedEntries, 4);
    
    // Broken references: QUESTION_999 appears once = 1
    assertEquals(stats.brokenReferences, 1);
    
    // Most referenced should include ISSUE_1 and NOTE_1
    const mostReferenced = stats.mostReferencedEntries;
    assert(mostReferenced.length > 0);
    const issue1 = mostReferenced.find(e => e.id === 'ISSUE_1');
    assertExists(issue1);
    assertEquals(issue1.count, 2); // Referenced by QUESTION_1 and ANSWER_1
  } finally {
    await cleanupTestFiles();
  }
});

Deno.test("cross-references - extractReferenceIds should extract unique IDs", () => {
  const content = 'See [[QUESTION_1]] and [[NOTE_1]] and also [[QUESTION_1]] again.';
  const ids = extractReferenceIds(content);
  
  assertEquals(ids.length, 2);
  assertEquals(ids.sort(), ['NOTE_1', 'QUESTION_1']);
});

Deno.test("cross-references - replaceReferences should replace multiple references", () => {
  const content = 'Check [[OLD_1]] and [[OLD_2]] for info. Also [[OLD_1]] is important.';
  const replacements = new Map([
    ['OLD_1', 'NEW_1'],
    ['OLD_2', 'NEW_2']
  ]);
  
  const updated = replaceReferences(content, replacements);
  
  assertEquals(updated, 'Check [[NEW_1]] and [[NEW_2]] for info. Also [[NEW_1]] is important.');
});

Deno.test("cross-references - validateCrossReferenceSyntax should find syntax issues", () => {
  const content = `
    Valid: [[QUESTION_1]]
    Single brackets: [QUESTION_2]
    Missing closing: [[QUESTION_3]
    Missing opening: [QUESTION_4]]
    Lowercase: [[question_5]]
    Missing underscore: [[QUESTION6]]
  `;
  
  const issues = validateCrossReferenceSyntax(content);
  
  assertEquals(issues.length, 5); // All except the valid one
  
  const singleBracket = issues.find(i => i.issue.includes('Single brackets'));
  assertExists(singleBracket);
  assertEquals(singleBracket.suggestion, '[[QUESTION_2]]');
  
  const lowercase = issues.find(i => i.issue.includes('Lowercase'));
  assertExists(lowercase);
  assertEquals(lowercase.suggestion, '[[QUESTION_5]]');
  
  const missingUnderscore = issues.find(i => i.issue.includes('Missing underscore'));
  assertExists(missingUnderscore);
  assertEquals(missingUnderscore.suggestion, '[[QUESTION_6]]');
});

Deno.test("cross-references - should handle empty content gracefully", async () => {
  const validations = await resolveCrossReferences('');
  assertEquals(validations.length, 0);
  
  const ids = extractReferenceIds('');
  assertEquals(ids.length, 0);
  
  const issues = validateCrossReferenceSyntax('');
  assertEquals(issues.length, 0);
});

Deno.test("cross-references - should handle content with no references", async () => {
  const content = 'This is just plain text with no cross-references.';
  
  const validations = await resolveCrossReferences(content);
  assertEquals(validations.length, 0);
  
  const ids = extractReferenceIds(content);
  assertEquals(ids.length, 0);
  
  const updated = replaceReferences(content, new Map([['OLD_1', 'NEW_1']]));
  assertEquals(updated, content); // Should be unchanged
});