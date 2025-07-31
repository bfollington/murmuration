import { EventEmitter } from '../shared/event-emitter.ts';
import { KnowledgeRegistry } from './registry.ts';
import { KnowledgePersistence } from './persistence.ts';
import {
  KnowledgeEntry,
  Question,
  Answer,
  Note,
  KnowledgeType,
  KnowledgeQuery,
  KnowledgeStats,
  CreateQuestionRequest,
  CreateAnswerRequest,
  CreateNoteRequest,
  UpdateKnowledgeRequest,
  KnowledgeResult,
  KnowledgeEvents,
  isValidCreateQuestionRequest,
  isValidCreateAnswerRequest,
  isValidCreateNoteRequest,
  isValidTag,
  isQuestion,
  isAnswer
} from './types.ts';

/**
 * Knowledge Manager - Business logic layer for knowledge management
 * 
 * Handles creation, updating, linking, and querying of knowledge entries
 * with validation, event emission, and business rules enforcement.
 */
export class KnowledgeManager {
  private registry: KnowledgeRegistry;
  private persistence: KnowledgePersistence;
  private readonly events = new EventEmitter<KnowledgeEvents>();
  private autoSave = false; // Disabled by default to avoid async issues in tests

  constructor(registry?: KnowledgeRegistry, persistence?: KnowledgePersistence) {
    this.registry = registry || new KnowledgeRegistry();
    this.persistence = persistence || new KnowledgePersistence();
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

      // Create question entry
      const question: Question = {
        id: KnowledgeRegistry.generateEntryId(),
        type: KnowledgeType.QUESTION,
        content: request.content,
        timestamp: new Date(),
        lastUpdated: new Date(),
        tags: request.tags || [],
        processId: request.processId,
        metadata: request.metadata || {},
        answered: false,
        answerIds: [],
        priority: request.priority || 'medium'
      };

      // Add to registry
      this.registry.addEntry(question);

      // Emit event
      this.events.emit('knowledge:created', { entry: question });

      // Auto-save if enabled
      if (this.autoSave) {
        this.save().catch(() => {
          // Auto-save failed, ignore
        });
      }

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
      const question = this.registry.getEntry(request.questionId);
      if (!question || !isQuestion(question)) {
        return { 
          success: false, 
          error: `Question with ID ${request.questionId} not found` 
        };
      }

      // Create answer entry
      const answer: Answer = {
        id: KnowledgeRegistry.generateEntryId(),
        type: KnowledgeType.ANSWER,
        content: request.content,
        timestamp: new Date(),
        lastUpdated: new Date(),
        tags: request.tags || [],
        processId: request.processId || question.processId, // Inherit from question if not specified
        metadata: request.metadata || {},
        questionId: request.questionId,
        accepted: false,
        votes: 0
      };

      // Add to registry
      this.registry.addEntry(answer);

      // Link answer to question
      this.registry.linkAnswerToQuestion(answer.id, request.questionId);

      // Update question to mark as answered
      const questionUpdate: Partial<Question> = { answered: true };
      this.registry.updateEntry(request.questionId, questionUpdate);

      // Emit events
      this.events.emit('knowledge:created', { entry: answer });
      this.events.emit('knowledge:linked', { questionId: request.questionId, answerId: answer.id });

      // Auto-save if enabled
      if (this.autoSave) {
        this.save().catch(() => {
          // Auto-save failed, ignore
        });
      }

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
          if (!this.registry.hasEntry(id)) {
            return { 
              success: false, 
              error: `Related entry with ID ${id} not found` 
            };
          }
        }
      }

      // Create note entry
      const note: Note = {
        id: KnowledgeRegistry.generateEntryId(),
        type: KnowledgeType.NOTE,
        content: request.content,
        timestamp: new Date(),
        lastUpdated: new Date(),
        tags: request.tags || [],
        processId: request.processId,
        metadata: request.metadata || {},
        category: request.category,
        relatedIds: request.relatedIds
      };

      // Add to registry
      this.registry.addEntry(note);

      // Emit event
      this.events.emit('knowledge:created', { entry: note });

      // Auto-save if enabled
      if (this.autoSave) {
        this.save().catch(() => {
          // Auto-save failed, ignore
        });
      }

      return { success: true, data: note };
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
      const existing = this.registry.getEntry(id);
      if (!existing) {
        return { 
          success: false, 
          error: `Knowledge entry with ID ${id} not found` 
        };
      }

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

      // Store previous state for event
      const previous = { ...existing };

      // Apply updates based on entry type
      const updateData: Partial<KnowledgeEntry> = {
        content: updates.content,
        tags: updates.tags,
        metadata: updates.metadata ? { ...existing.metadata, ...updates.metadata } : undefined
      };

      // Type-specific updates
      if (isQuestion(existing) && updates.answered !== undefined) {
        (updateData as Partial<Question>).answered = updates.answered;
      } else if (isAnswer(existing) && updates.accepted !== undefined) {
        (updateData as Partial<Answer>).accepted = updates.accepted;
      } else if (existing.type === KnowledgeType.NOTE && updates.category !== undefined) {
        (updateData as Partial<Note>).category = updates.category;
      }

      // Remove undefined values
      Object.keys(updateData).forEach(key => {
        if (updateData[key as keyof typeof updateData] === undefined) {
          delete updateData[key as keyof typeof updateData];
        }
      });

      // Update in registry
      const success = this.registry.updateEntry(id, updateData);
      if (!success) {
        return { 
          success: false, 
          error: 'Failed to update entry' 
        };
      }

      const updated = this.registry.getEntry(id)!;

      // Emit update event
      this.events.emit('knowledge:updated', { entry: updated, previous });

      // Emit accepted event if answer was accepted
      if (isAnswer(updated) && isAnswer(previous) && 
          !previous.accepted && updated.accepted) {
        this.events.emit('knowledge:accepted', { 
          questionId: updated.questionId, 
          answerId: updated.id 
        });
      }

      // Auto-save if enabled
      if (this.autoSave) {
        this.save().catch(() => {
          // Auto-save failed, ignore
        });
      }

      return { success: true, data: updated };
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
      const entry = this.registry.getEntry(id);
      if (!entry) {
        return { 
          success: false, 
          error: `Knowledge entry with ID ${id} not found` 
        };
      }

      // If deleting a question, check for answers
      if (isQuestion(entry)) {
        const answers = this.registry.getAnswersForQuestion(id);
        if (answers.length > 0) {
          return { 
            success: false, 
            error: `Cannot delete question with existing answers. Delete answers first.` 
          };
        }
      }

      // If deleting an answer, update question's answered status
      if (isAnswer(entry)) {
        const remainingAnswers = this.registry.getAnswersForQuestion(entry.questionId)
          .filter(a => a.id !== id);
        
        if (remainingAnswers.length === 0) {
          // No more answers, mark question as unanswered
          const questionUpdate: Partial<Question> = { answered: false };
          this.registry.updateEntry(entry.questionId, questionUpdate);
        }
      }

      // Remove from registry
      const success = this.registry.removeEntry(id);
      if (!success) {
        return { 
          success: false, 
          error: 'Failed to delete entry' 
        };
      }

      // Emit event
      this.events.emit('knowledge:deleted', { entryId: id, entry });

      // Auto-save if enabled
      if (this.autoSave) {
        this.save().catch(() => {
          // Auto-save failed, ignore
        });
      }

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
  getEntry(id: string): KnowledgeEntry | undefined {
    return this.registry.getEntry(id);
  }

  /**
   * Search knowledge entries
   */
  searchEntries(query: KnowledgeQuery): KnowledgeEntry[] {
    return this.registry.searchEntries(query);
  }

  /**
   * Get all entries
   */
  getAllEntries(): KnowledgeEntry[] {
    return this.registry.getAllEntries();
  }

  /**
   * Get answers for a question
   */
  getAnswersForQuestion(questionId: string): Answer[] {
    return this.registry.getAnswersForQuestion(questionId);
  }

  /**
   * Get knowledge statistics
   */
  getStatistics(): KnowledgeStats {
    return this.registry.getStatistics();
  }

  /**
   * Accept an answer for a question
   */
  async acceptAnswer(answerId: string): Promise<KnowledgeResult<Answer>> {
    try {
      const answer = this.registry.getEntry(answerId);
      if (!answer || !isAnswer(answer)) {
        return { 
          success: false, 
          error: `Answer with ID ${answerId} not found` 
        };
      }

      // Unaccept any previously accepted answers for this question
      const allAnswers = this.registry.getAnswersForQuestion(answer.questionId);
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
   * Get suggested tags based on existing entries
   */
  getSuggestedTags(partialTag?: string): string[] {
    const stats = this.registry.getStatistics();
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
  clear(): void {
    this.registry.clear();
    if (this.autoSave) {
      this.save().catch(() => {
        // Save failed after clear, ignore
      });
    }
  }

  /**
   * Load knowledge from persistence
   */
  async load(): Promise<void> {
    await this.persistence.loadIntoRegistry(this.registry);
  }

  /**
   * Save knowledge to persistence
   */
  async save(): Promise<void> {
    await this.persistence.saveFromRegistry(this.registry);
  }

  /**
   * Enable or disable auto-save
   */
  setAutoSave(enabled: boolean): void {
    this.autoSave = enabled;
  }

  /**
   * Export knowledge to a file
   */
  async exportToFile(filePath: string, query?: KnowledgeQuery): Promise<void> {
    const entries = query ? this.searchEntries(query) : this.getAllEntries();
    await this.persistence.exportToFile(filePath, entries);
  }

  /**
   * Import knowledge from a file
   */
  async importFromFile(filePath: string): Promise<number> {
    const entries = await this.persistence.importFromFile(filePath);
    let imported = 0;
    
    for (const entry of entries) {
      try {
        // Check if entry already exists
        if (!this.registry.hasEntry(entry.id)) {
          this.registry.addEntry(entry);
          imported++;
          
          // Re-establish question-answer links
          if (entry.type === KnowledgeType.ANSWER) {
            const answer = entry as Answer;
            this.registry.linkAnswerToQuestion(answer.id, answer.questionId);
          }
        }
      } catch (error) {
        // Failed to import entry, skip
      }
    }
    
    if (this.autoSave && imported > 0) {
      await this.save();
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
export const knowledgeManager = new KnowledgeManager();