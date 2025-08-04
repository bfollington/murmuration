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