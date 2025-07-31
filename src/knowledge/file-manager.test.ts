import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { FileKnowledgeManager } from "./file-manager.ts";
import { KnowledgeType, EntryStatus, isQuestion } from "./types.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Test helper to clean up test files
async function cleanupTestFiles() {
  try {
    await Deno.remove('.knowledge', { recursive: true });
  } catch (error) {
    // Ignore if directory doesn't exist
  }
}

Deno.test("FileKnowledgeManager - createQuestion creates file and returns question", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  const result = await manager.createQuestion({
    content: "How do I test file operations?",
    tags: ["testing", "files"],
    priority: "high"
  });
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.type, KnowledgeType.QUESTION);
  assertEquals(result.data!.content, "How do I test file operations?");
  assertEquals(result.data!.tags, ["testing", "files"]);
  assertEquals(result.data!.priority, "high");
  assertEquals(result.data!.answered, false);
  
  // Verify file was created
  const filePath = join('.knowledge', 'open', `${result.data!.id}.md`);
  const fileInfo = await Deno.stat(filePath);
  assert(fileInfo.isFile);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - createAnswer links to question", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create a question first
  const questionResult = await manager.createQuestion({
    content: "What is the best testing approach?",
    tags: ["testing"]
  });
  assertEquals(questionResult.success, true);
  const questionId = questionResult.data!.id;
  
  // Create an answer
  const answerResult = await manager.createAnswer({
    content: "Use unit tests with comprehensive coverage.",
    questionId,
    tags: ["testing", "best-practices"]
  });
  
  assertEquals(answerResult.success, true);
  assertExists(answerResult.data);
  assertEquals(answerResult.data!.questionId, questionId);
  assertEquals(answerResult.data!.accepted, false);
  
  // Verify question was updated to show it's answered
  const updatedQuestion = await manager.getEntry(questionId);
  assertExists(updatedQuestion);
  assert(isQuestion(updatedQuestion));
  assertEquals(updatedQuestion.answered, true);
  
  // Verify files exist
  const questionPath = join('.knowledge', 'open', `${questionId}.md`);
  const answerPath = join('.knowledge', 'open', `${answerResult.data!.id}.md`);
  
  const questionInfo = await Deno.stat(questionPath);
  const answerInfo = await Deno.stat(answerPath);
  assert(questionInfo.isFile);
  assert(answerInfo.isFile);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - createNote creates file with metadata", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  const result = await manager.createNote({
    content: "Test notes should be comprehensive and cover edge cases.",
    category: "best-practice",
    tags: ["testing", "documentation"],
    metadata: { author: "test-user" }
  });
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.type, KnowledgeType.NOTE);
  assertEquals(result.data!.category, "best-practice");
  assertEquals(result.data!.metadata.author, "test-user");
  
  // Verify file was created
  const filePath = join('.knowledge', 'open', `${result.data!.id}.md`);
  const fileInfo = await Deno.stat(filePath);
  assert(fileInfo.isFile);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - getEntry retrieves entry from file", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create a question
  const createResult = await manager.createQuestion({
    content: "Test question for retrieval",
    tags: ["test"]
  });
  assertEquals(createResult.success, true);
  const questionId = createResult.data!.id;
  
  // Retrieve the entry
  const retrieved = await manager.getEntry(questionId);
  assertExists(retrieved);
  assertEquals(retrieved!.id, questionId);
  assertEquals(retrieved!.content, "Test question for retrieval");
  assertEquals(retrieved!.tags, ["test"]);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - updateEntry modifies file content", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create a note
  const createResult = await manager.createNote({
    content: "Original content",
    category: "test"
  });
  assertEquals(createResult.success, true);
  const noteId = createResult.data!.id;
  
  // Update the note
  const updateResult = await manager.updateEntry(noteId, {
    content: "Updated content",
    tags: ["updated"],
    category: "modified"
  });
  
  assertEquals(updateResult.success, true);
  assertEquals(updateResult.data!.content, "Updated content");
  assertEquals(updateResult.data!.tags, ["updated"]);
  
  // Verify persistence by retrieving again
  const retrieved = await manager.getEntry(noteId);
  assertExists(retrieved);
  assertEquals(retrieved!.content, "Updated content");
  assertEquals(retrieved!.tags, ["updated"]);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - deleteEntry removes file", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create a note
  const createResult = await manager.createNote({
    content: "Note to be deleted",
    category: "test"
  });
  assertEquals(createResult.success, true);
  const noteId = createResult.data!.id;
  
  // Verify file exists
  const filePath = join('.knowledge', 'open', `${noteId}.md`);
  let fileInfo = await Deno.stat(filePath);
  assert(fileInfo.isFile);
  
  // Delete the entry
  const deleteResult = await manager.deleteEntry(noteId);
  assertEquals(deleteResult.success, true);
  
  // Verify file is gone
  try {
    await Deno.stat(filePath);
    assert(false, "File should have been deleted");
  } catch (error) {
    assert(error instanceof Deno.errors.NotFound);
  }
  
  // Verify entry can't be retrieved
  const retrieved = await manager.getEntry(noteId);
  assertEquals(retrieved, undefined);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - searchEntries filters by type and tags", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create test entries
  await manager.createQuestion({
    content: "Question 1",
    tags: ["tag1", "common"]
  });
  
  await manager.createNote({
    content: "Note 1",
    category: "test",
    tags: ["tag2", "common"]
  });
  
  await manager.createNote({
    content: "Note 2",
    category: "other",
    tags: ["tag1"]
  });
  
  // Search by type
  const questions = await manager.searchEntries({ type: KnowledgeType.QUESTION });
  assertEquals(questions.length, 1);
  assertEquals(questions[0].type, KnowledgeType.QUESTION);
  
  // Search by tags
  const commonTagged = await manager.searchEntries({ tags: ["common"] });
  assertEquals(commonTagged.length, 2);
  
  // Search with text
  const searchText = await manager.searchEntries({ search: "Note 2" });
  assertEquals(searchText.length, 1);
  assertEquals(searchText[0].content, "Note 2");
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - getStatistics returns correct counts", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Create test entries
  const questionResult = await manager.createQuestion({
    content: "Test question",
    tags: ["test", "stats"]
  });
  
  await manager.createAnswer({
    content: "Test answer",
    questionId: questionResult.data!.id,
    tags: ["test"]
  });
  
  await manager.createNote({
    content: "Test note",
    category: "observation",
    tags: ["stats"]
  });
  
  const stats = await manager.getStatistics();
  
  assertEquals(stats.totalEntries, 3);
  assertEquals(stats.byType.questions, 1);
  assertEquals(stats.byType.answers, 1);
  assertEquals(stats.byType.notes, 1);
  assertEquals(stats.byType.issues, 0);
  assertEquals(stats.byStatus.answeredQuestions, 1);
  assertEquals(stats.byStatus.unansweredQuestions, 0);
  assertEquals(stats.tagFrequency["test"], 2);
  assertEquals(stats.tagFrequency["stats"], 2);
  
  await cleanupTestFiles();
});

Deno.test("FileKnowledgeManager - validates request inputs", async () => {
  await cleanupTestFiles();
  const manager = new FileKnowledgeManager();
  
  // Test invalid question (empty content)
  const invalidQuestion = await manager.createQuestion({
    content: "",
    tags: ["test"]
  });
  assertEquals(invalidQuestion.success, false);
  assertExists(invalidQuestion.error);
  
  // Test invalid answer (missing questionId)
  const invalidAnswer = await manager.createAnswer({
    content: "Answer content",
    questionId: "",
    tags: ["test"]
  });
  assertEquals(invalidAnswer.success, false);
  assertExists(invalidAnswer.error);
  
  // Test invalid tag format
  const invalidTag = await manager.createNote({
    content: "Note content",
    tags: ["invalid tag with spaces"],
    category: "test"
  });
  assertEquals(invalidTag.success, false);
  assertExists(invalidTag.error);
  assert(invalidTag.error!.includes("Invalid tag format"));
  
  await cleanupTestFiles();
});