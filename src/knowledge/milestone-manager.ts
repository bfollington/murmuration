/**
 * Milestone Manager - Business logic layer for milestone operations
 * 
 * Provides high-level milestone management operations including creation,
 * updates, progress tracking, and issue linking. Uses milestone-persistence
 * for storage and follows patterns from ProcessManager and KnowledgeManager.
 */

import { 
  Milestone, 
  CreateMilestoneRequest, 
  KnowledgeType,
  EntryStatus,
  isValidCreateMilestoneRequest 
} from './types.ts';
import { EventEmitter } from '../shared/event-emitter.ts';
import { logger } from '../shared/logger.ts';
import {
  loadMilestone,
  saveMilestone,
  createDefaultMilestone,
  type MilestoneResult
} from './milestone-persistence.ts';

/**
 * Events emitted by the MilestoneManager
 */
interface MilestoneEvents extends Record<string, unknown> {
  'milestone:created': Milestone;
  'milestone:updated': Milestone;
  'milestone:progress_changed': { milestone: Milestone; oldProgress?: number; newProgress?: number };
  'milestone:issue_linked': { milestone: Milestone; issueId: string };
  'milestone:issue_unlinked': { milestone: Milestone; issueId: string };
}

/**
 * MilestoneManager - Core milestone orchestration and lifecycle management
 * 
 * Provides high-level milestone management operations including creation,
 * updating, progress tracking, and cross-referencing with issues.
 */
export class MilestoneManager {
  private readonly events = new EventEmitter<MilestoneEvents>();

  /**
   * Initialize MilestoneManager
   */
  constructor() {
    // No dependencies needed - uses persistence layer directly
  }

  /**
   * Get the current milestone, creating a default one if none exists
   * 
   * @returns Current milestone or error result
   */
  async getCurrentMilestone(): Promise<MilestoneResult<Milestone>> {
    try {
      logger.debug('milestone-manager', 'Loading current milestone');
      
      const result = await loadMilestone();
      
      if (!result.success) {
        return result;
      }
      
      // If no milestone exists, create a default one
      if (!result.data) {
        logger.debug('milestone-manager', 'No milestone found, creating default');
        return await this.createDefaultMilestone();
      }
      
      logger.debug('milestone-manager', `Current milestone loaded: ${result.data.title}`);
      return result;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('milestone-manager', 'Failed to get current milestone', { error: message });
      
      return {
        success: false,
        error: `Failed to get current milestone: ${message}`
      };
    }
  }

  /**
   * Set/update the current milestone from a creation request
   * 
   * @param request - The milestone creation/update request
   * @returns Success/failure result with milestone data
   */
  async setMilestone(request: CreateMilestoneRequest): Promise<MilestoneResult<Milestone>> {
    try {
      // Validate input request
      if (!isValidCreateMilestoneRequest(request)) {
        return {
          success: false,
          error: 'Invalid milestone request: missing required fields (title, description, content)'
        };
      }

      logger.debug('milestone-manager', `Setting milestone: ${request.title}`);

      // Check if milestone already exists
      const currentResult = await loadMilestone();
      const isUpdate = currentResult.success && currentResult.data;
      
      // Generate ID if creating new milestone
      const id = isUpdate ? currentResult.data!.id : this.generateMilestoneId();
      
      // Validate progress if provided
      if (request.progress !== undefined) {
        const progressValidation = this.validateProgress(request.progress);
        if (!progressValidation.valid) {
          return {
            success: false,
            error: progressValidation.error
          };
        }
      }

      // Create milestone object
      const now = new Date();
      const milestone: Milestone = {
        id,
        type: KnowledgeType.MILESTONE,
        content: request.content,
        timestamp: isUpdate ? currentResult.data!.timestamp : now,
        lastUpdated: now,
        tags: request.tags || [],
        status: EntryStatus.OPEN, // Always start as open
        processId: request.processId,
        metadata: request.metadata || {},
        title: request.title,
        description: request.description,
        targetDate: request.targetDate,
        progress: request.progress,
        relatedIssueIds: request.relatedIssueIds || []
      };

      // Save milestone
      const saveResult = await saveMilestone(milestone);
      
      if (!saveResult.success) {
        return {
          success: false,
          error: saveResult.error
        };
      }

      // Emit appropriate event
      if (isUpdate) {
        this.events.emit('milestone:updated', milestone);
        logger.debug('milestone-manager', `Milestone updated: ${milestone.title}`);
      } else {
        this.events.emit('milestone:created', milestone);
        logger.debug('milestone-manager', `Milestone created: ${milestone.title}`);
      }

      return {
        success: true,
        data: milestone
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('milestone-manager', 'Failed to set milestone', { error: message });
      
      return {
        success: false,
        error: `Failed to set milestone: ${message}`
      };
    }
  }

  /**
   * Update only the progress of the current milestone
   * 
   * @param progress - Progress percentage (0-100)
   * @returns Success/failure result with updated milestone
   */
  async updateMilestoneProgress(progress: number): Promise<MilestoneResult<Milestone>> {
    try {
      // Validate progress value
      const progressValidation = this.validateProgress(progress);
      if (!progressValidation.valid) {
        return {
          success: false,
          error: progressValidation.error
        };
      }

      logger.debug('milestone-manager', `Updating milestone progress to ${progress}%`);

      // Get current milestone
      const currentResult = await this.getCurrentMilestone();
      if (!currentResult.success || !currentResult.data) {
        return {
          success: false,
          error: 'No milestone exists to update progress'
        };
      }

      const currentMilestone = currentResult.data;
      const oldProgress = currentMilestone.progress;

      // Update progress and lastUpdated timestamp
      const updatedMilestone: Milestone = {
        ...currentMilestone,
        progress,
        lastUpdated: new Date()
      };

      // Update status based on progress
      if (progress >= 100) {
        updatedMilestone.status = EntryStatus.COMPLETED;
      } else if (progress > 0) {
        updatedMilestone.status = EntryStatus.IN_PROGRESS;
      } else {
        updatedMilestone.status = EntryStatus.OPEN;
      }

      // Save updated milestone
      const saveResult = await saveMilestone(updatedMilestone);
      
      if (!saveResult.success) {
        return {
          success: false,
          error: saveResult.error
        };
      }

      // Emit progress change event
      this.events.emit('milestone:progress_changed', {
        milestone: updatedMilestone,
        oldProgress,
        newProgress: progress
      });

      logger.debug('milestone-manager', `Milestone progress updated: ${oldProgress}% -> ${progress}%`);

      return {
        success: true,
        data: updatedMilestone
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('milestone-manager', 'Failed to update milestone progress', { error: message });
      
      return {
        success: false,
        error: `Failed to update milestone progress: ${message}`
      };
    }
  }

  /**
   * Add a related issue to the current milestone
   * 
   * @param issueId - Issue ID to link (format: ISSUE_XXX)
   * @returns Success/failure result with updated milestone
   */
  async addRelatedIssue(issueId: string): Promise<MilestoneResult<Milestone>> {
    try {
      // Validate issue ID format
      if (!this.isValidIssueId(issueId)) {
        return {
          success: false,
          error: `Invalid issue ID format: ${issueId}. Expected format: ISSUE_XXX`
        };
      }

      logger.debug('milestone-manager', `Adding related issue ${issueId} to milestone`);

      // Get current milestone
      const currentResult = await this.getCurrentMilestone();
      if (!currentResult.success || !currentResult.data) {
        return {
          success: false,
          error: 'No milestone exists to add issue to'
        };
      }

      const currentMilestone = currentResult.data;

      // Check if issue is already linked
      if (currentMilestone.relatedIssueIds.includes(issueId)) {
        return {
          success: false,
          error: `Issue ${issueId} is already linked to this milestone`
        };
      }

      // Add issue to related issues list
      const updatedMilestone: Milestone = {
        ...currentMilestone,
        relatedIssueIds: [...currentMilestone.relatedIssueIds, issueId],
        lastUpdated: new Date()
      };

      // Save updated milestone
      const saveResult = await saveMilestone(updatedMilestone);
      
      if (!saveResult.success) {
        return {
          success: false,
          error: saveResult.error
        };
      }

      // Emit issue linked event
      this.events.emit('milestone:issue_linked', {
        milestone: updatedMilestone,
        issueId
      });

      logger.debug('milestone-manager', `Issue ${issueId} linked to milestone`);

      return {
        success: true,
        data: updatedMilestone
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('milestone-manager', 'Failed to add related issue', { 
        error: message,
        issueId 
      });
      
      return {
        success: false,
        error: `Failed to add related issue: ${message}`
      };
    }
  }

  /**
   * Remove a related issue from the current milestone
   * 
   * @param issueId - Issue ID to unlink
   * @returns Success/failure result with updated milestone
   */
  async removeRelatedIssue(issueId: string): Promise<MilestoneResult<Milestone>> {
    try {
      logger.debug('milestone-manager', `Removing related issue ${issueId} from milestone`);

      // Get current milestone
      const currentResult = await this.getCurrentMilestone();
      if (!currentResult.success || !currentResult.data) {
        return {
          success: false,
          error: 'No milestone exists to remove issue from'
        };
      }

      const currentMilestone = currentResult.data;

      // Check if issue is linked
      if (!currentMilestone.relatedIssueIds.includes(issueId)) {
        return {
          success: false,
          error: `Issue ${issueId} is not linked to this milestone`
        };
      }

      // Remove issue from related issues list
      const updatedMilestone: Milestone = {
        ...currentMilestone,
        relatedIssueIds: currentMilestone.relatedIssueIds.filter(id => id !== issueId),
        lastUpdated: new Date()
      };

      // Save updated milestone
      const saveResult = await saveMilestone(updatedMilestone);
      
      if (!saveResult.success) {
        return {
          success: false,
          error: saveResult.error
        };
      }

      // Emit issue unlinked event
      this.events.emit('milestone:issue_unlinked', {
        milestone: updatedMilestone,
        issueId
      });

      logger.debug('milestone-manager', `Issue ${issueId} unlinked from milestone`);

      return {
        success: true,
        data: updatedMilestone
      };

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('milestone-manager', 'Failed to remove related issue', { 
        error: message,
        issueId 
      });
      
      return {
        success: false,
        error: `Failed to remove related issue: ${message}`
      };
    }
  }

  /**
   * Calculate milestone progress based on linked issues (optional helper method)
   * 
   * This is a future enhancement that would require integration with the issue system
   * to automatically calculate progress based on completed vs total linked issues.
   * 
   * @returns Progress calculation result or indication that manual progress is being used
   */
  async getMilestoneProgress(): Promise<{
    calculatedProgress?: number;
    manualProgress?: number;
    totalIssues: number;
    completedIssues: number;
    useCalculated: boolean;
  }> {
    try {
      const currentResult = await this.getCurrentMilestone();
      if (!currentResult.success || !currentResult.data) {
        return {
          totalIssues: 0,
          completedIssues: 0,
          useCalculated: false
        };
      }

      const milestone = currentResult.data;
      const totalIssues = milestone.relatedIssueIds.length;

      // For now, we don't have access to the issue system to check completion status
      // This would require injecting an IssueManager or FileKnowledgeManager
      // For the current implementation, we'll just return the manual progress
      
      return {
        manualProgress: milestone.progress,
        totalIssues,
        completedIssues: 0, // Would need issue system integration
        useCalculated: false
      };

    } catch (error) {
      logger.error('milestone-manager', 'Failed to calculate milestone progress', { error });
      return {
        totalIssues: 0,
        completedIssues: 0,
        useCalculated: false
      };
    }
  }

  /**
   * Get event emitter for subscribing to milestone events
   * 
   * @returns EventEmitter instance for milestone events
   */
  getEventEmitter(): EventEmitter<MilestoneEvents> {
    return this.events;
  }

  /**
   * Create a default milestone if none exists
   * 
   * @returns Result with default milestone
   * @private
   */
  private async createDefaultMilestone(): Promise<MilestoneResult<Milestone>> {
    try {
      logger.debug('milestone-manager', 'Creating default milestone');
      
      const result = await createDefaultMilestone();
      
      if (result.success && result.data) {
        this.events.emit('milestone:created', result.data);
      }
      
      return result;
      
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('milestone-manager', 'Failed to create default milestone', { error: message });
      
      return {
        success: false,
        error: `Failed to create default milestone: ${message}`
      };
    }
  }

  /**
   * Generate a unique milestone ID
   * 
   * @returns Unique milestone identifier
   * @private
   */
  private generateMilestoneId(): string {
    // Generate timestamp-based ID for uniqueness
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `MILESTONE_${timestamp}_${random}`;
  }

  /**
   * Validate progress value
   * 
   * @param progress - Progress value to validate
   * @returns Validation result
   * @private
   */
  private validateProgress(progress: number): { valid: boolean; error?: string } {
    if (typeof progress !== 'number') {
      return {
        valid: false,
        error: 'Progress must be a number'
      };
    }

    if (isNaN(progress)) {
      return {
        valid: false,
        error: 'Progress cannot be NaN'
      };
    }

    if (progress < 0 || progress > 100) {
      return {
        valid: false,
        error: 'Progress must be between 0 and 100'
      };
    }

    return { valid: true };
  }

  /**
   * Validate issue ID format
   * 
   * @param issueId - Issue ID to validate
   * @returns True if valid issue ID format
   * @private
   */
  private isValidIssueId(issueId: string): boolean {
    if (typeof issueId !== 'string') {
      return false;
    }

    // Check for ISSUE_XXX format where XXX is at least one digit
    const issueIdPattern = /^ISSUE_\d+$/;
    return issueIdPattern.test(issueId);
  }
}

// Create and export default instance for convenience
export const milestoneManager = new MilestoneManager();