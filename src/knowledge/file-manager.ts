/**
 * File-based Knowledge Manager Implementation
 * 
 * This module provides a file-based implementation of the KnowledgeManager interface,
 * storing each knowledge entry as a markdown file with YAML frontmatter.
 * 
 * Files are organized by status in directories:
 * - .knowledge/open/
 * - .knowledge/in-progress/
 * - .knowledge/completed/
 * - .knowledge/archived/
 */

import { EventEmitter } from '../shared/event-emitter.ts';
import {
  KnowledgeEntry,
  Question,
  Answer,
  Note,
  Issue,
  KnowledgeType,
  EntryStatus,
  KnowledgeQuery,
  KnowledgeStats,
  CreateQuestionRequest,
  CreateAnswerRequest,
  CreateNoteRequest,
  CreateIssueRequest,
  UpdateKnowledgeRequest,
  KnowledgeResult,
  KnowledgeEvents,
  isValidCreateQuestionRequest,
  isValidCreateAnswerRequest,
  isValidCreateNoteRequest,
  isValidCreateIssueRequest,
  isValidTag,
  isQuestion,
  isAnswer,
  isNote,
  isIssue,
  KNOWLEDGE_ROOT,
  STATUS_FOLDERS,
  TYPE_PREFIXES
} from './types.ts';
import {
  parseMarkdownFile,
  serializeToMarkdown,
  buildFilePath,
  ensureKnowledgeDirectories,
  convertFrontmatterDates,
  validateParsedEntry,
  getNextEntryNumber
} from './file-io.ts';
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * File-based Knowledge Manager - Drop-in replacement for KnowledgeManager
 * 
 * Stores knowledge entries as markdown files with YAML frontmatter.
 * Maintains the same API as the registry-based KnowledgeManager.
 */
export class FileKnowledgeManager {
  private readonly events = new EventEmitter<KnowledgeEvents>();
  private initialized = false;

  constructor() {
    // Initialize directory structure on first use
  }

  /**
   * Initialize the knowledge directory structure
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await ensureKnowledgeDirectories();
      this.initialized = true;
    }
  }

  /**
   * Generate a unique entry ID based on type
   */
  private async generateEntryId(type: KnowledgeType): Promise<string> {
    const prefix = TYPE_PREFIXES[type];
    const number = await getNextEntryNumber(type);
    return `${prefix}${number}`;
  }

  /**
   * Build file path for an entry, potentially from a different status folder
   */
  private buildFilePathForStatus(id: string, status: EntryStatus): string {
    const statusFolder = STATUS_FOLDERS[status];
    const filename = `${id}.md`;
    return join(KNOWLEDGE_ROOT, statusFolder, filename);
  }

  /**
   * Find an entry by ID across all status folders
   */
  private async findEntryPath(id: string): Promise<string | null> {
    for (const status of Object.values(EntryStatus)) {
      const filePath = this.buildFilePathForStatus(id, status);
      try {
        await Deno.stat(filePath);
        return filePath;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
    }
    return null;
  }

  /**
   * Load an entry from file
   */
  private async loadEntry(filePath: string): Promise<KnowledgeEntry> {
    const parsed = await parseMarkdownFile(filePath);
    const frontmatter = convertFrontmatterDates(parsed.frontmatter);
    
    if (!validateParsedEntry(frontmatter, parsed.content)) {
      throw new Error(`Invalid entry format in file: ${filePath}`);
    }

    // Construct the entry object based on type
    const baseEntry = {
      id: frontmatter.id as string,
      type: frontmatter.type as KnowledgeType,
      content: parsed.content,
      timestamp: frontmatter.timestamp as Date,
      lastUpdated: frontmatter.lastUpdated as Date,
      tags: frontmatter.tags as string[],
      status: frontmatter.status as EntryStatus,
      processId: frontmatter.processId as string | undefined,
      metadata: (frontmatter.metadata as Record<string, unknown>) || {}
    };

    // Add type-specific fields
    switch (baseEntry.type) {
      case KnowledgeType.QUESTION:
        return {
          ...baseEntry,
          answered: frontmatter.answered as boolean,
          answerIds: (frontmatter.answerIds as string[]) || [],
          priority: frontmatter.priority as 'low' | 'medium' | 'high' | undefined
        } as Question;

      case KnowledgeType.ANSWER:
        return {
          ...baseEntry,
          questionId: frontmatter.questionId as string,
          accepted: frontmatter.accepted as boolean,
          votes: frontmatter.votes as number | undefined
        } as Answer;

      case KnowledgeType.NOTE:
        return {
          ...baseEntry,
          category: frontmatter.category as string | undefined,
          relatedIds: frontmatter.relatedIds as string[] | undefined
        } as Note;

      case KnowledgeType.ISSUE:
        return {
          ...baseEntry,
          priority: frontmatter.priority as 'low' | 'medium' | 'high',
          assignee: frontmatter.assignee as string | undefined,
          dueDate: frontmatter.dueDate as Date | undefined,
          relatedIds: frontmatter.relatedIds as string[] | undefined
        } as Issue;

      default:
        throw new Error(`Unknown knowledge type: ${baseEntry.type}`);
    }
  }

  /**
   * Save an entry to file
   */
  private async saveEntry(entry: KnowledgeEntry): Promise<void> {
    await this.ensureInitialized();
    
    const filePath = buildFilePath(entry);
    const markdown = serializeToMarkdown(entry);
    
    // Ensure the directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    await Deno.mkdir(dir, { recursive: true });
    
    await Deno.writeTextFile(filePath, markdown);
  }

  /**
   * Move an entry file when status changes
   */
  private async moveEntryFile(id: string, oldStatus: EntryStatus, newStatus: EntryStatus): Promise<void> {
    const oldPath = this.buildFilePathForStatus(id, oldStatus);
    const newPath = this.buildFilePathForStatus(id, newStatus);
    
    // Ensure the new directory exists
    const newDir = newPath.substring(0, newPath.lastIndexOf('/'));
    await Deno.mkdir(newDir, { recursive: true });
    
    try {
      await Deno.rename(oldPath, newPath);
    } catch (error) {
      // If rename fails, try copy + delete
      const content = await Deno.readTextFile(oldPath);
      await Deno.writeTextFile(newPath, content);
      await Deno.remove(oldPath);
    }
  }

  /**
   * Update question-answer linking when answers are created
   */
  private async linkAnswerToQuestion(answerId: string, questionId: string): Promise<void> {
    const questionPath = await this.findEntryPath(questionId);
    if (!questionPath) {
      throw new Error(`Question with ID ${questionId} not found`);
    }

    const question = await this.loadEntry(questionPath) as Question;
    if (!question.answerIds.includes(answerId)) {
      question.answerIds.push(answerId);
      question.answered = true;
      question.lastUpdated = new Date();
      await this.saveEntry(question);
    }
  }

  /**
   * Create a new question
   */
  async createQuestion(request: CreateQuestionRequest): Promise<KnowledgeResult<Question>> {
    try {
      // Validate request
      if (!isValidCreateQuestionRequest(request)) {
        return { 
          success: false, 
          error: 'Invalid question request: missing or invalid required fields' 
        };
      }

      // Validate tags
      if (request.tags) {
        for (const tag of request.tags) {
          if (!isValidTag(tag)) {
            return { 
              success: false, 
              error: `Invalid tag format: ${tag}. Tags must be alphanumeric with hyphens or underscores only.` 
            };
          }
        }
      }

      // Generate ID and create question entry
      const id = await this.generateEntryId(KnowledgeType.QUESTION);
      const question: Question = {
        id,
        type: KnowledgeType.QUESTION,
        content: request.content,
        timestamp: new Date(),
        lastUpdated: new Date(),
        tags: request.tags || [],
        status: EntryStatus.OPEN,
        processId: request.processId,
        metadata: request.metadata || {},
        answered: false,
        answerIds: [],
        priority: request.priority || 'medium'
      };

      // Save to file
      await this.saveEntry(question);

      // Emit event
      this.events.emit('knowledge:created', { entry: question });

      return { success: true, data: question };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Create a new answer for a question
   */
  async createAnswer(request: CreateAnswerRequest): Promise<KnowledgeResult<Answer>> {
    try {
      // Validate request
      if (!isValidCreateAnswerRequest(request)) {
        return { 
          success: false, 
          error: 'Invalid answer request: missing or invalid required fields' 
        };
      }

      // Validate tags
      if (request.tags) {
        for (const tag of request.tags) {
          if (!isValidTag(tag)) {
            return { 
              success: false, 
              error: `Invalid tag format: ${tag}` 
            };
          }
        }
      }

      // Check if question exists
      const questionPath = await this.findEntryPath(request.questionId);
      if (!questionPath) {
        return { 
          success: false, 
          error: `Question with ID ${request.questionId} not found` 
        };
      }

      const question = await this.loadEntry(questionPath);
      if (!isQuestion(question)) {
        return { 
          success: false, 
          error: `Entry ${request.questionId} is not a question` 
        };
      }

      // Generate ID and create answer entry
      const id = await this.generateEntryId(KnowledgeType.ANSWER);
      const answer: Answer = {
        id,
        type: KnowledgeType.ANSWER,
        content: request.content,
        timestamp: new Date(),
        lastUpdated: new Date(),
        tags: request.tags || [],
        status: EntryStatus.OPEN,
        processId: request.processId || question.processId,
        metadata: request.metadata || {},
        questionId: request.questionId,
        accepted: false,
        votes: 0
      };

      // Save to file
      await this.saveEntry(answer);

      // Link answer to question
      await this.linkAnswerToQuestion(answer.id, request.questionId);

      // Emit events
      this.events.emit('knowledge:created', { entry: answer });
      this.events.emit('knowledge:linked', { questionId: request.questionId, answerId: answer.id });

      return { success: true, data: answer };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Create a new note
   */
  async createNote(request: CreateNoteRequest): Promise<KnowledgeResult<Note>> {
    try {
      // Validate request
      if (!isValidCreateNoteRequest(request)) {
        return { 
          success: false, 
          error: 'Invalid note request: missing or invalid required fields' 
        };
      }

      // Validate tags
      if (request.tags) {
        for (const tag of request.tags) {
          if (!isValidTag(tag)) {
            return { 
              success: false, 
              error: `Invalid tag format: ${tag}` 
            };
          }
        }
      }

      // Validate related IDs exist
      if (request.relatedIds) {
        for (const id of request.relatedIds) {
          const path = await this.findEntryPath(id);
          if (!path) {
            return { 
              success: false, 
              error: `Related entry with ID ${id} not found` 
            };
          }
        }
      }

      // Generate ID and create note entry
      const id = await this.generateEntryId(KnowledgeType.NOTE);
      const note: Note = {
        id,
        type: KnowledgeType.NOTE,
        content: request.content,
        timestamp: new Date(),
        lastUpdated: new Date(),
        tags: request.tags || [],
        status: EntryStatus.OPEN,
        processId: request.processId,
        metadata: request.metadata || {},
        category: request.category,
        relatedIds: request.relatedIds
      };

      // Save to file
      await this.saveEntry(note);

      // Emit event
      this.events.emit('knowledge:created', { entry: note });

      return { success: true, data: note };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Create a new issue
   */
  async createIssue(request: CreateIssueRequest): Promise<KnowledgeResult<Issue>> {
    try {
      // Validate request
      if (!isValidCreateIssueRequest(request)) {
        return { 
          success: false, 
          error: 'Invalid issue request: missing or invalid required fields' 
        };
      }

      // Validate tags
      if (request.tags) {
        for (const tag of request.tags) {
          if (!isValidTag(tag)) {
            return { 
              success: false, 
              error: `Invalid tag format: ${tag}. Tags must be alphanumeric with hyphens or underscores only.` 
            };
          }
        }
      }

      // Validate related IDs exist
      if (request.relatedIds) {
        for (const id of request.relatedIds) {
          const path = await this.findEntryPath(id);
          if (!path) {
            return { 
              success: false, 
              error: `Related entry with ID ${id} not found` 
            };
          }
        }
      }

      // Generate ID and create issue entry
      const id = await this.generateEntryId(KnowledgeType.ISSUE);
      const issue: Issue = {
        id,
        type: KnowledgeType.ISSUE,
        content: request.content,
        timestamp: new Date(),
        lastUpdated: new Date(),
        tags: request.tags || [],
        status: EntryStatus.OPEN,
        processId: request.processId,
        metadata: request.metadata || {},
        priority: request.priority,
        assignee: request.assignee,
        dueDate: request.dueDate,
        relatedIds: request.relatedIds
      };

      // Save to file
      await this.saveEntry(issue);

      // Emit event
      this.events.emit('knowledge:created', { entry: issue });

      return { success: true, data: issue };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Update a knowledge entry
   */
  async updateEntry(id: string, updates: UpdateKnowledgeRequest): Promise<KnowledgeResult<KnowledgeEntry>> {
    try {
      const existingPath = await this.findEntryPath(id);
      if (!existingPath) {
        return { 
          success: false, 
          error: `Knowledge entry with ID ${id} not found` 
        };
      }

      const existing = await this.loadEntry(existingPath);
      const previous = { ...existing };

      // Validate tags if provided
      if (updates.tags) {
        for (const tag of updates.tags) {
          if (!isValidTag(tag)) {
            return { 
              success: false, 
              error: `Invalid tag format: ${tag}` 
            };
          }
        }
      }

      // Check if status is changing (we'll need to move the file)
      const statusChanging = updates.status !== undefined && updates.status !== existing.status;
      const oldStatus = existing.status;

      // Apply updates
      if (updates.content !== undefined) existing.content = updates.content;
      if (updates.tags !== undefined) existing.tags = updates.tags;
      if (updates.metadata !== undefined) {
        existing.metadata = { ...existing.metadata, ...updates.metadata };
      }
      if (updates.status !== undefined) existing.status = updates.status;

      // Type-specific updates
      if (isQuestion(existing) && updates.answered !== undefined) {
        existing.answered = updates.answered;
      } else if (isAnswer(existing) && updates.accepted !== undefined) {
        existing.accepted = updates.accepted;
      } else if (isNote(existing)) {
        if (updates.category !== undefined) existing.category = updates.category;
        if (updates.relatedIds !== undefined) existing.relatedIds = updates.relatedIds;
      } else if (isIssue(existing)) {
        if (updates.priority !== undefined) existing.priority = updates.priority;
        if (updates.assignee !== undefined) existing.assignee = updates.assignee;
        if (updates.dueDate !== undefined) existing.dueDate = updates.dueDate;
        if (updates.relatedIds !== undefined) existing.relatedIds = updates.relatedIds;
      }

      existing.lastUpdated = new Date();

      // Handle status change by moving the file
      if (statusChanging) {
        await this.moveEntryFile(existing.id, oldStatus, existing.status);
      }

      // Save updated entry
      await this.saveEntry(existing);

      // Emit update event
      this.events.emit('knowledge:updated', { entry: existing, previous });

      // Emit accepted event if answer was accepted
      if (isAnswer(existing) && isAnswer(previous) && 
          !previous.accepted && existing.accepted) {
        this.events.emit('knowledge:accepted', { 
          questionId: existing.questionId, 
          answerId: existing.id 
        });
      }

      return { success: true, data: existing };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Delete a knowledge entry
   */
  async deleteEntry(id: string): Promise<KnowledgeResult<void>> {
    try {
      const existingPath = await this.findEntryPath(id);
      if (!existingPath) {
        return { 
          success: false, 
          error: `Knowledge entry with ID ${id} not found` 
        };
      }

      const entry = await this.loadEntry(existingPath);

      // If deleting a question, check for answers
      if (isQuestion(entry)) {
        const answers = await this.getAnswersForQuestion(id);
        if (answers.length > 0) {
          return { 
            success: false, 
            error: `Cannot delete question with existing answers. Delete answers first.` 
          };
        }
      }

      // If deleting an answer, update question's answered status
      if (isAnswer(entry)) {
        const questionPath = await this.findEntryPath(entry.questionId);
        if (questionPath) {
          const question = await this.loadEntry(questionPath) as Question;
          question.answerIds = question.answerIds.filter(aid => aid !== id);
          
          if (question.answerIds.length === 0) {
            question.answered = false;
          }
          
          question.lastUpdated = new Date();
          await this.saveEntry(question);
        }
      }

      // Remove file
      await Deno.remove(existingPath);

      // Emit event
      this.events.emit('knowledge:deleted', { entryId: id, entry });

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get a knowledge entry by ID
   */
  async getEntry(id: string): Promise<KnowledgeEntry | undefined> {
    try {
      const path = await this.findEntryPath(id);
      if (!path) {
        return undefined;
      }
      return await this.loadEntry(path);
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Search knowledge entries (basic implementation)
   */
  async searchEntries(query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    const entries: KnowledgeEntry[] = [];
    
    // Load all entries from all status folders
    for (const status of Object.values(EntryStatus)) {
      const statusFolder = STATUS_FOLDERS[status];
      const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
      
      try {
        for await (const entry of Deno.readDir(folderPath)) {
          if (entry.isFile && entry.name.endsWith('.md')) {
            try {
              const filePath = join(folderPath, entry.name);
              const knowledgeEntry = await this.loadEntry(filePath);
              entries.push(knowledgeEntry);
            } catch (error) {
              // Skip invalid entries
              continue;
            }
          }
        }
      } catch (error) {
        // Folder might not exist, skip
        continue;
      }
    }

    // Apply filters
    let filtered = entries;

    if (query.type) {
      filtered = filtered.filter(entry => entry.type === query.type);
    }

    if (query.tags && query.tags.length > 0) {
      filtered = filtered.filter(entry => 
        query.tags!.some(tag => entry.tags.includes(tag))
      );
    }

    if (query.processId) {
      filtered = filtered.filter(entry => entry.processId === query.processId);
    }

    if (query.search) {
      const searchLower = query.search.toLowerCase();
      filtered = filtered.filter(entry => 
        entry.content.toLowerCase().includes(searchLower)
      );
    }

    if (query.answered !== undefined) {
      filtered = filtered.filter(entry => 
        isQuestion(entry) && entry.answered === query.answered
      );
    }

    if (query.category) {
      filtered = filtered.filter(entry => 
        isNote(entry) && entry.category === query.category
      );
    }

    // Apply sorting
    if (query.sortBy) {
      const sortOrder = query.sortOrder || 'desc';
      filtered.sort((a, b) => {
        let aVal: any, bVal: any;
        
        switch (query.sortBy) {
          case 'timestamp':
            aVal = a.timestamp;
            bVal = b.timestamp;
            break;
          case 'lastUpdated':
            aVal = a.lastUpdated;
            bVal = b.lastUpdated;
            break;
          case 'type':
            aVal = a.type;
            bVal = b.type;
            break;
          default:
            return 0;
        }

        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit;
    
    if (limit) {
      return filtered.slice(offset, offset + limit);
    }
    
    return filtered.slice(offset);
  }

  /**
   * Get all entries
   */
  async getAllEntries(): Promise<KnowledgeEntry[]> {
    return await this.searchEntries({});
  }

  /**
   * Get answers for a question
   */
  async getAnswersForQuestion(questionId: string): Promise<Answer[]> {
    const entries = await this.searchEntries({ type: KnowledgeType.ANSWER });
    return entries.filter(entry => 
      isAnswer(entry) && entry.questionId === questionId
    ) as Answer[];
  }

  /**
   * Get basic statistics (simplified implementation)
   */
  async getStatistics(): Promise<KnowledgeStats> {
    const entries = await this.getAllEntries();
    
    const stats: KnowledgeStats = {
      totalEntries: entries.length,
      byType: {
        questions: 0,
        answers: 0,
        notes: 0,
        issues: 0
      },
      byStatus: {
        answeredQuestions: 0,
        unansweredQuestions: 0,
        acceptedAnswers: 0
      },
      tagFrequency: {},
      processCorrelation: {},
      timeGrouping: {
        today: 0,
        thisWeek: 0,
        thisMonth: 0,
        older: 0
      }
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    for (const entry of entries) {
      // Count by type
      switch (entry.type) {
        case KnowledgeType.QUESTION:
          stats.byType.questions++;
          if (isQuestion(entry)) {
            if (entry.answered) {
              stats.byStatus.answeredQuestions++;
            } else {
              stats.byStatus.unansweredQuestions++;
            }
          }
          break;
        case KnowledgeType.ANSWER:
          stats.byType.answers++;
          if (isAnswer(entry) && entry.accepted) {
            stats.byStatus.acceptedAnswers++;
          }
          break;
        case KnowledgeType.NOTE:
          stats.byType.notes++;
          break;
        case KnowledgeType.ISSUE:
          stats.byType.issues++;
          break;
      }

      // Count tags
      for (const tag of entry.tags) {
        stats.tagFrequency[tag] = (stats.tagFrequency[tag] || 0) + 1;
      }

      // Count processes
      if (entry.processId) {
        stats.processCorrelation[entry.processId] = 
          (stats.processCorrelation[entry.processId] || 0) + 1;
      }

      // Time grouping
      if (entry.timestamp >= today) {
        stats.timeGrouping.today++;
      } else if (entry.timestamp >= thisWeek) {
        stats.timeGrouping.thisWeek++;
      } else if (entry.timestamp >= thisMonth) {
        stats.timeGrouping.thisMonth++;
      } else {
        stats.timeGrouping.older++;
      }
    }

    return stats;
  }

  /**
   * Accept an answer for a question
   */
  async acceptAnswer(answerId: string): Promise<KnowledgeResult<Answer>> {
    try {
      const answerPath = await this.findEntryPath(answerId);
      if (!answerPath) {
        return { 
          success: false, 
          error: `Answer with ID ${answerId} not found` 
        };
      }

      const answer = await this.loadEntry(answerPath);
      if (!isAnswer(answer)) {
        return { 
          success: false, 
          error: `Entry ${answerId} is not an answer` 
        };
      }

      // Unaccept any previously accepted answers for this question
      const allAnswers = await this.getAnswersForQuestion(answer.questionId);
      for (const otherAnswer of allAnswers) {
        if (otherAnswer.accepted && otherAnswer.id !== answerId) {
          await this.updateEntry(otherAnswer.id, { accepted: false });
        }
      }

      // Accept this answer
      const result = await this.updateEntry(answerId, { accepted: true });
      if (result.success && result.data && isAnswer(result.data)) {
        return { success: true, data: result.data };
      }
      return result as KnowledgeResult<Answer>;
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get suggested tags based on existing entries (simplified)
   */
  async getSuggestedTags(partialTag?: string): Promise<string[]> {
    const stats = await this.getStatistics();
    let tags = Object.keys(stats.tagFrequency);

    // Filter by partial match if provided
    if (partialTag) {
      const partial = partialTag.toLowerCase();
      tags = tags.filter(tag => tag.toLowerCase().includes(partial));
    }

    // Sort by frequency (most used first)
    return tags.sort((a, b) => 
      (stats.tagFrequency[b] || 0) - (stats.tagFrequency[a] || 0)
    );
  }

  /**
   * Clear all knowledge entries
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();
    
    // Remove all files from all status folders
    for (const status of Object.values(EntryStatus)) {
      const statusFolder = STATUS_FOLDERS[status];
      const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
      
      try {
        for await (const entry of Deno.readDir(folderPath)) {
          if (entry.isFile && entry.name.endsWith('.md')) {
            const filePath = join(folderPath, entry.name);
            await Deno.remove(filePath);
          }
        }
      } catch (error) {
        // Folder might not exist, ignore
      }
    }
  }

  /**
   * Load method (no-op for file-based implementation)
   */
  async load(): Promise<void> {
    // File-based implementation doesn't need explicit loading
    await this.ensureInitialized();
  }

  /**
   * Save method (no-op for file-based implementation)
   */
  async save(): Promise<void> {
    // File-based implementation saves immediately
  }

  /**
   * Set auto-save (no-op for file-based implementation)
   */
  setAutoSave(enabled: boolean): void {
    // File-based implementation always auto-saves
  }

  /**
   * Export to file (simplified - just copy files)
   */
  async exportToFile(filePath: string, query?: KnowledgeQuery): Promise<void> {
    const entries = query ? await this.searchEntries(query) : await this.getAllEntries();
    
    // Create a simple JSON export
    const exportData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      entries: entries
    };
    
    await Deno.writeTextFile(filePath, JSON.stringify(exportData, null, 2));
  }

  /**
   * Import from file (simplified)
   */
  async importFromFile(filePath: string): Promise<number> {
    const content = await Deno.readTextFile(filePath);
    const data = JSON.parse(content);
    
    if (!data.entries || !Array.isArray(data.entries)) {
      throw new Error('Invalid import format');
    }
    
    let imported = 0;
    for (const entry of data.entries) {
      try {
        // Check if entry already exists
        const existing = await this.getEntry(entry.id);
        if (!existing) {
          // Convert timestamp strings back to Date objects
          entry.timestamp = new Date(entry.timestamp);
          entry.lastUpdated = new Date(entry.lastUpdated);
          if (entry.dueDate) {
            entry.dueDate = new Date(entry.dueDate);
          }
          
          await this.saveEntry(entry);
          imported++;
        }
      } catch (error) {
        // Failed to import entry, skip
      }
    }
    
    return imported;
  }

  /**
   * Subscribe to knowledge events
   */
  on<K extends keyof KnowledgeEvents>(event: K, listener: (data: KnowledgeEvents[K]) => void): () => void {
    return this.events.on(event, listener);
  }

  /**
   * Remove all event listeners
   */
  removeAllListeners<K extends keyof KnowledgeEvents>(event?: K): void {
    this.events.removeAllListeners(event);
  }
}

// Export default instance for convenience
export const fileKnowledgeManager = new FileKnowledgeManager();