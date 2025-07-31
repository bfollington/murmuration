/**
 * Knowledge Management Module
 * 
 * Provides comprehensive knowledge base functionality including:
 * - Questions, Answers, and Notes
 * - Persistence with file-based storage
 * - Advanced statistics and analytics
 * - Event-driven updates
 * - Search and filtering capabilities
 * 
 * @module knowledge
 */

// Core types
export * from './types.ts';

// Data layer
export { KnowledgeRegistry, knowledgeRegistry } from './registry.ts';

// Business logic
export { KnowledgeManager, knowledgeManager } from './manager.ts';

// Persistence
export { KnowledgePersistence, knowledgePersistence } from './persistence.ts';

// Analytics
export { KnowledgeStatistics, AdvancedKnowledgeStats } from './statistics.ts';

// Re-export commonly used types for convenience
export type {
  Question,
  Answer,
  Note,
  KnowledgeEntry,
  KnowledgeQuery,
  KnowledgeStats,
  CreateQuestionRequest,
  CreateAnswerRequest,
  CreateNoteRequest,
  UpdateKnowledgeRequest,
  KnowledgeResult,
  KnowledgeEvents
} from './types.ts';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { knowledgeManager } from './knowledge/mod.ts';
 * 
 * // Initialize and load existing knowledge
 * await knowledgeManager.load();
 * 
 * // Enable auto-save
 * knowledgeManager.setAutoSave(true);
 * 
 * // Create a question
 * const result = await knowledgeManager.createQuestion({
 *   content: "How do I implement authentication?",
 *   tags: ["auth", "security"],
 *   priority: "high"
 * });
 * 
 * // Search for entries
 * const entries = knowledgeManager.searchEntries({
 *   type: KnowledgeType.QUESTION,
 *   tags: ["auth"],
 *   answered: false
 * });
 * 
 * // Get statistics
 * const stats = knowledgeManager.getStatistics();
 * ```
 */