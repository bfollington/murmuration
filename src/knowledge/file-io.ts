/**
 * File I/O utilities for knowledge entries
 * 
 * This module provides utilities for reading and writing knowledge entries
 * as markdown files with YAML frontmatter in the file-based backend.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "https://deno.land/std@0.208.0/yaml/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { 
  KnowledgeEntry, 
  KnowledgeType, 
  EntryStatus,
  KNOWLEDGE_ROOT,
  STATUS_FOLDERS,
  TYPE_PREFIXES,
  Issue,
  Milestone
} from './types.ts';
import { 
  CROSS_REFERENCE_PATTERN, 
  KNOWLEDGE_FILE_EXTENSION,
  FRONTMATTER_DELIMITER 
} from './file-format.ts';

/**
 * Parsed markdown file result
 */
export interface ParsedMarkdownFile {
  frontmatter: Record<string, unknown>;
  content: string;
}

/**
 * Cross-reference found in content
 */
export interface CrossReference {
  id: string;
  type: KnowledgeType;
  position: number;
  length: number;
}

/**
 * Parse a markdown file with YAML frontmatter
 * 
 * @param path - Path to the markdown file
 * @returns Parsed frontmatter and content
 */
export async function parseMarkdownFile(path: string): Promise<ParsedMarkdownFile> {
  const content = await Deno.readTextFile(path);
  
  // Check if file starts with frontmatter delimiter
  if (!content.startsWith(FRONTMATTER_DELIMITER)) {
    throw new Error(`Invalid markdown file format: missing frontmatter in ${path}`);
  }
  
  // Find the closing frontmatter delimiter
  const lines = content.split('\n');
  let frontmatterEndIndex = -1;
  
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      frontmatterEndIndex = i;
      break;
    }
  }
  
  if (frontmatterEndIndex === -1) {
    throw new Error(`Invalid markdown file format: unclosed frontmatter in ${path}`);
  }
  
  // Extract frontmatter and content
  const frontmatterLines = lines.slice(1, frontmatterEndIndex);
  const contentLines = lines.slice(frontmatterEndIndex + 1);
  
  const frontmatterText = frontmatterLines.join('\n');
  const markdownContent = contentLines.join('\n').trim();
  
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseYaml(frontmatterText) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML frontmatter in ${path}: ${message}`);
  }
  
  return {
    frontmatter,
    content: markdownContent
  };
}

/**
 * Serialize a knowledge entry to markdown with YAML frontmatter
 * 
 * @param entry - Knowledge entry to serialize
 * @returns Markdown string with frontmatter
 */
export function serializeToMarkdown(entry: KnowledgeEntry): string {
  // Create frontmatter object (copy to avoid mutation)
  const frontmatter = {
    id: entry.id,
    type: entry.type,
    status: entry.status,
    timestamp: entry.timestamp.toISOString(),
    lastUpdated: entry.lastUpdated.toISOString(),
    tags: [...entry.tags],
    ...(entry.processId && { processId: entry.processId }),
    ...entry.metadata,
  };
  
  // Add type-specific fields
  if (entry.type === KnowledgeType.ISSUE) {
    const issue = entry as Issue;
    (frontmatter as any).priority = issue.priority;
    if (issue.assignee) {
      (frontmatter as any).assignee = issue.assignee;
    }
    if (issue.dueDate) {
      (frontmatter as any).dueDate = issue.dueDate.toISOString();
    }
    if (issue.relatedIds && issue.relatedIds.length > 0) {
      (frontmatter as any).relatedIds = [...issue.relatedIds];
    }
  } else if (entry.type === KnowledgeType.MILESTONE) {
    const milestone = entry as Milestone;
    (frontmatter as any).title = milestone.title;
    if (milestone.targetDate) {
      (frontmatter as any).targetDate = milestone.targetDate.toISOString();
    }
    if (typeof milestone.progress === 'number') {
      (frontmatter as any).progress = milestone.progress;
    }
    if (milestone.relatedIssueIds && milestone.relatedIssueIds.length > 0) {
      (frontmatter as any).relatedIssueIds = [...milestone.relatedIssueIds];
    }
  }
  
  // Generate YAML frontmatter
  const yamlString = stringifyYaml(frontmatter, {
    skipInvalid: true,
    lineWidth: -1 // Disable line wrapping for readability
  }).trim();
  
  // Combine frontmatter and content
  return `${FRONTMATTER_DELIMITER}\n${yamlString}\n${FRONTMATTER_DELIMITER}\n\n${entry.content}`;
}

/**
 * Get the next entry number for a given type
 * 
 * @param type - Knowledge type
 * @returns Next available number for the type
 */
export async function getNextEntryNumber(type: KnowledgeType): Promise<number> {
  const prefix = TYPE_PREFIXES[type];
  let maxNumber = 0;
  
  // Check all status folders for existing entries of this type
  for (const statusFolder of Object.values(STATUS_FOLDERS)) {
    const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
    
    try {
      for await (const entry of Deno.readDir(folderPath)) {
        if (entry.isFile && entry.name.endsWith(KNOWLEDGE_FILE_EXTENSION)) {
          // Extract ID from filename (remove extension)
          const basename = entry.name.slice(0, -KNOWLEDGE_FILE_EXTENSION.length);
          
          if (basename.startsWith(prefix)) {
            const numberPart = basename.slice(prefix.length);
            const number = parseInt(numberPart, 10);
            if (!isNaN(number) && number > maxNumber) {
              maxNumber = number;
            }
          }
        }
      }
    } catch (error) {
      // Folder might not exist yet, that's ok
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
    }
  }
  
  return maxNumber + 1;
}

/**
 * Build the file path for a knowledge entry
 * 
 * @param entry - Knowledge entry
 * @returns File path for the entry
 */
export function buildFilePath(entry: KnowledgeEntry): string {
  const statusFolder = STATUS_FOLDERS[entry.status];
  const filename = `${entry.id}${KNOWLEDGE_FILE_EXTENSION}`;
  return join(KNOWLEDGE_ROOT, statusFolder, filename);
}

/**
 * Parse cross-references from content
 * 
 * @param content - Markdown content to parse
 * @returns Array of cross-references found
 */
export function parseCrossReferences(content: string): CrossReference[] {
  const references: CrossReference[] = [];
  let match: RegExpExecArray | null;
  
  // Reset regex state
  CROSS_REFERENCE_PATTERN.lastIndex = 0;
  
  while ((match = CROSS_REFERENCE_PATTERN.exec(content)) !== null) {
    const id = match[1];
    const position = match.index;
    const length = match[0].length;
    
    // Determine type from ID prefix
    let type: KnowledgeType;
    if (id.startsWith('ISSUE_')) {
      type = KnowledgeType.ISSUE;
    } else if (id.startsWith('MILESTONE_')) {
      type = KnowledgeType.MILESTONE;
    } else {
      // Unknown type, skip
      continue;
    }
    
    references.push({
      id,
      type,
      position,
      length
    });
  }
  
  return references;
}

/**
 * Ensure the knowledge directory structure exists
 */
export async function ensureKnowledgeDirectories(): Promise<void> {
  // Create root knowledge directory
  try {
    await Deno.mkdir(KNOWLEDGE_ROOT, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) {
      throw error;
    }
  }
  
  // Create status folders
  for (const statusFolder of Object.values(STATUS_FOLDERS)) {
    const folderPath = join(KNOWLEDGE_ROOT, statusFolder);
    try {
      await Deno.mkdir(folderPath, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw error;
      }
    }
  }
}

/**
 * Convert frontmatter date strings back to Date objects
 * 
 * @param frontmatter - Parsed frontmatter object
 * @returns Frontmatter with converted dates
 */
export function convertFrontmatterDates(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const converted = { ...frontmatter };
  
  // Convert standard date fields
  if (typeof converted.timestamp === 'string') {
    converted.timestamp = new Date(converted.timestamp);
  }
  if (typeof converted.lastUpdated === 'string') {
    converted.lastUpdated = new Date(converted.lastUpdated);
  }
  if (typeof converted.dueDate === 'string') {
    converted.dueDate = new Date(converted.dueDate);
  }
  if (typeof converted.targetDate === 'string') {
    converted.targetDate = new Date(converted.targetDate);
  }
  
  return converted;
}

/**
 * Validate that a parsed entry has all required fields
 * 
 * @param frontmatter - Parsed frontmatter
 * @param content - Markdown content
 * @returns True if valid
 */
export function validateParsedEntry(
  frontmatter: Record<string, unknown>, 
  content: string
): boolean {
  // Check required fields
  if (!frontmatter.id || typeof frontmatter.id !== 'string') return false;
  if (!frontmatter.type || typeof frontmatter.type !== 'string') return false;
  if (!frontmatter.status || typeof frontmatter.status !== 'string') return false;
  if (!frontmatter.timestamp || !(frontmatter.timestamp instanceof Date)) return false;
  if (!frontmatter.lastUpdated || !(frontmatter.lastUpdated instanceof Date)) return false;
  if (!Array.isArray(frontmatter.tags)) return false;
  if (!content || typeof content !== 'string') return false;
  
  // Validate type
  if (!Object.values(KnowledgeType).includes(frontmatter.type as KnowledgeType)) {
    return false;
  }
  
  // Validate status
  if (!Object.values(EntryStatus).includes(frontmatter.status as EntryStatus)) {
    return false;
  }
  
  return true;
}