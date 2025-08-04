/**
 * File-based Issue Manager Implementation
 * 
 * This module provides a file-based implementation for managing issues,
 * storing each issue as a markdown file with YAML frontmatter.
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
  Issue,
  KnowledgeType,
  EntryStatus,
  KnowledgeQuery,
  KnowledgeStats,
  CreateIssueRequest,
  UpdateKnowledgeRequest,
  KnowledgeResult,
  KnowledgeEvents,
  isValidCreateIssueRequest,
  isValidTag,
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
  getNextEntryNumber,
  ParsedMarkdownFile
} from './file-io.ts';
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

/**
 * File-based Knowledge Manager for Issues
 * 
 * Provides CRUD operations for issues with file-based persistence.
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
  private async findEntryFile(id: string): Promise<string | null> {
    for (const status of Object.values(EntryStatus)) {
      const filePath = this.buildFilePathForStatus(id, status);
      try {
        await Deno.stat(filePath);
        return filePath;
      } catch {
        // File doesn't exist in this status folder, continue
      }
    }
    return null;
  }

  /**
   * Create a new issue
   */
  async createIssue(request: CreateIssueRequest): Promise<KnowledgeResult<Issue>> {
    try {
      await this.ensureInitialized();

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

      // Create issue entry
      const issue: Issue = {
        id: await this.generateEntryId(KnowledgeType.ISSUE),
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

      // Write to file
      const filePath = buildFilePath(issue);
      const markdown = serializeToMarkdown(issue);
      await Deno.writeTextFile(filePath, markdown);

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
   * Update an issue
   */
  async updateEntry(id: string, updates: UpdateKnowledgeRequest): Promise<KnowledgeResult<KnowledgeEntry>> {
    try {
      await this.ensureInitialized();

      // Find the current file
      const currentFilePath = await this.findEntryFile(id);
      if (!currentFilePath) {
        return { 
          success: false, 
          error: `Issue with ID ${id} not found` 
        };
      }

      // Parse current entry
      let parseResult: ParsedMarkdownFile;
      try {
        parseResult = await parseMarkdownFile(currentFilePath);
      } catch {
        return { 
          success: false, 
          error: 'Failed to parse current issue file' 
        };
      }
      
      if (!parseResult.frontmatter || !parseResult.content) {
        return { 
          success: false, 
          error: 'Failed to parse current issue file' 
        };
      }

      // Convert dates and validate
      const frontmatter = convertFrontmatterDates(parseResult.frontmatter);
      if (!validateParsedEntry(frontmatter, parseResult.content)) {
        return { 
          success: false, 
          error: 'Current issue file is invalid' 
        };
      }

      // Build updated entry
      const current = frontmatter as unknown as Issue;
      const updated: Issue = {
        ...current,
        content: updates.content !== undefined ? updates.content : current.content,
        tags: updates.tags !== undefined ? updates.tags : current.tags,
        status: updates.status !== undefined ? updates.status : current.status,
        priority: updates.priority !== undefined ? updates.priority : current.priority,
        assignee: updates.assignee !== undefined ? updates.assignee : current.assignee,
        dueDate: updates.dueDate !== undefined ? updates.dueDate : current.dueDate,
        relatedIds: updates.relatedIds !== undefined ? updates.relatedIds : current.relatedIds,
        metadata: updates.metadata ? { ...current.metadata, ...updates.metadata } : current.metadata,
        lastUpdated: new Date()
      };

      // Validate tags if updated
      if (updated.tags) {
        for (const tag of updated.tags) {
          if (!isValidTag(tag)) {
            return { 
              success: false, 
              error: `Invalid tag format: ${tag}` 
            };
          }
        }
      }

      // Check if we need to move the file due to status change
      const newFilePath = buildFilePath(updated);
      
      // Write updated entry
      const markdown = serializeToMarkdown(updated);
      await Deno.writeTextFile(newFilePath, markdown);

      // If file path changed, remove old file
      if (currentFilePath !== newFilePath) {
        try {
          await Deno.remove(currentFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }

      // Emit event
      this.events.emit('knowledge:updated', { entry: updated, previous: current });

      return { success: true, data: updated };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Delete an issue
   */
  async deleteEntry(id: string): Promise<KnowledgeResult<void>> {
    try {
      await this.ensureInitialized();

      // Find the current file
      const filePath = await this.findEntryFile(id);
      if (!filePath) {
        return { 
          success: false, 
          error: `Issue with ID ${id} not found` 
        };
      }

      // Parse entry for event
      let entry: Issue | undefined;
      try {
        const parseResult = await parseMarkdownFile(filePath);
        if (parseResult.frontmatter && parseResult.content) {
          const frontmatter = convertFrontmatterDates(parseResult.frontmatter);
          if (validateParsedEntry(frontmatter, parseResult.content)) {
            entry = frontmatter as unknown as Issue;
          }
        }
      } catch {
        // Ignore parse errors for event
      }

      // Remove file
      await Deno.remove(filePath);

      // Emit event
      if (entry) {
        this.events.emit('knowledge:deleted', { entryId: id, entry });
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
   * Get an issue by ID
   */
  async getEntry(id: string): Promise<KnowledgeEntry | undefined> {
    try {
      await this.ensureInitialized();

      const filePath = await this.findEntryFile(id);
      if (!filePath) {
        return undefined;
      }

      let parseResult: ParsedMarkdownFile;
      try {
        parseResult = await parseMarkdownFile(filePath);
      } catch {
        return undefined;
      }
      
      if (!parseResult.frontmatter || !parseResult.content) {
        return undefined;
      }

      const frontmatter = convertFrontmatterDates(parseResult.frontmatter);
      if (!validateParsedEntry(frontmatter, parseResult.content)) {
        return undefined;
      }

      return frontmatter as unknown as KnowledgeEntry;
    } catch {
      return undefined;
    }
  }

  /**
   * Search entries (currently supports issues only)
   */
  async searchEntries(query: KnowledgeQuery): Promise<KnowledgeEntry[]> {
    try {
      await this.ensureInitialized();

      const entries: KnowledgeEntry[] = [];
      
      // Only search issue type
      const statusFolders = query.type === KnowledgeType.ISSUE 
        ? Object.values(EntryStatus).map(status => STATUS_FOLDERS[status])
        : [];

      for (const statusFolder of statusFolders) {
        const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
        
        try {
          for await (const dirEntry of Deno.readDir(folderPath)) {
            if (!dirEntry.isFile || !dirEntry.name.endsWith('.md')) {
              continue;
            }

            const filePath = join(folderPath, dirEntry.name);
            let parseResult: ParsedMarkdownFile;
            try {
              parseResult = await parseMarkdownFile(filePath);
            } catch {
              continue;
            }
            
            if (!parseResult.frontmatter || !parseResult.content) {
              continue;
            }

            const frontmatter = convertFrontmatterDates(parseResult.frontmatter);
            if (!validateParsedEntry(frontmatter, parseResult.content)) {
              continue;
            }

            const entry = frontmatter as unknown as KnowledgeEntry;
            
            // Apply filters
            if (query.tags && query.tags.length > 0) {
              const hasAllTags = query.tags.every(tag => entry.tags.includes(tag));
              if (!hasAllTags) continue;
            }

            if (query.processId && entry.processId !== query.processId) {
              continue;
            }

            if (query.search && !entry.content.toLowerCase().includes(query.search.toLowerCase())) {
              continue;
            }

            entries.push(entry);
          }
        } catch {
          // Folder might not exist, continue
        }
      }

      // Sort entries
      entries.sort((a, b) => {
        const sortBy = query.sortBy || 'timestamp';
        const order = query.sortOrder || 'desc';
        
        let comparison = 0;
        if (sortBy === 'timestamp') {
          comparison = a.timestamp.getTime() - b.timestamp.getTime();
        } else if (sortBy === 'lastUpdated') {
          comparison = a.lastUpdated.getTime() - b.lastUpdated.getTime();
        } else if (sortBy === 'type') {
          comparison = a.type.localeCompare(b.type);
        }
        
        return order === 'asc' ? comparison : -comparison;
      });

      // Apply pagination
      const start = query.offset || 0;
      const end = query.limit ? start + query.limit : undefined;
      
      return entries.slice(start, end);
    } catch {
      return [];
    }
  }

  /**
   * Get knowledge statistics (issues only)
   */
  async getStatistics(): Promise<KnowledgeStats> {
    try {
      await this.ensureInitialized();

      const stats: KnowledgeStats = {
        totalEntries: 0,
        byType: {
          issues: 0,
          milestones: 0
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
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Scan all status folders for issues
      for (const statusFolder of Object.values(STATUS_FOLDERS)) {
        const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
        
        try {
          for await (const dirEntry of Deno.readDir(folderPath)) {
            if (!dirEntry.isFile || !dirEntry.name.endsWith('.md')) {
              continue;
            }

            const filePath = join(folderPath, dirEntry.name);
            let parseResult: ParsedMarkdownFile;
            try {
              parseResult = await parseMarkdownFile(filePath);
            } catch {
              continue;
            }
            
            if (!parseResult.frontmatter || !parseResult.content) {
              continue;
            }

            const frontmatter = convertFrontmatterDates(parseResult.frontmatter);
            if (!validateParsedEntry(frontmatter, parseResult.content)) {
              continue;
            }

            const entry = frontmatter as unknown as KnowledgeEntry;
            
            // Count by type
            stats.totalEntries++;
            if (entry.type === KnowledgeType.ISSUE) {
              stats.byType.issues++;
            } else if (entry.type === KnowledgeType.MILESTONE) {
              stats.byType.milestones++;
            }

            // Tag frequency
            for (const tag of entry.tags) {
              stats.tagFrequency[tag] = (stats.tagFrequency[tag] || 0) + 1;
            }

            // Process correlation
            if (entry.processId) {
              stats.processCorrelation[entry.processId] = (stats.processCorrelation[entry.processId] || 0) + 1;
            }

            // Time grouping
            const entryTime = entry.timestamp.getTime();
            if (entryTime >= today.getTime()) {
              stats.timeGrouping.today++;
            } else if (entryTime >= weekAgo.getTime()) {
              stats.timeGrouping.thisWeek++;
            } else if (entryTime >= monthAgo.getTime()) {
              stats.timeGrouping.thisMonth++;
            } else {
              stats.timeGrouping.older++;
            }
          }
        } catch {
          // Folder might not exist, continue
        }
      }

      return stats;
    } catch {
      return {
        totalEntries: 0,
        byType: { issues: 0, milestones: 0 },
        tagFrequency: {},
        processCorrelation: {},
        timeGrouping: { today: 0, thisWeek: 0, thisMonth: 0, older: 0 }
      };
    }
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