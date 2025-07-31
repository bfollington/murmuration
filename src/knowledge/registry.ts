import { 
  KnowledgeEntry, 
  Question, 
  Answer, 
  Note, 
  KnowledgeType,
  KnowledgeQuery,
  KnowledgeStats,
  isQuestion,
  isAnswer,
  isNote
} from './types.ts';

/**
 * Knowledge Registry - Core data management layer for knowledge entries
 * 
 * Provides CRUD operations, search capabilities, and statistics for
 * questions, answers, and notes. All operations return deep copies
 * to prevent external mutations.
 */
export class KnowledgeRegistry {
  private readonly entries: Map<string, KnowledgeEntry> = new Map();
  private readonly tagIndex: Map<string, Set<string>> = new Map(); // tag -> entry IDs
  private readonly processIndex: Map<string, Set<string>> = new Map(); // processId -> entry IDs
  private readonly questionAnswerIndex: Map<string, Set<string>> = new Map(); // questionId -> answer IDs

  /**
   * Add a new knowledge entry to the registry
   */
  addEntry(entry: KnowledgeEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`Knowledge entry with ID ${entry.id} already exists`);
    }

    // Store deep copy to prevent external mutations
    const entryCopy = this.deepCopyEntry(entry);
    this.entries.set(entry.id, entryCopy);

    // Update indices
    this.updateIndices(entryCopy);
  }

  /**
   * Get a knowledge entry by ID
   */
  getEntry(id: string): KnowledgeEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? this.deepCopyEntry(entry) : undefined;
  }

  /**
   * Update an existing knowledge entry
   */
  updateEntry(id: string, updates: Partial<KnowledgeEntry>): boolean {
    const existing = this.entries.get(id);
    if (!existing) {
      return false;
    }

    // Clear old indices
    this.clearIndices(existing);

    // Apply updates (preserve ID and type)
    const updated = {
      ...existing,
      ...updates,
      id: existing.id,
      type: existing.type,
      lastUpdated: new Date()
    };

    this.entries.set(id, updated);
    
    // Update indices
    this.updateIndices(updated);

    return true;
  }

  /**
   * Remove a knowledge entry
   */
  removeEntry(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) {
      return false;
    }

    // Clear indices
    this.clearIndices(entry);

    // If it's an answer, remove it from question's answer list
    if (isAnswer(entry)) {
      const answerIds = this.questionAnswerIndex.get(entry.questionId);
      if (answerIds) {
        answerIds.delete(id);
        if (answerIds.size === 0) {
          this.questionAnswerIndex.delete(entry.questionId);
        }
      }
    }

    // If it's a question, remove all its answer references
    if (isQuestion(entry)) {
      this.questionAnswerIndex.delete(id);
    }

    return this.entries.delete(id);
  }

  /**
   * Get all knowledge entries
   */
  getAllEntries(): KnowledgeEntry[] {
    return Array.from(this.entries.values()).map(entry => this.deepCopyEntry(entry));
  }

  /**
   * Get entries by type
   */
  getEntriesByType(type: KnowledgeType): KnowledgeEntry[] {
    return Array.from(this.entries.values())
      .filter(entry => entry.type === type)
      .map(entry => this.deepCopyEntry(entry));
  }

  /**
   * Get entries by tag
   */
  getEntriesByTag(tag: string): KnowledgeEntry[] {
    const entryIds = this.tagIndex.get(tag);
    if (!entryIds) return [];

    return Array.from(entryIds)
      .map(id => this.entries.get(id))
      .filter((entry): entry is KnowledgeEntry => entry !== undefined)
      .map(entry => this.deepCopyEntry(entry));
  }

  /**
   * Get entries by process ID
   */
  getEntriesByProcessId(processId: string): KnowledgeEntry[] {
    const entryIds = this.processIndex.get(processId);
    if (!entryIds) return [];

    return Array.from(entryIds)
      .map(id => this.entries.get(id))
      .filter((entry): entry is KnowledgeEntry => entry !== undefined)
      .map(entry => this.deepCopyEntry(entry));
  }

  /**
   * Get answers for a specific question
   */
  getAnswersForQuestion(questionId: string): Answer[] {
    const answerIds = this.questionAnswerIndex.get(questionId);
    if (!answerIds) return [];

    return Array.from(answerIds)
      .map(id => this.entries.get(id))
      .filter((entry): entry is Answer => entry !== undefined && isAnswer(entry))
      .map(entry => this.deepCopyEntry(entry) as Answer);
  }

  /**
   * Link an answer to a question
   */
  linkAnswerToQuestion(answerId: string, questionId: string): boolean {
    const answer = this.entries.get(answerId);
    const question = this.entries.get(questionId);

    if (!answer || !isAnswer(answer) || !question || !isQuestion(question)) {
      return false;
    }

    // Update answer's questionId
    (answer as Answer).questionId = questionId;

    // Update question's answerIds
    if (!question.answerIds.includes(answerId)) {
      question.answerIds.push(answerId);
    }

    // Update index
    if (!this.questionAnswerIndex.has(questionId)) {
      this.questionAnswerIndex.set(questionId, new Set());
    }
    this.questionAnswerIndex.get(questionId)!.add(answerId);

    return true;
  }

  /**
   * Search entries with filters
   */
  searchEntries(query: KnowledgeQuery): KnowledgeEntry[] {
    let results = Array.from(this.entries.values());

    // Filter by type
    if (query.type !== undefined) {
      results = results.filter(entry => entry.type === query.type);
    }

    // Filter by tags (entries must have ALL specified tags)
    if (query.tags && query.tags.length > 0) {
      results = results.filter(entry => 
        query.tags!.every(tag => entry.tags.includes(tag))
      );
    }

    // Filter by process ID
    if (query.processId !== undefined) {
      results = results.filter(entry => entry.processId === query.processId);
    }

    // Text search in content
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      results = results.filter(entry => 
        entry.content.toLowerCase().includes(searchLower)
      );
    }

    // Filter questions by answered status
    if (query.answered !== undefined && query.type === KnowledgeType.QUESTION) {
      results = results.filter(entry => 
        isQuestion(entry) && entry.answered === query.answered
      );
    }

    // Filter notes by category
    if (query.category !== undefined && query.type === KnowledgeType.NOTE) {
      results = results.filter(entry => 
        isNote(entry) && entry.category === query.category
      );
    }

    // Sort results
    if (query.sortBy) {
      const sortOrder = query.sortOrder || 'asc';
      results.sort((a, b) => {
        let comparison = 0;
        
        switch (query.sortBy) {
          case 'timestamp':
            comparison = a.timestamp.getTime() - b.timestamp.getTime();
            break;
          case 'lastUpdated':
            comparison = a.lastUpdated.getTime() - b.lastUpdated.getTime();
            break;
          case 'type':
            comparison = a.type.localeCompare(b.type);
            break;
        }
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    // Apply pagination
    if (query.offset !== undefined || query.limit !== undefined) {
      const offset = query.offset || 0;
      const limit = query.limit || results.length;
      results = results.slice(offset, offset + limit);
    }

    return results.map(entry => this.deepCopyEntry(entry));
  }

  /**
   * Get statistics about the knowledge base
   */
  getStatistics(): KnowledgeStats {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const stats: KnowledgeStats = {
      totalEntries: this.entries.size,
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

    // Calculate statistics
    for (const entry of this.entries.values()) {
      // By type
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

      // Tag frequency
      for (const tag of entry.tags) {
        stats.tagFrequency[tag] = (stats.tagFrequency[tag] || 0) + 1;
      }

      // Process correlation
      if (entry.processId) {
        stats.processCorrelation[entry.processId] = 
          (stats.processCorrelation[entry.processId] || 0) + 1;
      }

      // Time grouping
      const timestamp = entry.timestamp.getTime();
      if (timestamp >= todayStart.getTime()) {
        stats.timeGrouping.today++;
      } else if (timestamp >= weekStart.getTime()) {
        stats.timeGrouping.thisWeek++;
      } else if (timestamp >= monthStart.getTime()) {
        stats.timeGrouping.thisMonth++;
      } else {
        stats.timeGrouping.older++;
      }
    }

    return stats;
  }

  /**
   * Check if an entry exists
   */
  hasEntry(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Get total entry count
   */
  getEntryCount(): number {
    return this.entries.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.tagIndex.clear();
    this.processIndex.clear();
    this.questionAnswerIndex.clear();
  }

  /**
   * Generate a unique entry ID
   */
  static generateEntryId(): string {
    return `ke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Deep copy a knowledge entry to prevent mutations
   */
  private deepCopyEntry<T extends KnowledgeEntry>(entry: T): T {
    const copy = {
      ...entry,
      timestamp: new Date(entry.timestamp),
      lastUpdated: new Date(entry.lastUpdated),
      tags: [...entry.tags],
      metadata: { ...entry.metadata }
    };

    // Handle type-specific arrays
    if (isQuestion(entry) && isQuestion(copy)) {
      copy.answerIds = [...entry.answerIds];
    } else if (isNote(entry) && isNote(copy) && entry.relatedIds) {
      copy.relatedIds = [...entry.relatedIds];
    }

    return copy as T;
  }

  /**
   * Update indices for an entry
   */
  private updateIndices(entry: KnowledgeEntry): void {
    // Update tag index
    for (const tag of entry.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(entry.id);
    }

    // Update process index
    if (entry.processId) {
      if (!this.processIndex.has(entry.processId)) {
        this.processIndex.set(entry.processId, new Set());
      }
      this.processIndex.get(entry.processId)!.add(entry.id);
    }

    // Update question-answer index
    if (isAnswer(entry)) {
      if (!this.questionAnswerIndex.has(entry.questionId)) {
        this.questionAnswerIndex.set(entry.questionId, new Set());
      }
      this.questionAnswerIndex.get(entry.questionId)!.add(entry.id);
    }
  }

  /**
   * Clear indices for an entry
   */
  private clearIndices(entry: KnowledgeEntry): void {
    // Clear from tag index
    for (const tag of entry.tags) {
      const tagEntries = this.tagIndex.get(tag);
      if (tagEntries) {
        tagEntries.delete(entry.id);
        if (tagEntries.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }

    // Clear from process index
    if (entry.processId) {
      const processEntries = this.processIndex.get(entry.processId);
      if (processEntries) {
        processEntries.delete(entry.id);
        if (processEntries.size === 0) {
          this.processIndex.delete(entry.processId);
        }
      }
    }
  }
}

// Export default instance for convenience
export const knowledgeRegistry = new KnowledgeRegistry();