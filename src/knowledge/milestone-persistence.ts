/**
 * Milestone Persistence Module
 * 
 * This module provides persistence functions for milestone data using the file-based
 * backend. Milestones are stored in .knowledge/GOAL.md as a single milestone
 * entry that tracks overall project progress and goals.
 * 
 * The persistence layer handles:
 * - Reading milestone data from GOAL.md
 * - Writing milestone data with atomic operations
 * - Creating default milestone if none exists
 * - Error handling for corrupted or missing files
 */

import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { 
  Milestone, 
  KnowledgeType, 
  EntryStatus,
  KNOWLEDGE_ROOT,
  isValidCreateMilestoneRequest,
  CreateMilestoneRequest
} from './types.ts';
import { 
  parseMarkdownFile, 
  serializeToMarkdown, 
  convertFrontmatterDates,
  validateParsedEntry,
  ensureKnowledgeDirectories
} from './file-io.ts';
import { logger } from '../shared/logger.ts';

/**
 * Milestone file path constant
 */
const MILESTONE_FILENAME = 'GOAL.md';

/**
 * Result type for milestone operations
 */
export interface MilestoneResult<T = Milestone> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Get the canonical path to the milestone file
 * 
 * @returns Absolute path to GOAL.md file
 */
export function getMilestoneFilePath(): string {
  return join(KNOWLEDGE_ROOT, MILESTONE_FILENAME);
}

/**
 * Load milestone data from the GOAL.md file
 * 
 * @returns Milestone data or undefined if not found
 */
export async function loadMilestone(): Promise<MilestoneResult<Milestone>> {
  try {
    const filePath = getMilestoneFilePath();
    
    // Check if file exists
    try {
      await Deno.stat(filePath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        logger.debug('milestone-persistence', 'No milestone file found, returning undefined');
        return { success: true, data: undefined };
      }
      throw error;
    }
    
    // Parse the markdown file
    const parsed = await parseMarkdownFile(filePath);
    const frontmatter = convertFrontmatterDates(parsed.frontmatter);
    
    // Validate the parsed entry
    if (!validateParsedEntry(frontmatter, parsed.content)) {
      return {
        success: false,
        error: 'Invalid milestone format: missing or invalid required fields'
      };
    }
    
    // Validate that it's actually a milestone
    if (frontmatter.type !== KnowledgeType.MILESTONE) {
      return {
        success: false,
        error: `Expected milestone type, got: ${frontmatter.type}`
      };
    }
    
    // Extract milestone-specific fields and metadata
    const {
      id,
      type,
      status,
      timestamp,
      lastUpdated,
      tags,
      processId,
      title,
      targetDate,
      progress,
      relatedIssueIds,
      ...metadata // Everything else goes into metadata
    } = frontmatter;

    // Construct milestone object
    const milestone: Milestone = {
      id: id as string,
      type: KnowledgeType.MILESTONE,
      content: parsed.content,
      timestamp: timestamp as Date,
      lastUpdated: lastUpdated as Date,
      tags: tags as string[],
      status: status as EntryStatus,
      processId: processId as string | undefined,
      metadata: metadata as Record<string, unknown>,
      title: title as string,
      description: parsed.content, // Use content as description
      targetDate: targetDate as Date | undefined,
      progress: progress as number | undefined,
      relatedIssueIds: (relatedIssueIds as string[]) || []
    };
    
    logger.debug('milestone-persistence', `Successfully loaded milestone: ${milestone.id} - ${milestone.title}`);
    return { success: true, data: milestone };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('milestone-persistence', 'Failed to load milestone', { error: message });
    
    if (error instanceof Deno.errors.PermissionDenied) {
      return {
        success: false,
        error: 'Permission denied: cannot read milestone file'
      };
    }
    
    if (message.includes('Invalid YAML frontmatter')) {
      return {
        success: false,
        error: 'Corrupted milestone file: invalid YAML frontmatter'
      };
    }
    
    if (message.includes('Invalid markdown file format')) {
      return {
        success: false,
        error: 'Corrupted milestone file: invalid format'
      };
    }
    
    return {
      success: false,
      error: `Failed to load milestone: ${message}`
    };
  }
}

/**
 * Save milestone data to the GOAL.md file using atomic operations
 * 
 * @param milestone - Milestone data to save
 */
export async function saveMilestone(milestone: Milestone): Promise<MilestoneResult<void>> {
  try {
    // Ensure knowledge directories exist
    await ensureKnowledgeDirectories();
    
    const filePath = getMilestoneFilePath();
    const tempPath = `${filePath}.tmp`;
    
    // Serialize milestone to markdown
    const markdown = serializeToMarkdown(milestone);
    
    // Write to temporary file first (atomic write pattern)
    await Deno.writeTextFile(tempPath, markdown);
    
    // Rename temp file to actual file (atomic operation)
    await Deno.rename(tempPath, filePath);
    
    logger.debug('milestone-persistence', `Successfully saved milestone: ${milestone.id} - ${milestone.title} (${milestone.progress}%)`);
    
    return { success: true };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('milestone-persistence', 'Failed to save milestone', { error: message, milestone: milestone.id });
    
    // Clean up temp file if it exists
    try {
      const tempPath = `${getMilestoneFilePath()}.tmp`;
      await Deno.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    
    if (error instanceof Deno.errors.PermissionDenied) {
      return {
        success: false,
        error: 'Permission denied: cannot write milestone file'
      };
    }
    
    // Note: Deno.errors.NoSpace doesn't exist, but we can check for similar errors
    if (message.includes('No space left') || message.includes('ENOSPC')) {
      return {
        success: false,
        error: 'Disk full: cannot save milestone file'
      };
    }
    
    return {
      success: false,
      error: `Failed to save milestone: ${message}`
    };
  }
}

/**
 * Create a default milestone if none exists
 * 
 * @param request - Optional milestone creation request to override defaults
 * @returns Created milestone or error
 */
export async function createDefaultMilestone(request?: Partial<CreateMilestoneRequest>): Promise<MilestoneResult<Milestone>> {
  try {
    // Check if milestone already exists
    const existing = await loadMilestone();
    if (existing.success && existing.data) {
      return {
        success: false,
        error: 'Milestone already exists'
      };
    }
    
    // Create default milestone request
    const defaultRequest: CreateMilestoneRequest = {
      title: request?.title || 'Project Milestone',
      description: request?.description || 'Track overall project progress and goals',
      content: request?.content || 'This milestone tracks the overall progress of the project.\n\n## Goals\n\nDefine your project goals here.\n\n## Progress\n\nTrack your progress towards completion.',
      tags: request?.tags || ['milestone', 'project'],
      processId: request?.processId,
      targetDate: request?.targetDate,
      progress: request?.progress || 0,
      relatedIssueIds: request?.relatedIssueIds || [],
      metadata: request?.metadata || {}
    };
    
    // Validate the request
    if (!isValidCreateMilestoneRequest(defaultRequest)) {
      return {
        success: false,
        error: 'Invalid default milestone request'
      };
    }
    
    // Create milestone object
    const milestone: Milestone = {
      id: 'MILESTONE_1',
      type: KnowledgeType.MILESTONE,
      content: defaultRequest.content,
      timestamp: new Date(),
      lastUpdated: new Date(),
      tags: defaultRequest.tags || [],
      status: EntryStatus.OPEN,
      processId: defaultRequest.processId,
      metadata: defaultRequest.metadata || {},
      title: defaultRequest.title,
      description: defaultRequest.description,
      targetDate: defaultRequest.targetDate,
      progress: defaultRequest.progress,
      relatedIssueIds: defaultRequest.relatedIssueIds || []
    };
    
    // Save the milestone
    const saveResult = await saveMilestone(milestone);
    if (!saveResult.success) {
      return { success: false, error: saveResult.error };
    }
    
    logger.info('milestone-persistence', `Created default milestone: ${milestone.id} - ${milestone.title}`);
    
    return { success: true, data: milestone };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('milestone-persistence', 'Failed to create default milestone', { error: message });
    
    return {
      success: false,
      error: `Failed to create default milestone: ${message}`
    };
  }
}

/**
 * Check if milestone file exists
 * 
 * @returns True if milestone file exists, false otherwise
 */
export async function milestoneExists(): Promise<boolean> {
  try {
    const filePath = getMilestoneFilePath();
    await Deno.stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    // Re-throw other errors (permission, etc.)
    throw error;
  }
}

/**
 * Delete the milestone file
 * 
 * @returns Result of deletion operation
 */
export async function deleteMilestone(): Promise<MilestoneResult<void>> {
  try {
    const filePath = getMilestoneFilePath();
    
    // Check if file exists first
    const exists = await milestoneExists();
    if (!exists) {
      return {
        success: false,
        error: 'Milestone file does not exist'
      };
    }
    
    await Deno.remove(filePath);
    
    logger.info('milestone-persistence', 'Successfully deleted milestone file');
    return { success: true };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('milestone-persistence', 'Failed to delete milestone', { error: message });
    
    if (error instanceof Deno.errors.PermissionDenied) {
      return {
        success: false,
        error: 'Permission denied: cannot delete milestone file'
      };
    }
    
    return {
      success: false,
      error: `Failed to delete milestone: ${message}`
    };
  }
}