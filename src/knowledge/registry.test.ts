import { assertEquals, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { KnowledgeRegistry } from "./registry.ts";
import { 
  KnowledgeType, 
  Question, 
  Answer, 
  Note,
  KnowledgeQuery
} from "./types.ts";

// Test helper to create sample entries
function createTestQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: KnowledgeRegistry.generateEntryId(),
    type: KnowledgeType.QUESTION,
    content: "How do I implement authentication?",
    timestamp: new Date(),
    lastUpdated: new Date(),
    tags: ["authentication", "security"],
    answered: false,
    answerIds: [],
    priority: "medium",
    metadata: {},
    ...overrides
  };
}

function createTestAnswer(questionId: string, overrides: Partial<Answer> = {}): Answer {
  return {
    id: KnowledgeRegistry.generateEntryId(),
    type: KnowledgeType.ANSWER,
    content: "You can implement authentication using JWT tokens...",
    timestamp: new Date(),
    lastUpdated: new Date(),
    tags: ["authentication"],
    questionId,
    accepted: false,
    votes: 0,
    metadata: {},
    ...overrides
  };
}

function createTestNote(overrides: Partial<Note> = {}): Note {
  return {
    id: KnowledgeRegistry.generateEntryId(),
    type: KnowledgeType.NOTE,
    content: "Remember to update the documentation",
    timestamp: new Date(),
    lastUpdated: new Date(),
    tags: ["documentation"],
    category: "todo",
    metadata: {},
    ...overrides
  };
}

Deno.test("KnowledgeRegistry - addEntry should store entry correctly", () => {
  const registry = new KnowledgeRegistry();
  const question = createTestQuestion();
  
  registry.addEntry(question);
  
  assertEquals(registry.getEntryCount(), 1);
  assertEquals(registry.getEntry(question.id), question);
});

Deno.test("KnowledgeRegistry - addEntry should throw on duplicate ID", () => {
  const registry = new KnowledgeRegistry();
  const question = createTestQuestion();
  
  registry.addEntry(question);
  
  assertThrows(
    () => registry.addEntry(question),
    Error,
    "already exists"
  );
});

Deno.test("KnowledgeRegistry - getEntry returns deep copy", () => {
  const registry = new KnowledgeRegistry();
  const question = createTestQuestion();
  
  registry.addEntry(question);
  const retrieved = registry.getEntry(question.id) as Question;
  
  // Modify retrieved copy
  retrieved.content = "Modified content";
  retrieved.tags.push("new-tag");
  
  // Original should be unchanged
  const original = registry.getEntry(question.id) as Question;
  assertEquals(original.content, question.content);
  assertEquals(original.tags.length, question.tags.length);
});

Deno.test("KnowledgeRegistry - updateEntry preserves ID and type", () => {
  const registry = new KnowledgeRegistry();
  const question = createTestQuestion();
  registry.addEntry(question);
  
  const updated = registry.updateEntry(question.id, {
    content: "Updated question",
    tags: ["new-tag"],
    // Attempt to change ID and type (should be ignored)
    id: "different-id",
    type: KnowledgeType.NOTE as any
  });
  
  const retrieved = registry.getEntry(question.id) as Question;
  
  assertEquals(updated, true);
  assertEquals(retrieved?.id, question.id);
  assertEquals(retrieved?.type, KnowledgeType.QUESTION);
  assertEquals(retrieved?.content, "Updated question");
  assertEquals(retrieved?.tags, ["new-tag"]);
});

Deno.test("KnowledgeRegistry - removeEntry removes entry and clears indices", () => {
  const registry = new KnowledgeRegistry();
  const question = createTestQuestion();
  registry.addEntry(question);
  
  assertEquals(registry.getEntryCount(), 1);
  assertEquals(registry.getEntriesByTag("authentication").length, 1);
  
  const removed = registry.removeEntry(question.id);
  
  assertEquals(removed, true);
  assertEquals(registry.getEntryCount(), 0);
  assertEquals(registry.getEntriesByTag("authentication").length, 0);
});

Deno.test("KnowledgeRegistry - getEntriesByType filters correctly", () => {
  const registry = new KnowledgeRegistry();
  const question = createTestQuestion();
  const answer = createTestAnswer(question.id);
  const note = createTestNote();
  
  registry.addEntry(question);
  registry.addEntry(answer);
  registry.addEntry(note);
  
  assertEquals(registry.getEntriesByType(KnowledgeType.QUESTION).length, 1);
  assertEquals(registry.getEntriesByType(KnowledgeType.ANSWER).length, 1);
  assertEquals(registry.getEntriesByType(KnowledgeType.NOTE).length, 1);
});

Deno.test("KnowledgeRegistry - getEntriesByTag returns correct entries", () => {
  const registry = new KnowledgeRegistry();
  const question1 = createTestQuestion({ tags: ["auth", "security"] });
  const question2 = createTestQuestion({ tags: ["auth", "oauth"] });
  const note = createTestNote({ tags: ["documentation"] });
  
  registry.addEntry(question1);
  registry.addEntry(question2);
  registry.addEntry(note);
  
  const authEntries = registry.getEntriesByTag("auth");
  assertEquals(authEntries.length, 2);
  
  const securityEntries = registry.getEntriesByTag("security");
  assertEquals(securityEntries.length, 1);
  
  const docEntries = registry.getEntriesByTag("documentation");
  assertEquals(docEntries.length, 1);
});

Deno.test("KnowledgeRegistry - getEntriesByProcessId filters correctly", () => {
  const registry = new KnowledgeRegistry();
  const processId = "proc_123";
  
  const question = createTestQuestion({ processId });
  const answer = createTestAnswer(question.id, { processId });
  const note = createTestNote({ processId: "proc_456" });
  
  registry.addEntry(question);
  registry.addEntry(answer);
  registry.addEntry(note);
  
  const processEntries = registry.getEntriesByProcessId(processId);
  assertEquals(processEntries.length, 2);
});

Deno.test("KnowledgeRegistry - linkAnswerToQuestion updates both entries", () => {
  const registry = new KnowledgeRegistry();
  const question = createTestQuestion();
  const answer = createTestAnswer("temp_id");
  
  registry.addEntry(question);
  registry.addEntry(answer);
  
  const linked = registry.linkAnswerToQuestion(answer.id, question.id);
  
  assertEquals(linked, true);
  
  const updatedAnswer = registry.getEntry(answer.id) as Answer;
  assertEquals(updatedAnswer.questionId, question.id);
  
  const updatedQuestion = registry.getEntry(question.id) as Question;
  assertEquals(updatedQuestion.answerIds.includes(answer.id), true);
  
  const answers = registry.getAnswersForQuestion(question.id);
  assertEquals(answers.length, 1);
  assertEquals(answers[0].id, answer.id);
});

Deno.test("KnowledgeRegistry - searchEntries with text search", () => {
  const registry = new KnowledgeRegistry();
  
  registry.addEntry(createTestQuestion({ 
    content: "How to implement OAuth authentication?" 
  }));
  registry.addEntry(createTestQuestion({ 
    content: "What is the best database for my app?" 
  }));
  registry.addEntry(createTestNote({ 
    content: "OAuth implementation completed" 
  }));
  
  const query: KnowledgeQuery = { search: "oauth" };
  const results = registry.searchEntries(query);
  
  assertEquals(results.length, 2);
  results.forEach(entry => {
    assertEquals(entry.content.toLowerCase().includes("oauth"), true);
  });
});

Deno.test("KnowledgeRegistry - searchEntries with multiple filters", () => {
  const registry = new KnowledgeRegistry();
  const processId = "proc_123";
  
  registry.addEntry(createTestQuestion({ 
    tags: ["auth", "security"],
    processId,
    answered: true
  }));
  registry.addEntry(createTestQuestion({ 
    tags: ["auth"],
    processId,
    answered: false
  }));
  registry.addEntry(createTestQuestion({ 
    tags: ["database"],
    answered: false
  }));
  
  const query: KnowledgeQuery = {
    type: KnowledgeType.QUESTION,
    tags: ["auth"],
    processId,
    answered: false
  };
  
  const results = registry.searchEntries(query);
  assertEquals(results.length, 1);
});

Deno.test("KnowledgeRegistry - searchEntries with sorting", () => {
  const registry = new KnowledgeRegistry();
  const now = new Date();
  
  const question1 = createTestQuestion({ 
    timestamp: new Date(now.getTime() - 3600000) // 1 hour ago
  });
  const question2 = createTestQuestion({ 
    timestamp: new Date(now.getTime() - 7200000) // 2 hours ago
  });
  const question3 = createTestQuestion({ 
    timestamp: now
  });
  
  registry.addEntry(question2);
  registry.addEntry(question1);
  registry.addEntry(question3);
  
  const query: KnowledgeQuery = {
    sortBy: "timestamp",
    sortOrder: "desc"
  };
  
  const results = registry.searchEntries(query);
  assertEquals(results.length, 3);
  assertEquals(results[0].id, question3.id);
  assertEquals(results[1].id, question1.id);
  assertEquals(results[2].id, question2.id);
});

Deno.test("KnowledgeRegistry - searchEntries with pagination", () => {
  const registry = new KnowledgeRegistry();
  
  // Add 10 questions
  for (let i = 0; i < 10; i++) {
    registry.addEntry(createTestQuestion({ 
      content: `Question ${i}` 
    }));
  }
  
  const query: KnowledgeQuery = {
    limit: 3,
    offset: 2,
    sortBy: "timestamp",
    sortOrder: "asc"
  };
  
  const results = registry.searchEntries(query);
  assertEquals(results.length, 3);
});

Deno.test("KnowledgeRegistry - getStatistics calculates correctly", () => {
  const registry = new KnowledgeRegistry();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);
  const lastWeek = new Date(now.getTime() - 7 * 86400000);
  const lastMonth = new Date(now.getTime() - 30 * 86400000);
  const processId = "proc_123";
  
  // Add various entries
  const question1 = createTestQuestion({ 
    timestamp: now,
    answered: true,
    tags: ["auth"],
    processId
  });
  const question2 = createTestQuestion({ 
    timestamp: yesterday,
    answered: false,
    tags: ["auth", "security"]
  });
  const answer = createTestAnswer(question1.id, { 
    timestamp: lastWeek,
    accepted: true,
    processId
  });
  const note = createTestNote({ 
    timestamp: lastMonth,
    tags: ["auth"]
  });
  
  registry.addEntry(question1);
  registry.addEntry(question2);
  registry.addEntry(answer);
  registry.addEntry(note);
  registry.linkAnswerToQuestion(answer.id, question1.id);
  
  const stats = registry.getStatistics();
  
  assertEquals(stats.totalEntries, 4);
  assertEquals(stats.byType.questions, 2);
  assertEquals(stats.byType.answers, 1);
  assertEquals(stats.byType.notes, 1);
  assertEquals(stats.byStatus.answeredQuestions, 1);
  assertEquals(stats.byStatus.unansweredQuestions, 1);
  assertEquals(stats.byStatus.acceptedAnswers, 1);
  assertEquals(stats.tagFrequency["auth"], 3);
  assertEquals(stats.tagFrequency["security"], 1);
  assertEquals(stats.processCorrelation[processId], 2);
  assertEquals(stats.timeGrouping.today, 1);
  // Check that all 4 entries are accounted for in time grouping
  const totalTimeGrouped = stats.timeGrouping.today + 
                          stats.timeGrouping.thisWeek + 
                          stats.timeGrouping.thisMonth + 
                          stats.timeGrouping.older;
  assertEquals(totalTimeGrouped, 4);
});

Deno.test("KnowledgeRegistry - clear removes all data", () => {
  const registry = new KnowledgeRegistry();
  
  registry.addEntry(createTestQuestion());
  registry.addEntry(createTestNote());
  
  assertEquals(registry.getEntryCount(), 2);
  
  registry.clear();
  
  assertEquals(registry.getEntryCount(), 0);
  assertEquals(registry.getAllEntries().length, 0);
});

Deno.test("KnowledgeRegistry - generateEntryId creates unique IDs", () => {
  const ids = new Set<string>();
  
  for (let i = 0; i < 100; i++) {
    const id = KnowledgeRegistry.generateEntryId();
    assertEquals(id.startsWith("ke_"), true);
    assertEquals(ids.has(id), false);
    ids.add(id);
  }
});