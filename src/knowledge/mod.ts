/**
 * Knowledge Management Module
 * 
 * Provides knowledge base functionality including:
 * - Issue tracking with file-based storage
 * - Milestone management
 * - Fragment-based semantic search and document management
 * - Cross-referencing system
 * - File I/O operations
 * 
 * @module knowledge
 */

// Core types
export * from './types.ts';

// File-based issue management
export * from './file-manager.ts';
export * as FileIO from './file-io.ts';
export * from './file-format.ts';
export * from './file-search.ts';

// Milestone management
export * from './milestone-manager.ts';
export * from './milestone-persistence.ts';

// Fragment system for semantic search
export * from './fragments/mod.ts';

// Cross-referencing system
export * from './cross-references.ts';

// Re-export commonly used types for convenience
export type {
  Issue,
  Milestone,
  KnowledgeEntry,
  KnowledgeQuery,
  KnowledgeStats,
  CreateIssueRequest,
  CreateMilestoneRequest,
  UpdateKnowledgeRequest,
  KnowledgeResult,
  EntryStatus
} from './types.ts';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { FileManager, MilestoneManager } from './knowledge/mod.ts';
 * 
 * // Initialize issue management
 * const fileManager = new FileManager();
 * await fileManager.initialize();
 * 
 * // Create an issue
 * const result = await fileManager.createIssue({
 *   title: "Fix memory leak",
 *   content: "Memory usage keeps growing during long operations",
 *   priority: "high",
 *   tags: ["bug", "memory"]
 * });
 * 
 * // Search for issues
 * const issues = await fileManager.searchIssues({
 *   status: "open",
 *   tags: ["bug"]
 * });
 * 
 * // Milestone management
 * const milestoneManager = new MilestoneManager();
 * await milestoneManager.setMilestone({
 *   title: "Version 1.0 Release",
 *   description: "Complete all features for initial release",
 *   progress: 75
 * });
 * ```
 */