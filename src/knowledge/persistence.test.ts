import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { KnowledgePersistence } from "./persistence.ts";
import { KnowledgeRegistry } from "./registry.ts";
import {
  KnowledgeType,
  Question,
  Answer,
  Note
} from "./types.ts";

// Test helpers
function createTestQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q_test_001",
    type: KnowledgeType.QUESTION,
    content: "Test question",
    timestamp: new Date("2024-01-01T00:00:00Z"),
    lastUpdated: new Date("2024-01-01T00:00:00Z"),
    tags: ["test"],
    answered: false,
    answerIds: [],
    priority: "medium",
    metadata: {},
    ...overrides
  };
}

function createTestAnswer(questionId: string, overrides: Partial<Answer> = {}): Answer {
  return {
    id: "a_test_001",
    type: KnowledgeType.ANSWER,
    content: "Test answer",
    timestamp: new Date("2024-01-01T01:00:00Z"),
    lastUpdated: new Date("2024-01-01T01:00:00Z"),
    tags: ["test"],
    questionId,
    accepted: false,
    votes: 0,
    metadata: {},
    ...overrides
  };
}

function createTestNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "n_test_001",
    type: KnowledgeType.NOTE,
    content: "Test note",
    timestamp: new Date("2024-01-01T02:00:00Z"),
    lastUpdated: new Date("2024-01-01T02:00:00Z"),
    tags: ["test"],
    category: "observation",
    metadata: {},
    ...overrides
  };
}

// Clean up test directory after each test
async function cleanupTestDir(dir: string) {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch (error) {
    // Directory might not exist
  }
}

Deno.test("KnowledgePersistence - initialize creates directory", async () => {
  const testDir = ".test_knowledge_1";
  const persistence = new KnowledgePersistence(testDir);
  
  try {
    await persistence.initialize();
    
    const stat = await Deno.stat(testDir);
    assertEquals(stat.isDirectory, true);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - save and load roundtrip", async () => {
  const testDir = ".test_knowledge_2";
  const persistence = new KnowledgePersistence(testDir);
  
  try {
    const question = createTestQuestion();
    const answer = createTestAnswer(question.id);
    const note = createTestNote();
    
    const entries = [question, answer, note];
    
    // Save entries
    await persistence.save(entries);
    
    // Load entries
    const loaded = await persistence.load();
    
    assertEquals(loaded.length, 3);
    
    // Check question
    const loadedQuestion = loaded.find(e => e.id === question.id) as Question;
    assertExists(loadedQuestion);
    assertEquals(loadedQuestion.type, KnowledgeType.QUESTION);
    assertEquals(loadedQuestion.content, question.content);
    assertEquals(loadedQuestion.tags, question.tags);
    assertEquals(loadedQuestion.answered, question.answered);
    
    // Check answer
    const loadedAnswer = loaded.find(e => e.id === answer.id) as Answer;
    assertExists(loadedAnswer);
    assertEquals(loadedAnswer.type, KnowledgeType.ANSWER);
    assertEquals(loadedAnswer.questionId, answer.questionId);
    
    // Check note
    const loadedNote = loaded.find(e => e.id === note.id) as Note;
    assertExists(loadedNote);
    assertEquals(loadedNote.type, KnowledgeType.NOTE);
    assertEquals(loadedNote.category, note.category);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - creates backup on save", async () => {
  const testDir = ".test_knowledge_3";
  const persistence = new KnowledgePersistence(testDir);
  
  try {
    const entries1 = [createTestQuestion({ content: "First version" })];
    const entries2 = [createTestQuestion({ content: "Second version" })];
    
    // First save
    await persistence.save(entries1);
    
    // Second save (should create backup)
    await persistence.save(entries2);
    
    // Check backup exists
    const backupFile = `${testDir}/knowledge.backup.json`;
    const stat = await Deno.stat(backupFile);
    assertEquals(stat.isFile, true);
    
    // Load backup and verify it has first version
    const backupData = JSON.parse(await Deno.readTextFile(backupFile));
    assertEquals(backupData.entries[0].content, "First version");
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - loadIntoRegistry restores all data", async () => {
  const testDir = ".test_knowledge_4";
  const persistence = new KnowledgePersistence(testDir);
  const registry = new KnowledgeRegistry();
  
  try {
    const question = createTestQuestion();
    const answer = createTestAnswer(question.id);
    const note = createTestNote();
    
    // Save entries
    await persistence.save([question, answer, note]);
    
    // Load into registry
    await persistence.loadIntoRegistry(registry);
    
    assertEquals(registry.getEntryCount(), 3);
    
    // Check question-answer link is restored
    const answers = registry.getAnswersForQuestion(question.id);
    assertEquals(answers.length, 1);
    assertEquals(answers[0].id, answer.id);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - saveFromRegistry persists all entries", async () => {
  const testDir = ".test_knowledge_5";
  const persistence = new KnowledgePersistence(testDir);
  const registry = new KnowledgeRegistry();
  
  try {
    // Add entries to registry
    const question = createTestQuestion();
    const answer = createTestAnswer(question.id);
    const note = createTestNote();
    
    registry.addEntry(question);
    registry.addEntry(answer);
    registry.addEntry(note);
    registry.linkAnswerToQuestion(answer.id, question.id);
    
    // Save from registry
    await persistence.saveFromRegistry(registry);
    
    // Load and verify
    const loaded = await persistence.load();
    assertEquals(loaded.length, 3);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - handles empty/missing data file", async () => {
  const testDir = ".test_knowledge_6";
  const persistence = new KnowledgePersistence(testDir);
  
  try {
    // Load from non-existent file
    const loaded = await persistence.load();
    assertEquals(loaded, []);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - atomic writes prevent corruption", async () => {
  const testDir = ".test_knowledge_7";
  const persistence = new KnowledgePersistence(testDir);
  
  try {
    const entries = [createTestQuestion()];
    
    // Save initial data
    await persistence.save(entries);
    
    // Check temp file doesn't exist
    const tempFile = `${testDir}/knowledge.json.tmp`;
    let tempExists = true;
    try {
      await Deno.stat(tempFile);
    } catch {
      tempExists = false;
    }
    assertEquals(tempExists, false);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - export and import files", async () => {
  const testDir = ".test_knowledge_8";
  const persistence = new KnowledgePersistence(testDir);
  const exportFile = `${testDir}/export.json`;
  
  try {
    await persistence.initialize();
    
    const entries = [
      createTestQuestion(),
      createTestAnswer("q_test_001"),
      createTestNote()
    ];
    
    // Export entries
    await persistence.exportToFile(exportFile, entries);
    
    // Import entries
    const imported = await persistence.importFromFile(exportFile);
    
    assertEquals(imported.length, 3);
    assertEquals(imported[0].type, KnowledgeType.QUESTION);
    assertEquals(imported[1].type, KnowledgeType.ANSWER);
    assertEquals(imported[2].type, KnowledgeType.NOTE);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - getStorageStats returns file info", async () => {
  const testDir = ".test_knowledge_9";
  const persistence = new KnowledgePersistence(testDir);
  
  try {
    // Before any saves
    let stats = await persistence.getStorageStats();
    assertEquals(stats.dataFileSize, undefined);
    
    // After save
    await persistence.save([createTestQuestion()]);
    
    stats = await persistence.getStorageStats();
    assertExists(stats.dataFileSize);
    assertExists(stats.lastModified);
    assertEquals(stats.dataFileSize! > 0, true);
  } finally {
    await cleanupTestDir(testDir);
  }
});

Deno.test("KnowledgePersistence - handles concurrent access with locks", async () => {
  const testDir = ".test_knowledge_10";
  const persistence1 = new KnowledgePersistence(testDir);
  const persistence2 = new KnowledgePersistence(testDir);
  
  try {
    const question1 = createTestQuestion({ id: "q1", content: "From instance 1" });
    const question2 = createTestQuestion({ id: "q2", content: "From instance 2" });
    
    // Save concurrently - locks should ensure no corruption
    await Promise.all([
      persistence1.save([question1]),
      persistence2.save([question2])
    ]);
    
    // Load and check - one of them should have won
    const loaded = await persistence1.load();
    assertEquals(loaded.length, 1);
    assertEquals(
      loaded[0].content === "From instance 1" || loaded[0].content === "From instance 2",
      true
    );
  } finally {
    await cleanupTestDir(testDir);
  }
});