/**
 * Fragment Link System Types
 * 
 * Defines types for bidirectional relationships between fragments.
 * Replaces the simple relatedIds array with a more robust system.
 */

import type { Fragment } from './fragment-types.ts';

/**
 * Core link type representing a directed relationship between two fragments
 */
export interface FragmentLink {
  /** Unique identifier for this link */
  id: string;
  
  /** ID of the source fragment (the one creating the link) */
  sourceId: string;
  
  /** ID of the target fragment (the one being linked to) */
  targetId: string;
  
  /** Semantic type of the relationship */
  linkType: FragmentLinkType;
  
  /** When this link was created */
  created: Date;
  
  /** Optional metadata for additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Link types with semantic meaning for different relationship types
 */
export type FragmentLinkType = 
  /** Source fragment answers the target question fragment */
  | 'answers'
  /** Source fragment references target for context or supporting information */
  | 'references'
  /** General relationship without specific semantic meaning */
  | 'related'
  /** Source fragment replaces or updates the target fragment */
  | 'supersedes';

/**
 * LanceDB storage format for fragment links
 * All complex types are serialized to strings for database storage
 */
export interface FragmentLinkRow {
  /** Unique identifier */
  id: string;
  
  /** Source fragment ID */
  sourceId: string;
  
  /** Target fragment ID */
  targetId: string;
  
  /** Link type as string */
  linkType: string;
  
  /** Creation timestamp as ISO string */
  created: string;
  
  /** Metadata as JSON string (optional) */
  metadata?: string;
}

/**
 * Query options for finding links
 */
export interface LinkQuery {
  /** Find links involving this fragment (either as source or target) */
  fragmentId?: string;
  
  /** Find links with this source fragment */
  sourceId?: string;
  
  /** Find links with this target fragment */
  targetId?: string;
  
  /** Filter by link type */
  linkType?: FragmentLinkType;
  
  /** Direction of links to find */
  direction?: LinkDirection;
  
  /** Maximum number of results */
  limit?: number;
  
  /** Skip first N results for pagination */
  offset?: number;
}

/**
 * Direction for link queries
 */
export type LinkDirection = 
  /** Find links where fragment is the source */
  | 'outgoing'
  /** Find links where fragment is the target */
  | 'incoming'
  /** Find links in both directions */
  | 'both';

/**
 * Link with full fragment details loaded
 * Useful when you need both link metadata and fragment content
 */
export interface FragmentLinkWithDetails {
  /** The link relationship */
  link: FragmentLink;
  
  /** Source fragment details (optional, loaded on demand) */
  sourceFragment?: Fragment;
  
  /** Target fragment details (optional, loaded on demand) */
  targetFragment?: Fragment;
}

/**
 * Options for traversing the link graph
 */
export interface LinkTraversalOptions {
  /** Starting fragment ID for traversal */
  startId: string;
  
  /** Only follow links of these types (all types if not specified) */
  linkTypes?: FragmentLinkType[];
  
  /** Direction to traverse */
  direction?: LinkDirection;
  
  /** Maximum depth to prevent infinite loops (default: 10) */
  maxDepth?: number;
  
  /** Whether to load full fragment details for results */
  includeFragments?: boolean;
}

/**
 * Result of link graph traversal
 */
export interface LinkTraversalResult {
  /** All fragments found during traversal */
  fragments: Fragment[];
  
  /** All links traversed */
  links: FragmentLink[];
  
  /** Maximum depth reached */
  depth: number;
  
  /** Whether a cycle was detected during traversal */
  cycleDetected?: boolean;
}

/**
 * Link integrity check result
 */
export interface LinkIntegrityReport {
  /** Total number of links checked */
  totalLinks: number;
  
  /** Links that reference non-existent source fragments */
  orphanedSources: FragmentLink[];
  
  /** Links that reference non-existent target fragments */
  orphanedTargets: FragmentLink[];
  
  /** Duplicate links (same source, target, and type) */
  duplicateLinks: FragmentLink[][];
  
  /** Overall integrity status */
  isHealthy: boolean;
}

// ============================================================================
// Conversion Functions
// ============================================================================

/**
 * Convert a FragmentLink to database row format
 */
export function linkToRow(link: FragmentLink): FragmentLinkRow {
  return {
    id: link.id,
    sourceId: link.sourceId,
    targetId: link.targetId,
    linkType: link.linkType,
    created: link.created.toISOString(),
    metadata: link.metadata ? JSON.stringify(link.metadata) : undefined,
  };
}

/**
 * Convert a database row to FragmentLink format
 */
export function rowToLink(row: FragmentLinkRow): FragmentLink {
  return {
    id: row.id,
    sourceId: row.sourceId,
    targetId: row.targetId,
    linkType: row.linkType as FragmentLinkType,
    created: new Date(row.created),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if a string is a valid FragmentLinkType
 */
export function isValidLinkType(type: string): type is FragmentLinkType {
  const validTypes: FragmentLinkType[] = ['answers', 'references', 'related', 'supersedes'];
  return validTypes.includes(type as FragmentLinkType);
}

/**
 * Type guard to check if a string is a valid LinkDirection
 */
export function isValidLinkDirection(dir: string): dir is LinkDirection {
  const validDirections: LinkDirection[] = ['outgoing', 'incoming', 'both'];
  return validDirections.includes(dir as LinkDirection);
}

/**
 * Type guard to check if an object is a valid FragmentLink
 */
export function isFragmentLink(obj: unknown): obj is FragmentLink {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  
  const link = obj as Record<string, unknown>;
  
  return (
    typeof link.id === 'string' &&
    typeof link.sourceId === 'string' &&
    typeof link.targetId === 'string' &&
    isValidLinkType(link.linkType as string) &&
    link.created instanceof Date &&
    (link.metadata === undefined || typeof link.metadata === 'object')
  );
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a FragmentLink object and return array of error messages
 */
export function validateFragmentLink(link: unknown): string[] {
  const errors: string[] = [];
  
  if (typeof link !== 'object' || link === null) {
    errors.push('Link must be an object');
    return errors;
  }
  
  const l = link as Record<string, unknown>;
  
  // Validate required fields
  if (typeof l.id !== 'string' || l.id.trim() === '') {
    errors.push('Link ID must be a non-empty string');
  }
  
  if (typeof l.sourceId !== 'string' || l.sourceId.trim() === '') {
    errors.push('Source ID must be a non-empty string');
  }
  
  if (typeof l.targetId !== 'string' || l.targetId.trim() === '') {
    errors.push('Target ID must be a non-empty string');
  }
  
  // Check for self-links
  if (l.sourceId === l.targetId) {
    errors.push('Source and target IDs cannot be the same (self-links not allowed)');
  }
  
  if (!isValidLinkType(l.linkType as string)) {
    errors.push(`Link type must be one of: answers, references, related, supersedes`);
  }
  
  if (!(l.created instanceof Date) && typeof l.created !== 'string') {
    errors.push('Created must be a Date object or ISO string');
  }
  
  if (l.created instanceof Date && isNaN(l.created.getTime())) {
    errors.push('Created date is invalid');
  }
  
  // Validate optional metadata
  if (l.metadata !== undefined && 
      (typeof l.metadata !== 'object' || l.metadata === null || Array.isArray(l.metadata))) {
    errors.push('Metadata must be an object if provided');
  }
  
  return errors;
}

/**
 * Validate a LinkQuery object and return array of error messages
 */
export function validateLinkQuery(query: unknown): string[] {
  const errors: string[] = [];
  
  if (typeof query !== 'object' || query === null) {
    errors.push('Query must be an object');
    return errors;
  }
  
  const q = query as Record<string, unknown>;
  
  // All fields are optional, but if provided must be valid
  if (q.fragmentId !== undefined && (typeof q.fragmentId !== 'string' || q.fragmentId.trim() === '')) {
    errors.push('Fragment ID must be a non-empty string if provided');
  }
  
  if (q.sourceId !== undefined && (typeof q.sourceId !== 'string' || q.sourceId.trim() === '')) {
    errors.push('Source ID must be a non-empty string if provided');
  }
  
  if (q.targetId !== undefined && (typeof q.targetId !== 'string' || q.targetId.trim() === '')) {
    errors.push('Target ID must be a non-empty string if provided');
  }
  
  if (q.linkType !== undefined && !isValidLinkType(q.linkType as string)) {
    errors.push('Link type must be one of: answers, references, related, supersedes');
  }
  
  if (q.direction !== undefined && !isValidLinkDirection(q.direction as string)) {
    errors.push('Direction must be one of: outgoing, incoming, both');
  }
  
  if (q.limit !== undefined) {
    if (typeof q.limit !== 'number' || q.limit < 1 || !Number.isInteger(q.limit)) {
      errors.push('Limit must be a positive integer');
    }
  }
  
  if (q.offset !== undefined) {
    if (typeof q.offset !== 'number' || q.offset < 0 || !Number.isInteger(q.offset)) {
      errors.push('Offset must be a non-negative integer');
    }
  }
  
  return errors;
}

/**
 * Validate LinkTraversalOptions and return array of error messages
 */
export function validateLinkTraversalOptions(options: unknown): string[] {
  const errors: string[] = [];
  
  if (typeof options !== 'object' || options === null) {
    errors.push('Options must be an object');
    return errors;
  }
  
  const opts = options as Record<string, unknown>;
  
  // startId is required
  if (typeof opts.startId !== 'string' || opts.startId.trim() === '') {
    errors.push('Start ID must be a non-empty string');
  }
  
  // Optional fields validation
  if (opts.linkTypes !== undefined) {
    if (!Array.isArray(opts.linkTypes)) {
      errors.push('Link types must be an array if provided');
    } else {
      const invalidTypes = opts.linkTypes.filter(type => !isValidLinkType(type as string));
      if (invalidTypes.length > 0) {
        errors.push(`Invalid link types: ${invalidTypes.join(', ')}`);
      }
    }
  }
  
  if (opts.direction !== undefined && !isValidLinkDirection(opts.direction as string)) {
    errors.push('Direction must be one of: outgoing, incoming, both');
  }
  
  if (opts.maxDepth !== undefined) {
    if (typeof opts.maxDepth !== 'number' || opts.maxDepth < 1 || !Number.isInteger(opts.maxDepth)) {
      errors.push('Max depth must be a positive integer');
    }
  }
  
  if (opts.includeFragments !== undefined && typeof opts.includeFragments !== 'boolean') {
    errors.push('Include fragments must be a boolean if provided');
  }
  
  return errors;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique link ID based on source, target, and link type
 * This helps prevent duplicate links while allowing multiple link types between fragments
 */
export function generateLinkId(sourceId: string, targetId: string, linkType: FragmentLinkType): string {
  return `link_${sourceId}_${targetId}_${linkType}`;
}

/**
 * Check if two links are equivalent (same source, target, and type)
 */
export function areLinksEquivalent(link1: FragmentLink, link2: FragmentLink): boolean {
  return (
    link1.sourceId === link2.sourceId &&
    link1.targetId === link2.targetId &&
    link1.linkType === link2.linkType
  );
}

/**
 * Get the inverse direction for a link direction
 */
export function getInverseDirection(direction: LinkDirection): LinkDirection {
  switch (direction) {
    case 'outgoing':
      return 'incoming';
    case 'incoming':
      return 'outgoing';
    case 'both':
      return 'both';
  }
}

/**
 * Check if a link type implies a semantic relationship that should be bidirectional
 */
export function isBidirectionalLinkType(linkType: FragmentLinkType): boolean {
  // 'related' links are typically bidirectional by nature
  // 'references' and 'answers' are directional
  // 'supersedes' is directional (newer supersedes older)
  return linkType === 'related';
}