import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { KnowledgeManager } from "./manager.ts";
import { KnowledgeRegistry } from "./registry.ts";
import {
  KnowledgeType,
  CreateQuestionRequest,
  CreateAnswerRequest,
  CreateNoteRequest,
  Question,
  Answer,
  isQuestion,
  isAnswer
} from "./types.ts";

Deno.test("KnowledgeManager - createQuestion validates and creates question", async () => {
  const manager = new KnowledgeManager();
  
  const request: CreateQuestionRequest = {
    content: "How do I implement authentication?",
    tags: ["auth", "security"],
    priority: "high"
  };
  
  const result = await manager.createQuestion(request);
  
  assertEquals(result.success, true);
  assertExists(result.data);
  assertEquals(result.data!.type, KnowledgeType.QUESTION);
  assertEquals(result.data!.content, request.content);
  assertEquals(result.data!.tags, request.tags);
  assertEquals((result.data as Question).priority, "high");
  assertEquals((result.data as Question).answered, false);
});

Deno.test("KnowledgeManager - createQuestion rejects invalid request", async () => {
  const manager = new KnowledgeManager();
  
  const result = await manager.createQuestion({ content: "" } as any);
  
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("Invalid question request"), true);
});

Deno.test("KnowledgeManager - createQuestion rejects invalid tags", async () => {
  const manager = new KnowledgeManager();
  
  const request: CreateQuestionRequest = {
    content: "Valid question",
    tags: ["valid-tag", "invalid tag with spaces"]
  };
  
  const result = await manager.createQuestion(request);
  
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("Invalid tag format"), true);
});

Deno.test("KnowledgeManager - createAnswer links to question correctly", async () => {
  const manager = new KnowledgeManager();
  
  // Create a question first
  const questionResult = await manager.createQuestion({
    content: "What is TypeScript?"
  });
  
  assertEquals(questionResult.success, true);
  const question = questionResult.data!;
  
  // Create an answer
  const answerRequest: CreateAnswerRequest = {
    content: "TypeScript is a typed superset of JavaScript",
    questionId: question.id,
    tags: ["typescript"]
  };
  
  const answerResult = await manager.createAnswer(answerRequest);
  
  assertEquals(answerResult.success, true);
  assertExists(answerResult.data);
  assertEquals((answerResult.data as Answer).questionId, question.id);
  
  // Check that question is marked as answered
  const updatedQuestion = manager.getEntry(question.id) as Question;
  assertEquals(updatedQuestion.answered, true);
  assertEquals(updatedQuestion.answerIds.includes(answerResult.data!.id), true);
});

Deno.test("KnowledgeManager - createAnswer fails for non-existent question", async () => {
  const manager = new KnowledgeManager();
  
  const result = await manager.createAnswer({
    content: "Answer to nothing",
    questionId: "non-existent-id"
  });
  
  assertEquals(result.success, false);
  assertEquals(result.error?.includes("Question with ID"), true);
});

Deno.test("KnowledgeManager - createNote validates related IDs", async () => {
  const manager = new KnowledgeManager();
  
  // Create a question to reference
  const questionResult = await manager.createQuestion({
    content: "Reference question"
  });
  const questionId = questionResult.data!.id;
  
  // Try to create note with invalid related ID
  const invalidResult = await manager.createNote({
    content: "Note with invalid reference",
    relatedIds: [questionId, "non-existent-id"]
  });
  
  assertEquals(invalidResult.success, false);
  assertEquals(invalidResult.error?.includes("Related entry with ID"), true);
  
  // Create note with valid related ID
  const validResult = await manager.createNote({
    content: "Note with valid reference",
    relatedIds: [questionId],
    category: "observation"
  });
  
  assertEquals(validResult.success, true);
});

Deno.test("KnowledgeManager - updateEntry preserves type-specific fields", async () => {
  const manager = new KnowledgeManager();
  
  // Create and update a question
  const questionResult = await manager.createQuestion({
    content: "Original question",
    priority: "low"
  });
  const questionId = questionResult.data!.id;
  
  const updateResult = await manager.updateEntry(questionId, {
    content: "Updated question",
    answered: true
  });
  
  assertEquals(updateResult.success, true);
  const updated = updateResult.data as Question;
  assertEquals(updated.content, "Updated question");
  assertEquals(updated.answered, true);
  assertEquals(updated.priority, "low"); // Preserved
});

Deno.test("KnowledgeManager - acceptAnswer marks only one answer as accepted", async () => {
  const manager = new KnowledgeManager();
  
  // Create a question
  const questionResult = await manager.createQuestion({
    content: "Which answer is best?"
  });
  const questionId = questionResult.data!.id;
  
  // Create two answers
  const answer1Result = await manager.createAnswer({
    content: "First answer",
    questionId
  });
  const answer2Result = await manager.createAnswer({
    content: "Second answer",
    questionId
  });
  
  const answer1Id = answer1Result.data!.id;
  const answer2Id = answer2Result.data!.id;
  
  // Accept first answer
  await manager.acceptAnswer(answer1Id);
  
  let answer1 = manager.getEntry(answer1Id) as Answer;
  let answer2 = manager.getEntry(answer2Id) as Answer;
  
  assertEquals(answer1.accepted, true);
  assertEquals(answer2.accepted, false);
  
  // Accept second answer (should unaccept first)
  await manager.acceptAnswer(answer2Id);
  
  answer1 = manager.getEntry(answer1Id) as Answer;
  answer2 = manager.getEntry(answer2Id) as Answer;
  
  assertEquals(answer1.accepted, false);
  assertEquals(answer2.accepted, true);
});

Deno.test("KnowledgeManager - deleteEntry handles question with answers", async () => {
  const manager = new KnowledgeManager();
  
  // Create question and answer
  const questionResult = await manager.createQuestion({
    content: "Question with answer"
  });
  const questionId = questionResult.data!.id;
  
  await manager.createAnswer({
    content: "An answer",
    questionId
  });
  
  // Try to delete question (should fail)
  const deleteResult = await manager.deleteEntry(questionId);
  
  assertEquals(deleteResult.success, false);
  assertEquals(deleteResult.error?.includes("Cannot delete question with existing answers"), true);
});

Deno.test("KnowledgeManager - deleteAnswer updates question answered status", async () => {
  const manager = new KnowledgeManager();
  
  // Create question and answer
  const questionResult = await manager.createQuestion({
    content: "Question"
  });
  const questionId = questionResult.data!.id;
  
  const answerResult = await manager.createAnswer({
    content: "Only answer",
    questionId
  });
  const answerId = answerResult.data!.id;
  
  // Question should be answered
  let question = manager.getEntry(questionId) as Question;
  assertEquals(question.answered, true);
  
  // Delete the answer
  await manager.deleteEntry(answerId);
  
  // Question should now be unanswered
  question = manager.getEntry(questionId) as Question;
  assertEquals(question.answered, false);
});

Deno.test("KnowledgeManager - getSuggestedTags returns sorted by frequency", async () => {
  const manager = new KnowledgeManager();
  
  // Create entries with various tags
  await manager.createQuestion({ content: "Q1", tags: ["popular", "common"] });
  await manager.createQuestion({ content: "Q2", tags: ["popular", "common"] });
  await manager.createQuestion({ content: "Q3", tags: ["popular"] });
  await manager.createNote({ content: "N1", tags: ["rare"] });
  
  const suggestions = manager.getSuggestedTags();
  
  assertEquals(suggestions[0], "popular"); // Used 3 times
  assertEquals(suggestions[1], "common");  // Used 2 times
  assertEquals(suggestions[2], "rare");    // Used 1 time
});

Deno.test("KnowledgeManager - getSuggestedTags filters by partial match", async () => {
  const manager = new KnowledgeManager();
  
  await manager.createQuestion({ content: "Q1", tags: ["authentication", "auth-flow"] });
  await manager.createQuestion({ content: "Q2", tags: ["authorization", "database"] });
  
  const suggestions = manager.getSuggestedTags("auth");
  
  assertEquals(suggestions.length, 3);
  assertEquals(suggestions.includes("authentication"), true);
  assertEquals(suggestions.includes("auth-flow"), true);
  assertEquals(suggestions.includes("authorization"), true);
  assertEquals(suggestions.includes("database"), false);
});

Deno.test("KnowledgeManager - events are emitted correctly", async () => {
  const manager = new KnowledgeManager();
  const events: string[] = [];
  
  // Listen for events
  manager.on('knowledge:created', () => events.push('created'));
  manager.on('knowledge:updated', () => events.push('updated'));
  manager.on('knowledge:linked', () => events.push('linked'));
  manager.on('knowledge:accepted', () => events.push('accepted'));
  
  // Create question
  const questionResult = await manager.createQuestion({
    content: "Test question"
  });
  assertEquals(events.includes('created'), true);
  
  // Create answer (should emit created and linked)
  const answerResult = await manager.createAnswer({
    content: "Test answer",
    questionId: questionResult.data!.id
  });
  assertEquals(events.filter(e => e === 'created').length, 2);
  assertEquals(events.includes('linked'), true);
  
  // Accept answer (should emit updated and accepted)
  await manager.acceptAnswer(answerResult.data!.id);
  assertEquals(events.includes('updated'), true);
  assertEquals(events.includes('accepted'), true);
});