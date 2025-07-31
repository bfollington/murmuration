/**
 * File-based search utilities for knowledge entries
 * 
 * This module provides efficient search and listing operations for knowledge
 * entries stored as markdown files in the file-based backend.
 */

import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { 
  KnowledgeEntry, 
  KnowledgeType, 
  EntryStatus,
  KnowledgeQuery,
  KNOWLEDGE_ROOT,
  STATUS_FOLDERS,
  TYPE_PREFIXES
} from './types.ts';
import { 
  KNOWLEDGE_FILE_EXTENSION,
  CROSS_REFERENCE_PATTERN 
} from './file-format.ts';
import { 
  parseMarkdownFile, 
  convertFrontmatterDates, 
  validateParsedEntry 
} from './file-io.ts';

/**
 * Search result with file path information
 */
export interface SearchResult {
  entry: KnowledgeEntry;
  filePath: string;
  score?: number; // For relevance ranking
}

/**
 * List options for entry enumeration
 */
export interface ListOptions {
  type?: KnowledgeType;
  status?: EntryStatus;
  tags?: string[];
  processId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'timestamp' | 'lastUpdated' | 'type' | 'id';
  sortOrder?: 'asc' | 'desc';
  includeContent?: boolean; // Whether to load full content or just metadata
}

/**
 * Text search options
 */
export interface TextSearchOptions extends ListOptions {
  query: string;
  searchFields?: ('content' | 'tags' | 'metadata')[];
  caseSensitive?: boolean;
  exactMatch?: boolean;
}

/**
 * Search entries across all knowledge files
 * 
 * @param options - Search options including query and filters
 * @returns Array of matching entries with relevance scores
 */
export async function searchEntries(options: TextSearchOptions): Promise<SearchResult[]> {
  const {
    query,
    searchFields = ['content', 'tags'],
    caseSensitive = false,
    exactMatch = false,
    ...listOptions
  } = options;

  // Get all entries first
  const allEntries = await listEntries(listOptions);
  const results: SearchResult[] = [];

  // Prepare search query
  const searchQuery = caseSensitive ? query : query.toLowerCase();
  
  for (const result of allEntries) {
    let score = 0;
    let matchFound = false;

    // Search in content
    if (searchFields.includes('content')) {
      const content = caseSensitive ? result.entry.content : result.entry.content.toLowerCase();
      if (exactMatch ? content === searchQuery : content.includes(searchQuery)) {
        matchFound = true;
        // Higher score for title matches (first line usually)
        const lines = content.split('\n');
        if (lines.length > 0) {
          const firstLine = lines[0];
          if (firstLine.includes(searchQuery)) {
            score += 10;
          }
        }
        // Count occurrences for relevance
        const matches = content.match(new RegExp(escapeRegExp(searchQuery), 'gi'));
        score += (matches?.length || 0);
      }
    }

    // Search in tags
    if (searchFields.includes('tags') && result.entry.tags.length > 0) {
      for (const tag of result.entry.tags) {
        const tagContent = caseSensitive ? tag : tag.toLowerCase();
        if (exactMatch ? tagContent === searchQuery : tagContent.includes(searchQuery)) {
          matchFound = true;
          score += 5; // Tags are highly relevant
        }
      }
    }

    // Search in metadata
    if (searchFields.includes('metadata') && result.entry.metadata) {
      const metadataString = JSON.stringify(result.entry.metadata);
      const metadataContent = caseSensitive ? metadataString : metadataString.toLowerCase();
      if (exactMatch ? metadataContent === searchQuery : metadataContent.includes(searchQuery)) {
        matchFound = true;
        score += 2;
      }
    }

    if (matchFound) {
      results.push({
        ...result,
        score
      });
    }
  }

  // Sort by relevance score (descending)
  results.sort((a, b) => (b.score || 0) - (a.score || 0));

  return results;
}

/**
 * List entries with filtering and pagination
 * 
 * @param options - Listing options
 * @returns Array of matching entries
 */
export async function listEntries(options: ListOptions = {}): Promise<SearchResult[]> {
  const {
    type,
    status,
    tags,
    processId,
    limit,
    offset = 0,
    sortBy = 'lastUpdated',
    sortOrder = 'desc',
    includeContent = true
  } = options;

  const results: SearchResult[] = [];
  const statusFolders = status ? [STATUS_FOLDERS[status]] : Object.values(STATUS_FOLDERS);

  // Scan through relevant status folders
  for (const statusFolder of statusFolders) {
    const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
    
    try {
      for await (const entry of Deno.readDir(folderPath)) {
        if (!entry.isFile || !entry.name.endsWith(KNOWLEDGE_FILE_EXTENSION)) {
          continue;
        }

        const filePath = join(folderPath, entry.name);
        
        // Quick filter by type using filename prefix
        if (type) {
          const prefix = TYPE_PREFIXES[type];
          const basename = entry.name.slice(0, -KNOWLEDGE_FILE_EXTENSION.length);
          if (!basename.startsWith(prefix)) {
            continue;
          }
        }

        try {
          const knowledgeEntry = await loadEntryFromFile(filePath, includeContent);
          
          // Apply filters
          if (!matchesFilters(knowledgeEntry, { type, status, tags, processId })) {
            continue;
          }

          results.push({
            entry: knowledgeEntry,
            filePath
          });
        } catch (error) {
          // Skip invalid files but log error
          console.warn(`Failed to load knowledge entry from ${filePath}:`, error);
          continue;
        }
      }
    } catch (error) {
      // Folder might not exist, continue with next folder
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(`Failed to read directory ${folderPath}:`, error);
      }
    }
  }

  // Sort results
  results.sort((a, b) => {
    let aValue: any, bValue: any;
    
    switch (sortBy) {
      case 'timestamp':
        aValue = a.entry.timestamp.getTime();
        bValue = b.entry.timestamp.getTime();
        break;
      case 'lastUpdated':
        aValue = a.entry.lastUpdated.getTime();
        bValue = b.entry.lastUpdated.getTime();
        break;
      case 'type':
        aValue = a.entry.type;
        bValue = b.entry.type;
        break;
      case 'id':
        aValue = a.entry.id;
        bValue = b.entry.id;
        break;
      default:
        aValue = a.entry.lastUpdated.getTime();
        bValue = b.entry.lastUpdated.getTime();
    }

    if (sortOrder === 'asc') {
      return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
    } else {
      return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
    }
  });

  // Apply pagination
  const start = Math.max(0, offset);
  const end = limit ? start + limit : results.length;
  
  return results.slice(start, end);
}

/**
 * Get all file paths for knowledge entries
 * 
 * @param statusFilter - Optional status to filter by
 * @returns Array of file paths
 */
export async function getAllFilePaths(statusFilter?: EntryStatus): Promise<string[]> {
  const paths: string[] = [];
  const statusFolders = statusFilter ? [STATUS_FOLDERS[statusFilter]] : Object.values(STATUS_FOLDERS);

  for (const statusFolder of statusFolders) {
    const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
    
    try {
      for await (const entry of Deno.readDir(folderPath)) {
        if (entry.isFile && entry.name.endsWith(KNOWLEDGE_FILE_EXTENSION)) {
          paths.push(join(folderPath, entry.name));
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }

  return paths;
}

/**
 * Find entries by their IDs efficiently
 * 
 * @param ids - Array of entry IDs to find
 * @returns Map of ID to SearchResult
 */
export async function findEntriesById(ids: string[]): Promise<Map<string, SearchResult>> {
  const results = new Map<string, SearchResult>();
  const idSet = new Set(ids);

  if (idSet.size === 0) {
    return results;
  }

  // Scan all files to find matching IDs
  const allPaths = await getAllFilePaths();
  
  for (const filePath of allPaths) {
    // Quick check: does filename match any of our IDs?
    const filename = filePath.split('/').pop() || '';
    const basename = filename.slice(0, -KNOWLEDGE_FILE_EXTENSION.length);
    
    if (idSet.has(basename)) {
      try {
        const entry = await loadEntryFromFile(filePath);
        results.set(entry.id, {
          entry,
          filePath
        });
        
        // Remove found ID from set for efficiency
        idSet.delete(basename);
        
        // Early exit if all IDs found
        if (idSet.size === 0) {
          break;
        }
      } catch (error) {
        console.warn(`Failed to load entry from ${filePath}:`, error);
      }
    }
  }

  return results;
}

/**
 * Count entries matching filters without loading full content
 * 
 * @param filters - Filter criteria
 * @returns Number of matching entries
 */
export async function countEntries(filters: Partial<ListOptions> = {}): Promise<number> {
  const { type, status, tags, processId } = filters;
  let count = 0;
  
  const statusFolders = status ? [STATUS_FOLDERS[status]] : Object.values(STATUS_FOLDERS);

  for (const statusFolder of statusFolders) {
    const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
    
    try {
      for await (const entry of Deno.readDir(folderPath)) {
        if (!entry.isFile || !entry.name.endsWith(KNOWLEDGE_FILE_EXTENSION)) {
          continue;
        }

        // Quick filter by type using filename prefix
        if (type) {
          const prefix = TYPE_PREFIXES[type];
          const basename = entry.name.slice(0, -KNOWLEDGE_FILE_EXTENSION.length);
          if (!basename.startsWith(prefix)) {
            continue;
          }
        }

        // Load and validate the file
        try {
          const filePath = join(folderPath, entry.name);
          const knowledgeEntry = await loadEntryFromFile(filePath, false); // Don't load content
          
          // Apply filters (note: type and status are already filtered above)
          if (matchesFilters(knowledgeEntry, { tags, processId })) {
            count++;
          }
        } catch (error) {
          // Skip invalid files
          continue;
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(`Failed to read directory ${folderPath}:`, error);
      }
    }
  }

  return count;
}

/**
 * Load a knowledge entry from a file
 * 
 * @param filePath - Path to the file
 * @param includeContent - Whether to include the markdown content
 * @returns Parsed knowledge entry
 */
async function loadEntryFromFile(filePath: string, includeContent = true): Promise<KnowledgeEntry> {
  const parsed = await parseMarkdownFile(filePath);
  const frontmatter = convertFrontmatterDates(parsed.frontmatter);
  const content = includeContent ? parsed.content : '';

  if (!validateParsedEntry(frontmatter, content || 'dummy')) {
    throw new Error(`Invalid knowledge entry format in ${filePath}`);
  }

  // Construct the entry object
  const entry: KnowledgeEntry = {
    id: frontmatter.id as string,
    type: frontmatter.type as KnowledgeType,
    content,
    timestamp: frontmatter.timestamp as Date,
    lastUpdated: frontmatter.lastUpdated as Date,
    tags: (frontmatter.tags as string[]) || [],
    status: frontmatter.status as EntryStatus,
    processId: frontmatter.processId as string | undefined,
    metadata: (frontmatter.metadata as Record<string, unknown>) || {}
  };

  // Add type-specific fields
  if (entry.type === KnowledgeType.QUESTION) {
    (entry as any).answered = frontmatter.answered as boolean;
    (entry as any).answerIds = (frontmatter.answerIds as string[]) || [];
    (entry as any).priority = frontmatter.priority as string | undefined;
  } else if (entry.type === KnowledgeType.ANSWER) {
    (entry as any).questionId = frontmatter.questionId as string;
    (entry as any).accepted = frontmatter.accepted as boolean;
    (entry as any).votes = frontmatter.votes as number | undefined;
  } else if (entry.type === KnowledgeType.NOTE) {
    (entry as any).category = frontmatter.category as string | undefined;
    (entry as any).relatedIds = (frontmatter.relatedIds as string[]) || [];
  } else if (entry.type === KnowledgeType.ISSUE) {
    (entry as any).priority = frontmatter.priority as string;
    (entry as any).assignee = frontmatter.assignee as string | undefined;
    (entry as any).dueDate = frontmatter.dueDate as Date | undefined;
    (entry as any).relatedIds = (frontmatter.relatedIds as string[]) || [];
  }

  return entry;
}

/**
 * Check if an entry matches the given filters
 * 
 * @param entry - Knowledge entry to check
 * @param filters - Filter criteria
 * @returns True if entry matches all filters
 */
function matchesFilters(
  entry: KnowledgeEntry, 
  filters: Partial<Pick<ListOptions, 'type' | 'status' | 'tags' | 'processId'>>
): boolean {
  const { type, status, tags, processId } = filters;

  if (type && entry.type !== type) {
    return false;
  }

  if (status && entry.status !== status) {
    return false;
  }

  if (processId && entry.processId !== processId) {
    return false;
  }

  if (tags && tags.length > 0) {
    // Entry must have all specified tags
    for (const tag of tags) {
      if (!entry.tags.includes(tag)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Escape special regex characters in a string
 * 
 * @param string - String to escape
 * @returns Escaped string safe for regex
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get statistics about knowledge entry distribution
 * 
 * @returns Statistics object with counts and breakdowns
 */
export async function getFileStatistics(): Promise<{
  totalFiles: number;
  byType: Record<KnowledgeType, number>;
  byStatus: Record<EntryStatus, number>;
  byFolder: Record<string, number>;
}> {
  const stats = {
    totalFiles: 0,
    byType: {
      [KnowledgeType.QUESTION]: 0,
      [KnowledgeType.ANSWER]: 0,
      [KnowledgeType.NOTE]: 0,
      [KnowledgeType.ISSUE]: 0
    },
    byStatus: {
      [EntryStatus.OPEN]: 0,
      [EntryStatus.IN_PROGRESS]: 0,
      [EntryStatus.COMPLETED]: 0,
      [EntryStatus.ARCHIVED]: 0
    },
    byFolder: {} as Record<string, number>
  };

  for (const [status, statusFolder] of Object.entries(STATUS_FOLDERS)) {
    const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
    let folderCount = 0;
    
    try {
      for await (const entry of Deno.readDir(folderPath)) {
        if (entry.isFile && entry.name.endsWith(KNOWLEDGE_FILE_EXTENSION)) {
          stats.totalFiles++;
          folderCount++;
          stats.byStatus[status as EntryStatus]++;

          // Determine type from filename prefix
          const basename = entry.name.slice(0, -KNOWLEDGE_FILE_EXTENSION.length);
          for (const [type, prefix] of Object.entries(TYPE_PREFIXES)) {
            if (basename.startsWith(prefix)) {
              stats.byType[type as KnowledgeType]++;
              break;
            }
          }
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        console.warn(`Failed to read directory ${folderPath}:`, error);
      }
    }

    stats.byFolder[statusFolder] = folderCount;
  }

  return stats;
}