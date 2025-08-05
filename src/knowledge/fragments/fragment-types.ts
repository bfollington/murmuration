/**
 * Fragment System Types
 * 
 * Defines the core types and interfaces for the LanceDB-based fragment system
 * that replaces the old knowledge tools (questions/answers/notes).
 */

/**
 * Fragment - Core knowledge unit with embedded content
 */
export interface Fragment {
  /** Unique identifier for the fragment */
  id: string;
  
  /** Human-readable title for the fragment */
  title: string;
  
  /** Main content/body of the fragment */
  body: string;
  
  /** Fragment type - can be question, answer, note, or other */
  type: FragmentType;
  
  /** Creation timestamp */
  created: Date;
  
  /** Last modification timestamp */
  updated: Date;
  
  /** Optional tags for categorization */
  tags?: string[];
  
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  
  /** Optional reference to related fragments */
  relatedIds?: string[];
  
  /** Priority level */
  priority?: FragmentPriority;
  
  /** Status of the fragment */
  status?: FragmentStatus;
}

/**
 * Fragment types
 */
export type FragmentType = 
  | 'question'
  | 'answer' 
  | 'note'
  | 'documentation'
  | 'issue'
  | 'solution'
  | 'reference';

/**
 * Fragment priority levels
 */
export type FragmentPriority = 'low' | 'medium' | 'high';

/**
 * Fragment status
 */
export type FragmentStatus = 
  | 'active'
  | 'archived'
  | 'draft';

/**
 * LanceDB row format - what gets stored in the database
 */
export interface FragmentRow {
  [key: string]: unknown;
  
  /** Unique identifier */
  id: string;
  
  /** Title of the fragment */
  title: string;
  
  /** Main content */
  body: string;
  
  /** Fragment type */
  type: string;
  
  /** Creation timestamp as ISO string */
  created: string;
  
  /** Last modification timestamp as ISO string */
  updated: string;
  
  /** Tags as JSON string array */
  tags?: string;
  
  /** Metadata as JSON string */
  metadata?: string;
  
  /** Related fragment IDs as JSON string array */
  relatedIds?: string;
  
  /** Priority level */
  priority?: string;
  
  /** Status */
  status?: string;
  
  /** Embedding vector for similarity search */
  vector: number[];
}

/**
 * Request to create a new fragment
 */
export interface CreateFragmentRequest {
  /** Title of the fragment */
  title: string;
  
  /** Main content */
  body: string;
  
  /** Fragment type */
  type: FragmentType;
  
  /** Optional tags */
  tags?: string[];
  
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  
  /** Optional related fragment IDs */
  relatedIds?: string[];
  
  /** Optional priority */
  priority?: FragmentPriority;
  
  /** Optional status */
  status?: FragmentStatus;
}

/**
 * Request to update an existing fragment
 */
export interface UpdateFragmentRequest {
  /** Fragment ID to update */
  id: string;
  
  /** New title (optional) */
  title?: string;
  
  /** New body content (optional) */
  body?: string;
  
  /** New type (optional) */
  type?: FragmentType;
  
  /** New tags (optional) */
  tags?: string[];
  
  /** New metadata (optional) */
  metadata?: Record<string, unknown>;
  
  /** New related IDs (optional) */
  relatedIds?: string[];
  
  /** New priority (optional) */
  priority?: FragmentPriority;
  
  /** New status (optional) */
  status?: FragmentStatus;
}

/**
 * Time-based filtering options for fragments
 */
export interface TimeFilter {
  /** Filter by creation time */
  created?: { 
    /** Include fragments created after this date (ISO string) */
    after?: string; 
    /** Include fragments created before this date (ISO string) */
    before?: string; 
  };
  
  /** Filter by last updated time */
  updated?: { 
    /** Include fragments updated after this date (ISO string) */
    after?: string; 
    /** Include fragments updated before this date (ISO string) */
    before?: string; 
  };
  
  /** Include fragments from the last N days */
  lastNDays?: number;
}

/**
 * Fragment search/query options
 */
export interface FragmentQuery {
  /** Search by type */
  type?: FragmentType;
  
  /** Search by tags (must have all specified tags) */
  tags?: string[];
  
  /** Search by status */
  status?: FragmentStatus;
  
  /** Search by priority */
  priority?: FragmentPriority;
  
  /** Full-text search in title and body */
  search?: string;
  
  /** Time-based filtering */
  timeFilter?: TimeFilter;
  
  /** Limit number of results */
  limit?: number;
  
  /** Skip first N results */
  offset?: number;
}

/**
 * Fragment similarity search options
 */
export interface FragmentSimilarityQuery {
  /** Query text to find similar fragments */
  query: string;
  
  /** Maximum number of results */
  limit?: number;
  
  /** Minimum similarity score (0-1) */
  threshold?: number;
  
  /** Filter by type */
  type?: FragmentType;
  
  /** Filter by tags */
  tags?: string[];
  
  /** Filter by status */
  status?: FragmentStatus;
  
  /** Time-based filtering */
  timeFilter?: TimeFilter;
}

/**
 * Fragment with similarity score
 */
export interface FragmentWithScore {
  /** The fragment */
  fragment: Fragment;
  
  /** Similarity score (0-1, higher is more similar) */
  score: number;
}

/**
 * Fragment search results
 */
export interface FragmentSearchResults {
  /** Found fragments */
  fragments: Fragment[];
  
  /** Total count (before limit/offset) */
  total: number;
  
  /** Current offset */
  offset: number;
  
  /** Current limit */
  limit: number;
}

/**
 * Fragment similarity search results
 */
export interface FragmentSimilarityResults {
  /** Found fragments with similarity scores */
  fragments: FragmentWithScore[];
  
  /** Query that was searched */
  query: string;
  
  /** Threshold used */
  threshold: number;
}

/**
 * Advanced fragment query combining multiple search methods
 */
export interface AdvancedFragmentQuery {
  /** Vector similarity search - query text to find similar fragments */
  similarTo?: string;
  
  /** Minimum similarity score for vector search (0-1) */
  similarityThreshold?: number;
  
  /** Full-text search with optional regex support */
  textSearch?: string;
  
  /** Fields to search in for textSearch */
  searchFields?: ('title' | 'body')[];
  
  /** Whether to treat textSearch as regex pattern */
  useRegex?: boolean;
  
  /** Time-based filtering */
  timeFilter?: TimeFilter;
  
  /** Filter by fragment type */
  type?: FragmentType;
  
  /** Filter by status */
  status?: FragmentStatus;
  
  /** Filter by priority */
  priority?: FragmentPriority;
  
  /** Filter by tags (must have all specified tags) */
  tags?: string[];
  
  /** Control whether filters are applied before or after vector search */
  filterMode?: 'pre' | 'post';
  
  /** Maximum number of results */
  limit?: number;
  
  /** Skip first N results for pagination */
  offset?: number;
  
  /** Sort results by specified field */
  sortBy?: 'relevance' | 'created' | 'updated' | 'title';
  
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Advanced fragment search results
 */
export interface AdvancedFragmentResults extends FragmentSearchResults {
  /** Query execution time in milliseconds */
  queryTime?: number;
  
  /** Filter mode that was used */
  filterMode?: 'pre' | 'post';
}

/**
 * Type guards
 */
export function isValidFragmentType(type: string): type is FragmentType {
  const validTypes: FragmentType[] = [
    'question', 'answer', 'note', 'documentation', 
    'issue', 'solution', 'reference'
  ];
  return validTypes.includes(type as FragmentType);
}

export function isValidFragmentPriority(priority: string): priority is FragmentPriority {
  const validPriorities: FragmentPriority[] = ['low', 'medium', 'high'];
  return validPriorities.includes(priority as FragmentPriority);
}

export function isValidFragmentStatus(status: string): status is FragmentStatus {
  const validStatuses: FragmentStatus[] = ['active', 'archived', 'draft'];
  return validStatuses.includes(status as FragmentStatus);
}

/**
 * Type guard for TimeFilter
 */
export function isValidTimeFilter(filter: unknown): filter is TimeFilter {
  if (!filter || typeof filter !== 'object') {
    return false;
  }
  
  const f = filter as Record<string, unknown>;
  
  // Check created filter
  if (f.created !== undefined) {
    if (typeof f.created !== 'object' || f.created === null) {
      return false;
    }
    const created = f.created as Record<string, unknown>;
    if (created.after !== undefined && typeof created.after !== 'string') {
      return false;
    }
    if (created.before !== undefined && typeof created.before !== 'string') {
      return false;
    }
  }
  
  // Check updated filter
  if (f.updated !== undefined) {
    if (typeof f.updated !== 'object' || f.updated === null) {
      return false;
    }
    const updated = f.updated as Record<string, unknown>;
    if (updated.after !== undefined && typeof updated.after !== 'string') {
      return false;
    }
    if (updated.before !== undefined && typeof updated.before !== 'string') {
      return false;
    }
  }
  
  // Check lastNDays
  if (f.lastNDays !== undefined && (typeof f.lastNDays !== 'number' || f.lastNDays < 0)) {
    return false;
  }
  
  return true;
}

/**
 * Validates a TimeFilter and returns validation errors
 */
export function validateTimeFilter(filter: TimeFilter): string[] {
  const errors: string[] = [];
  
  // Validate created dates
  if (filter.created) {
    if (filter.created.after) {
      const afterDate = new Date(filter.created.after);
      if (isNaN(afterDate.getTime())) {
        errors.push('created.after must be a valid ISO date string');
      }
    }
    if (filter.created.before) {
      const beforeDate = new Date(filter.created.before);
      if (isNaN(beforeDate.getTime())) {
        errors.push('created.before must be a valid ISO date string');
      }
    }
    if (filter.created.after && filter.created.before) {
      const after = new Date(filter.created.after);
      const before = new Date(filter.created.before);
      if (after >= before) {
        errors.push('created.after must be before created.before');
      }
    }
  }
  
  // Validate updated dates
  if (filter.updated) {
    if (filter.updated.after) {
      const afterDate = new Date(filter.updated.after);
      if (isNaN(afterDate.getTime())) {
        errors.push('updated.after must be a valid ISO date string');
      }
    }
    if (filter.updated.before) {
      const beforeDate = new Date(filter.updated.before);
      if (isNaN(beforeDate.getTime())) {
        errors.push('updated.before must be a valid ISO date string');
      }
    }
    if (filter.updated.after && filter.updated.before) {
      const after = new Date(filter.updated.after);
      const before = new Date(filter.updated.before);
      if (after >= before) {
        errors.push('updated.after must be before updated.before');
      }
    }
  }
  
  // Validate lastNDays
  if (filter.lastNDays !== undefined) {
    if (filter.lastNDays < 1) {
      errors.push('lastNDays must be greater than 0');
    }
    if (!Number.isInteger(filter.lastNDays)) {
      errors.push('lastNDays must be an integer');
    }
  }
  
  return errors;
}

/**
 * Type guard for AdvancedFragmentQuery
 */
export function isValidAdvancedQuery(query: unknown): query is AdvancedFragmentQuery {
  if (!query || typeof query !== 'object') {
    return false;
  }
  
  const q = query as Record<string, unknown>;
  
  // Check optional string fields
  if (q.similarTo !== undefined && typeof q.similarTo !== 'string') {
    return false;
  }
  if (q.textSearch !== undefined && typeof q.textSearch !== 'string') {
    return false;
  }
  
  // Check numeric fields
  if (q.similarityThreshold !== undefined && 
      (typeof q.similarityThreshold !== 'number' || 
       q.similarityThreshold < 0 || q.similarityThreshold > 1)) {
    return false;
  }
  if (q.limit !== undefined && 
      (typeof q.limit !== 'number' || q.limit < 1)) {
    return false;
  }
  if (q.offset !== undefined && 
      (typeof q.offset !== 'number' || q.offset < 0)) {
    return false;
  }
  
  // Check boolean fields
  if (q.useRegex !== undefined && typeof q.useRegex !== 'boolean') {
    return false;
  }
  
  // Check array fields
  if (q.searchFields !== undefined) {
    if (!Array.isArray(q.searchFields)) {
      return false;
    }
    const validFields = ['title', 'body'];
    if (!q.searchFields.every(field => 
        typeof field === 'string' && validFields.includes(field))) {
      return false;
    }
  }
  
  if (q.tags !== undefined) {
    if (!Array.isArray(q.tags) || !q.tags.every(tag => typeof tag === 'string')) {
      return false;
    }
  }
  
  // Check enum fields
  if (q.type !== undefined && !isValidFragmentType(q.type as string)) {
    return false;
  }
  if (q.status !== undefined && !isValidFragmentStatus(q.status as string)) {
    return false;
  }
  if (q.priority !== undefined && !isValidFragmentPriority(q.priority as string)) {
    return false;
  }
  if (q.filterMode !== undefined && 
      (q.filterMode !== 'pre' && q.filterMode !== 'post')) {
    return false;
  }
  if (q.sortBy !== undefined && 
      !(['relevance', 'created', 'updated', 'title'].includes(q.sortBy as string))) {
    return false;
  }
  if (q.sortOrder !== undefined && 
      (q.sortOrder !== 'asc' && q.sortOrder !== 'desc')) {
    return false;
  }
  
  // Check timeFilter
  if (q.timeFilter !== undefined && !isValidTimeFilter(q.timeFilter)) {
    return false;
  }
  
  return true;
}

/**
 * Validates an AdvancedFragmentQuery and returns validation errors
 */
export function validateAdvancedQuery(query: AdvancedFragmentQuery): string[] {
  const errors: string[] = [];
  
  // Validate similarity threshold
  if (query.similarityThreshold !== undefined) {
    if (query.similarityThreshold < 0 || query.similarityThreshold > 1) {
      errors.push('similarityThreshold must be between 0 and 1');
    }
  }
  
  // Validate pagination
  if (query.limit !== undefined && query.limit < 1) {
    errors.push('limit must be greater than 0');
  }
  if (query.offset !== undefined && query.offset < 0) {
    errors.push('offset must be greater than or equal to 0');
  }
  
  // Validate search fields
  if (query.searchFields !== undefined) {
    const validFields = ['title', 'body'];
    const invalidFields = query.searchFields.filter(field => !validFields.includes(field));
    if (invalidFields.length > 0) {
      errors.push(`Invalid search fields: ${invalidFields.join(', ')}`);
    }
  }
  
  // Validate regex usage
  if (query.useRegex && !query.textSearch) {
    errors.push('useRegex requires textSearch to be specified');
  }
  
  // Validate similarity search
  if (query.similarityThreshold !== undefined && !query.similarTo) {
    errors.push('similarityThreshold requires similarTo to be specified');
  }
  
  // Validate time filter
  if (query.timeFilter) {
    const timeErrors = validateTimeFilter(query.timeFilter);
    errors.push(...timeErrors);
  }
  
  // Validate sortBy/sortOrder combination
  if (query.sortOrder && !query.sortBy) {
    errors.push('sortOrder requires sortBy to be specified');
  }
  
  return errors;
}

/**
 * Fragment utility functions
 */
export function fragmentToRow(fragment: Fragment): FragmentRow {
  return {
    id: fragment.id,
    title: fragment.title,
    body: fragment.body,
    type: fragment.type,
    created: fragment.created.toISOString(),
    updated: fragment.updated.toISOString(),
    tags: fragment.tags ? JSON.stringify(fragment.tags) : undefined,
    metadata: fragment.metadata ? JSON.stringify(fragment.metadata) : undefined,
    relatedIds: fragment.relatedIds ? JSON.stringify(fragment.relatedIds) : undefined,
    priority: fragment.priority,
    status: fragment.status,
    vector: [] // Will be filled by the embedding service
  };
}

export function rowToFragment(row: FragmentRow): Fragment {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    type: row.type as FragmentType,
    created: new Date(row.created),
    updated: new Date(row.updated),
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    relatedIds: row.relatedIds ? JSON.parse(row.relatedIds) : undefined,
    priority: row.priority as FragmentPriority,
    status: row.status as FragmentStatus
  };
}