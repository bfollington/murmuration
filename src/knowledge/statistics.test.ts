import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { KnowledgeStatistics } from "./statistics.ts";
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
    id: KnowledgeRegistry.generateEntryId(),
    type: KnowledgeType.QUESTION,
    content: "Test question",
    timestamp: new Date(),
    lastUpdated: new Date(),
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
    id: KnowledgeRegistry.generateEntryId(),
    type: KnowledgeType.ANSWER,
    content: "Test answer",
    timestamp: new Date(),
    lastUpdated: new Date(),
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
    id: KnowledgeRegistry.generateEntryId(),
    type: KnowledgeType.NOTE,
    content: "Test note",
    timestamp: new Date(),
    lastUpdated: new Date(),
    tags: ["test"],
    category: "observation",
    metadata: {},
    ...overrides
  };
}

Deno.test("KnowledgeStatistics - calculateAverages computes correct metrics", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  // Create test data
  const now = new Date();
  const question1 = createTestQuestion({
    timestamp: new Date(now.getTime() - 3600000), // 1 hour ago
    tags: ["tag1", "tag2"],
    answered: true,
    answerIds: []
  });
  const question2 = createTestQuestion({
    tags: ["tag1"],
    answered: false
  });
  
  registry.addEntry(question1);
  registry.addEntry(question2);
  
  const answer1 = createTestAnswer(question1.id, {
    timestamp: now, // Answered after 1 hour
    accepted: true,
    tags: ["tag1", "tag2", "tag3"]
  });
  const answer2 = createTestAnswer(question1.id, {
    accepted: false
  });
  
  registry.addEntry(answer1);
  registry.addEntry(answer2);
  registry.linkAnswerToQuestion(answer1.id, question1.id);
  registry.linkAnswerToQuestion(answer2.id, question1.id);
  
  const advancedStats = stats.calculateAdvancedStats();
  
  assertEquals(advancedStats.averages.answersPerQuestion, 1); // 2 answers for 2 questions
  assertEquals(advancedStats.averages.tagsPerEntry, 1.75); // 7 tags / 4 entries
  assertEquals(advancedStats.averages.timeToAnswer, 3600000); // 1 hour in ms
  assertEquals(advancedStats.averages.acceptanceRate, 50); // 1 of 2 answers accepted
});

Deno.test("KnowledgeStatistics - calculateTrends tracks activity patterns", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  
  // Add entries at different times
  registry.addEntry(createTestQuestion({
    timestamp: today,
    tags: ["popular", "trending"],
    processId: "proc_1"
  }));
  registry.addEntry(createTestQuestion({
    timestamp: today,
    tags: ["popular"],
    processId: "proc_1"
  }));
  registry.addEntry(createTestQuestion({
    timestamp: yesterday,
    tags: ["popular"],
    processId: "proc_2"
  }));
  
  const advancedStats = stats.calculateAdvancedStats();
  
  // Check daily activity
  const todayKey = today.toISOString().split('T')[0];
  const yesterdayKey = yesterday.toISOString().split('T')[0];
  assertEquals(advancedStats.trends.dailyActivity[todayKey], 2);
  assertEquals(advancedStats.trends.dailyActivity[yesterdayKey], 1);
  
  // Check hourly activity
  const currentHour = today.getHours();
  const yesterdayHour = yesterday.getHours();
  
  // If both timestamps have the same hour, we'll have 3 entries for that hour
  // Otherwise, we'll have 2 for today's hour and 1 for yesterday's hour
  if (currentHour === yesterdayHour) {
    assertEquals(advancedStats.trends.hourlyActivity[currentHour], 3);
  } else {
    assertEquals(advancedStats.trends.hourlyActivity[currentHour], 2);
    assertEquals(advancedStats.trends.hourlyActivity[yesterdayHour], 1);
  }
  
  // Check top contributors
  assertEquals(advancedStats.trends.topContributors.length, 2);
  assertEquals(advancedStats.trends.topContributors[0].processId, "proc_1");
  assertEquals(advancedStats.trends.topContributors[0].count, 2);
  
  // Check popular tags
  const popularTag = advancedStats.trends.popularTags.find(t => t.tag === "popular");
  assertExists(popularTag);
  assertEquals(popularTag.count, 3);
});

Deno.test("KnowledgeStatistics - calculateQualityMetrics identifies issues", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 86400000);
  
  // Add high priority unanswered question
  registry.addEntry(createTestQuestion({
    priority: "high",
    answered: false
  }));
  
  // Add stale question
  registry.addEntry(createTestQuestion({
    timestamp: tenDaysAgo,
    answered: false
  }));
  
  // Add orphaned answer (question doesn't exist)
  registry.addEntry(createTestAnswer("non_existent_question"));
  
  // Add entries with duplicate tags
  registry.addEntry(createTestNote({ tags: ["JavaScript"] }));
  registry.addEntry(createTestNote({ tags: ["javascript"] }));
  registry.addEntry(createTestNote({ tags: ["java-script"] }));
  
  const advancedStats = stats.calculateAdvancedStats();
  
  assertEquals(advancedStats.quality.unansweredHighPriority, 1);
  assertEquals(advancedStats.quality.staleQuestions, 1);
  assertEquals(advancedStats.quality.orphanedAnswers, 1);
  assertEquals(advancedStats.quality.duplicateTags.length > 0, true);
});

Deno.test("KnowledgeStatistics - findDuplicateTags detects variations", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  // Add entries with tag variations
  registry.addEntry(createTestNote({ tags: ["Auth", "testing", "api-key"] }));
  registry.addEntry(createTestNote({ tags: ["auth", "Testing", "api_key"] }));
  registry.addEntry(createTestNote({ tags: ["tests", "apikey"] }));
  
  const advancedStats = stats.calculateAdvancedStats();
  const duplicates = advancedStats.quality.duplicateTags;
  
  // Should detect case variations and hyphen/underscore variations
  assertEquals(duplicates.length >= 2, true);
  
  // Check specific duplicates
  const authDuplicate = duplicates.find(d => 
    d.tag.toLowerCase() === "auth" || d.variations.some(v => v.toLowerCase() === "auth")
  );
  assertExists(authDuplicate);
});

Deno.test("KnowledgeStatistics - calculateHealthScore reflects knowledge base quality", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  // Perfect knowledge base
  const question = createTestQuestion({
    tags: ["tag1", "tag2"],
    answered: true,
    priority: "low"
  });
  registry.addEntry(question);
  
  const answer = createTestAnswer(question.id, {
    accepted: true,
    timestamp: new Date(question.timestamp.getTime() + 3600000) // 1 hour later
  });
  registry.addEntry(answer);
  registry.linkAnswerToQuestion(answer.id, question.id);
  
  let healthScore = stats.calculateHealthScore();
  assertEquals(healthScore >= 90, true); // Should be high
  
  // Add problems
  registry.addEntry(createTestQuestion({
    priority: "high",
    answered: false,
    timestamp: new Date(Date.now() - 10 * 86400000) // 10 days old
  }));
  
  healthScore = stats.calculateHealthScore();
  assertEquals(healthScore < 90, true); // Should be lower
});

Deno.test("KnowledgeStatistics - recordSearch tracks search terms", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  // Record searches
  stats.recordSearch("authentication");
  stats.recordSearch("authentication");
  stats.recordSearch("database");
  stats.recordSearch("authentication");
  
  const advancedStats = stats.calculateAdvancedStats();
  const searchTerms = advancedStats.search.commonSearchTerms;
  
  assertEquals(searchTerms.length, 2);
  assertEquals(searchTerms[0].term, "authentication");
  assertEquals(searchTerms[0].frequency, 3);
  assertEquals(searchTerms[1].term, "database");
  assertEquals(searchTerms[1].frequency, 1);
});

Deno.test("KnowledgeStatistics - relatedEntries finds entries with shared tags", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  const entry1 = createTestQuestion({ 
    id: "q1",
    tags: ["auth", "security", "jwt"] 
  });
  const entry2 = createTestQuestion({ 
    id: "q2",
    tags: ["auth", "security", "oauth"] 
  });
  const entry3 = createTestQuestion({ 
    id: "q3",
    tags: ["database", "sql"] 
  });
  
  registry.addEntry(entry1);
  registry.addEntry(entry2);
  registry.addEntry(entry3);
  
  const advancedStats = stats.calculateAdvancedStats();
  const related = advancedStats.search.relatedEntries;
  
  // entry1 and entry2 share 2 tags, so they should be related
  assertEquals(related.has("q1"), true);
  assertEquals(related.get("q1")?.includes("q2"), true);
  assertEquals(related.has("q2"), true);
  assertEquals(related.get("q2")?.includes("q1"), true);
  
  // entry3 shares no tags with others
  assertEquals(related.has("q3"), false);
});

Deno.test("KnowledgeStatistics - generateSummaryReport creates readable report", () => {
  const registry = new KnowledgeRegistry();
  const stats = new KnowledgeStatistics(registry);
  
  // Add some test data
  registry.addEntry(createTestQuestion({ 
    tags: ["popular"],
    answered: true,
    processId: "proc_1"
  }));
  registry.addEntry(createTestAnswer("q1", { 
    accepted: true,
    processId: "proc_1"
  }));
  registry.addEntry(createTestNote({ 
    tags: ["popular", "note"] 
  }));
  
  const report = stats.generateSummaryReport();
  
  assertEquals(report.includes("# Knowledge Base Summary Report"), true);
  assertEquals(report.includes("Total Entries: 3"), true);
  assertEquals(report.includes("Health Score:"), true);
  assertEquals(report.includes("## Top Tags"), true);
  assertEquals(report.includes("## Top Contributors"), true);
});