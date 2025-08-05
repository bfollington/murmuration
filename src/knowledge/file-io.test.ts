/**
 * Tests for file I/O utilities
 */

import { assertEquals, assertExists, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { 
  parseMarkdownFile, 
  serializeToMarkdown, 
  getNextEntryNumber,
  buildFilePath,
  parseCrossReferences,
  ensureKnowledgeDirectories,
  convertFrontmatterDates,
  validateParsedEntry
} from "./file-io.ts";
import { 
  KnowledgeType, 
  EntryStatus, 
  Issue, 
  Question,
  KNOWLEDGE_ROOT,
  STATUS_FOLDERS 
} from "./types.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * Test helper to create a temporary test file
 */
async function createTestFile(path: string, content: string): Promise<void> {
  await Deno.mkdir(join(path, '..'), { recursive: true });
  await Deno.writeTextFile(path, content);
}

/**
 * Clean up test directories
 */
async function cleanupTestDirs(): Promise<void> {
  try {
    await Deno.remove(KNOWLEDGE_ROOT, { recursive: true });
  } catch {
    // Directory might not exist, that's ok
  }
}

Deno.test("parseMarkdownFile - parses valid markdown with frontmatter", async () => {
  const testPath = join(KNOWLEDGE_ROOT, "test.md");
  const content = `---
id: TEST_1
type: issue
status: open
priority: high
timestamp: 2024-01-01T12:00:00.000Z
tags:
  - test
  - markdown
---

# Test Issue

This is a test issue for parsing.
`;

  await createTestFile(testPath, content);
  
  try {
    const result = await parseMarkdownFile(testPath);
    
    assertEquals(result.frontmatter.id, "TEST_1");
    assertEquals(result.frontmatter.type, "issue");
    assertEquals(result.frontmatter.status, "open");
    assertEquals(result.frontmatter.priority, "high");
    assertEquals(result.content, "# Test Issue\n\nThis is a test issue for parsing.");
  } finally {
    await cleanupTestDirs();
  }
});

Deno.test("parseMarkdownFile - throws on invalid frontmatter", async () => {
  const testPath = join(KNOWLEDGE_ROOT, "invalid.md");
  const content = `---
invalid: yaml: content: [
---

# Test
`;

  await createTestFile(testPath, content);
  
  try {
    await assertRejects(
      () => parseMarkdownFile(testPath),
      Error,
      "Invalid YAML frontmatter"
    );
  } finally {
    await cleanupTestDirs();
  }
});

Deno.test("serializeToMarkdown - creates proper markdown with frontmatter", () => {
  const issue: Issue = {
    id: "ISSUE_123",
    type: KnowledgeType.ISSUE,
    status: EntryStatus.OPEN,
    content: "# Fix the login bug\n\nThe login form is broken.",
    timestamp: new Date("2024-01-01T12:00:00.000Z"),
    lastUpdated: new Date("2024-01-02T14:30:00.000Z"),
    tags: ["bug", "urgent"],
    priority: "high",
    assignee: "developer",
    dueDate: new Date("2024-01-15T00:00:00.000Z"),
    relatedIds: ["NOTE_456"],
    metadata: { reporter: "user123" }
  };

  const markdown = serializeToMarkdown(issue);
  
  // Check that it contains the expected structure
  assertEquals(markdown.startsWith("---"), true);
  assertEquals(markdown.includes("id: ISSUE_123"), true);
  assertEquals(markdown.includes("type: issue"), true);
  assertEquals(markdown.includes("status: open"), true);
  assertEquals(markdown.includes("priority: high"), true);
  assertEquals(markdown.includes("assignee: developer"), true);
  assertEquals(markdown.includes("# Fix the login bug"), true);
});

Deno.test("getNextEntryNumber - returns 1 for new type", async () => {
  await cleanupTestDirs();
  const nextNumber = await getNextEntryNumber(KnowledgeType.ISSUE);
  assertEquals(nextNumber, 1);
});

Deno.test("buildFilePath - constructs correct path", () => {
  const issue: Issue = {
    id: "ISSUE_123",
    type: KnowledgeType.ISSUE,
    status: EntryStatus.IN_PROGRESS,
    content: "Test content",
    timestamp: new Date(),
    lastUpdated: new Date(),
    tags: [],
    priority: "medium",
    metadata: {}
  };

  const path = buildFilePath(issue);
  const expected = join(KNOWLEDGE_ROOT, STATUS_FOLDERS[EntryStatus.IN_PROGRESS], "ISSUE_123.md");
  assertEquals(path, expected);
});

Deno.test.ignore("parseCrossReferences - finds cross-references in content", () => {
  const content = `
# Test Issue

This issue is related to [[NOTE_456]] and [[QUESTION_789]].
Also see [[ISSUE_001]] for more context.

Some text with [[INVALID_REF]] should be ignored.
`;

  const refs = parseCrossReferences(content);
  
  assertEquals(refs.length, 3);
  assertEquals(refs[0].id, "NOTE_456");
  assertEquals(refs[0].type, KnowledgeType.NOTE);
  assertEquals(refs[1].id, "QUESTION_789");
  assertEquals(refs[1].type, KnowledgeType.QUESTION);
  assertEquals(refs[2].id, "ISSUE_001");
  assertEquals(refs[2].type, KnowledgeType.ISSUE);
});

Deno.test("ensureKnowledgeDirectories - creates directory structure", async () => {
  await cleanupTestDirs();
  
  await ensureKnowledgeDirectories();
  
  // Check that all directories exist
  const rootStat = await Deno.stat(KNOWLEDGE_ROOT);
  assertEquals(rootStat.isDirectory, true);
  
  for (const folder of Object.values(STATUS_FOLDERS)) {
    const folderPath = join(KNOWLEDGE_ROOT, folder);
    const folderStat = await Deno.stat(folderPath);
    assertEquals(folderStat.isDirectory, true);
  }
  
  await cleanupTestDirs();
});

Deno.test("convertFrontmatterDates - converts date strings to Date objects", () => {
  const frontmatter = {
    id: "TEST_1",
    timestamp: "2024-01-01T12:00:00.000Z",
    lastUpdated: "2024-01-02T14:30:00.000Z",
    dueDate: "2024-01-15T00:00:00.000Z",
    someOtherField: "not a date"
  };

  const converted = convertFrontmatterDates(frontmatter);
  
  assertExists(converted.timestamp);
  assertEquals(converted.timestamp instanceof Date, true);
  assertEquals((converted.timestamp as Date).toISOString(), "2024-01-01T12:00:00.000Z");
  
  assertExists(converted.lastUpdated);
  assertEquals(converted.lastUpdated instanceof Date, true);
  
  assertExists(converted.dueDate);
  assertEquals(converted.dueDate instanceof Date, true);
  
  assertEquals(converted.someOtherField, "not a date");
});

Deno.test("validateParsedEntry - validates required fields", () => {
  const validFrontmatter = {
    id: "TEST_1",
    type: "issue",
    status: "open",
    timestamp: new Date(),
    lastUpdated: new Date(),
    tags: ["test"]
  };
  
  const validContent = "# Test content";
  
  assertEquals(validateParsedEntry(validFrontmatter, validContent), true);
  
  // Test missing required field
  const invalidFrontmatter = { ...validFrontmatter };
  delete (invalidFrontmatter as any).id;
  assertEquals(validateParsedEntry(invalidFrontmatter, validContent), false);
  
  // Test invalid type
  const invalidTypeFrontmatter = { ...validFrontmatter, type: "invalid" };
  assertEquals(validateParsedEntry(invalidTypeFrontmatter, validContent), false);
  
  // Test empty content
  assertEquals(validateParsedEntry(validFrontmatter, ""), false);
});