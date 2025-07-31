/**
 * Core knowledge management types for the MCP Process Management Server
 */

/**
 * Knowledge entry types
 */
export enum KnowledgeType {
  QUESTION = 'question',
  ANSWER = 'answer',
  NOTE = 'note'
}

/**
 * Base interface for all knowledge entries
 */
export interface KnowledgeEntry {
  id: string;
  type: KnowledgeType;
  content: string;
  timestamp: Date;
  lastUpdated: Date;
  tags: string[];
  processId?: string; // Link to related process if applicable
  metadata: Record<string, unknown>;
}

/**
 * Question entry for tracking questions about the system or processes
 */
export interface Question extends KnowledgeEntry {
  type: KnowledgeType.QUESTION;
  answered: boolean;
  answerIds: string[]; // IDs of related answers
  priority?: 'low' | 'medium' | 'high';
}

/**
 * Answer entry for responses to questions
 */
export interface Answer extends KnowledgeEntry {
  type: KnowledgeType.ANSWER;
  questionId: string; // ID of the question this answers
  accepted: boolean; // Whether this is the accepted answer
  votes?: number; // For future ranking
}

/**
 * Note entry for general observations and documentation
 */
export interface Note extends KnowledgeEntry {
  type: KnowledgeType.NOTE;
  category?: string; // e.g., 'observation', 'todo', 'idea'
  relatedIds?: string[]; // IDs of related knowledge entries
}

/**
 * Knowledge query filters for searching and listing
 */
export interface KnowledgeQuery {
  type?: KnowledgeType;
  tags?: string[];
  processId?: string;
  search?: string; // Text search in content
  answered?: boolean; // For questions only
  category?: string; // For notes only
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'lastUpdated' | 'type';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Knowledge creation request interfaces
 */
export interface CreateQuestionRequest {
  content: string;
  tags?: string[];
  processId?: string;
  priority?: 'low' | 'medium' | 'high';
  metadata?: Record<string, unknown>;
}

export interface CreateAnswerRequest {
  content: string;
  questionId: string;
  tags?: string[];
  processId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateNoteRequest {
  content: string;
  tags?: string[];
  processId?: string;
  category?: string;
  relatedIds?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Knowledge update request interface
 */
export interface UpdateKnowledgeRequest {
  content?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  // Type-specific updates
  answered?: boolean; // For questions
  accepted?: boolean; // For answers
  category?: string; // For notes
}

/**
 * Knowledge operation result
 */
export interface KnowledgeResult<T = KnowledgeEntry> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Knowledge statistics
 */
export interface KnowledgeStats {
  totalEntries: number;
  byType: {
    questions: number;
    answers: number;
    notes: number;
  };
  byStatus: {
    answeredQuestions: number;
    unansweredQuestions: number;
    acceptedAnswers: number;
  };
  tagFrequency: Record<string, number>;
  processCorrelation: Record<string, number>;
  timeGrouping: {
    today: number;
    thisWeek: number;
    thisMonth: number;
    older: number;
  };
}

/**
 * Knowledge event types
 */
export enum KnowledgeEventType {
  CREATED = 'created',
  UPDATED = 'updated',
  DELETED = 'deleted',
  LINKED = 'linked',
  UNLINKED = 'unlinked',
  ACCEPTED = 'accepted' // Answer accepted for a question
}

/**
 * Knowledge event data structure
 */
export interface KnowledgeEvent {
  type: KnowledgeEventType;
  entryId: string;
  timestamp: Date;
  data?: unknown;
}

/**
 * Type guards for knowledge entries
 */
export function isQuestion(entry: KnowledgeEntry): entry is Question {
  return entry.type === KnowledgeType.QUESTION;
}

export function isAnswer(entry: KnowledgeEntry): entry is Answer {
  return entry.type === KnowledgeType.ANSWER;
}

export function isNote(entry: KnowledgeEntry): entry is Note {
  return entry.type === KnowledgeType.NOTE;
}

/**
 * Validation constants
 */
export const KNOWLEDGE_VALIDATION = {
  MAX_CONTENT_LENGTH: 10000,
  MIN_CONTENT_LENGTH: 1,
  MAX_TAGS: 20,
  MAX_TAG_LENGTH: 50,
  MIN_TAG_LENGTH: 1,
  VALID_PRIORITIES: ['low', 'medium', 'high'] as const,
  VALID_NOTE_CATEGORIES: ['observation', 'todo', 'idea', 'documentation', 'issue', 'solution'] as const
} as const;

/**
 * Type guard to validate CreateQuestionRequest
 */
export function isValidCreateQuestionRequest(obj: unknown): obj is CreateQuestionRequest {
  if (!obj || typeof obj !== 'object') return false;
  
  const req = obj as Record<string, unknown>;
  
  // content is required and must be a non-empty string
  if (typeof req.content !== 'string' || 
      req.content.length < KNOWLEDGE_VALIDATION.MIN_CONTENT_LENGTH ||
      req.content.length > KNOWLEDGE_VALIDATION.MAX_CONTENT_LENGTH) {
    return false;
  }
  
  // tags is optional but must be string array if present
  if (req.tags !== undefined) {
    if (!Array.isArray(req.tags) || 
        !req.tags.every(tag => typeof tag === 'string' && 
                               tag.length >= KNOWLEDGE_VALIDATION.MIN_TAG_LENGTH &&
                               tag.length <= KNOWLEDGE_VALIDATION.MAX_TAG_LENGTH) ||
        req.tags.length > KNOWLEDGE_VALIDATION.MAX_TAGS) {
      return false;
    }
  }
  
  // priority is optional but must be valid if present
  if (req.priority !== undefined && 
      !KNOWLEDGE_VALIDATION.VALID_PRIORITIES.includes(req.priority as any)) {
    return false;
  }
  
  // processId is optional but must be string if present
  if (req.processId !== undefined && typeof req.processId !== 'string') {
    return false;
  }
  
  return true;
}

/**
 * Type guard to validate CreateAnswerRequest
 */
export function isValidCreateAnswerRequest(obj: unknown): obj is CreateAnswerRequest {
  if (!obj || typeof obj !== 'object') return false;
  
  const req = obj as Record<string, unknown>;
  
  // questionId is required
  if (typeof req.questionId !== 'string' || req.questionId.length === 0) {
    return false;
  }
  
  // content validation (same as question)
  if (typeof req.content !== 'string' || 
      req.content.length < KNOWLEDGE_VALIDATION.MIN_CONTENT_LENGTH ||
      req.content.length > KNOWLEDGE_VALIDATION.MAX_CONTENT_LENGTH) {
    return false;
  }
  
  // tags validation (same as question)
  if (req.tags !== undefined) {
    if (!Array.isArray(req.tags) || 
        !req.tags.every(tag => typeof tag === 'string' && 
                               tag.length >= KNOWLEDGE_VALIDATION.MIN_TAG_LENGTH &&
                               tag.length <= KNOWLEDGE_VALIDATION.MAX_TAG_LENGTH) ||
        req.tags.length > KNOWLEDGE_VALIDATION.MAX_TAGS) {
      return false;
    }
  }
  
  return true;
}

/**
 * Type guard to validate CreateNoteRequest
 */
export function isValidCreateNoteRequest(obj: unknown): obj is CreateNoteRequest {
  if (!obj || typeof obj !== 'object') return false;
  
  const req = obj as Record<string, unknown>;
  
  // content validation
  if (typeof req.content !== 'string' || 
      req.content.length < KNOWLEDGE_VALIDATION.MIN_CONTENT_LENGTH ||
      req.content.length > KNOWLEDGE_VALIDATION.MAX_CONTENT_LENGTH) {
    return false;
  }
  
  // category is optional but must be valid if present
  if (req.category !== undefined && typeof req.category !== 'string') {
    return false;
  }
  
  // relatedIds is optional but must be string array if present
  if (req.relatedIds !== undefined && 
      (!Array.isArray(req.relatedIds) || 
       !req.relatedIds.every(id => typeof id === 'string'))) {
    return false;
  }
  
  return true;
}

/**
 * Validate tag format
 */
export function isValidTag(tag: string): boolean {
  return typeof tag === 'string' && 
         tag.length >= KNOWLEDGE_VALIDATION.MIN_TAG_LENGTH &&
         tag.length <= KNOWLEDGE_VALIDATION.MAX_TAG_LENGTH &&
         /^[a-zA-Z0-9-_]+$/.test(tag); // alphanumeric, hyphens, underscores only
}

/**
 * Knowledge events for event emitter
 */
export interface KnowledgeEvents extends Record<string, unknown> {
  'knowledge:created': { entry: KnowledgeEntry };
  'knowledge:updated': { entry: KnowledgeEntry; previous: KnowledgeEntry };
  'knowledge:deleted': { entryId: string; entry: KnowledgeEntry };
  'knowledge:linked': { questionId: string; answerId: string };
  'knowledge:unlinked': { questionId: string; answerId: string };
  'knowledge:accepted': { questionId: string; answerId: string };
}