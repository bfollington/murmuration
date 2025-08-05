/**
 * Fragment Tools
 * 
 * High-level functions for fragment operations that can be used by MCP tools
 * and other parts of the application. Provides a clean interface over the FragmentStore.
 */

import { logger } from '../../shared/logger.ts';
import { 
  Fragment, 
  CreateFragmentRequest, 
  UpdateFragmentRequest,
  FragmentQuery,
  FragmentSimilarityQuery,
  FragmentSearchResults,
  FragmentSimilarityResults,
  FragmentType,
  FragmentPriority,
  FragmentStatus,
  TimeFilter,
  AdvancedFragmentQuery,
  AdvancedFragmentResults
} from './fragment-types.ts';
import { FragmentStore, getFragmentStore } from './fragment-store.ts';

/**
 * Tool response types for consistent MCP integration
 */
export interface FragmentToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}

/**
 * Fragment tools class - provides high-level operations
 */
export class FragmentTools {
  private readonly store: FragmentStore;
  
  constructor(store?: FragmentStore) {
    this.store = store || getFragmentStore();
  }
  
  /**
   * Record a new fragment
   */
  async recordFragment(params: {
    title: string;
    body: string;
    type: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    relatedIds?: string[];
    priority?: string;
    status?: string;
  }): Promise<FragmentToolResult> {
    try {
      // Validate and normalize parameters
      const request: CreateFragmentRequest = {
        title: params.title?.trim(),
        body: params.body?.trim(),
        type: params.type as FragmentType,
        tags: params.tags,
        metadata: params.metadata,
        relatedIds: params.relatedIds,
        priority: params.priority as FragmentPriority,
        status: params.status as FragmentStatus
      };
      
      // Validate required fields
      if (!request.title) {
        return {
          success: false,
          error: 'Title is required and cannot be empty'
        };
      }
      
      if (!request.body) {
        return {
          success: false,
          error: 'Body is required and cannot be empty'
        };
      }
      
      // Create the fragment
      const fragment = await this.store.createFragment(request);
      
      return {
        success: true,
        data: fragment,
        message: `Fragment "${fragment.title}" created successfully with ID ${fragment.id}`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `recordFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * List fragments with filtering
   */
  async listFragments(params: {
    type?: string;
    tags?: string[];
    status?: string;
    priority?: string;
    search?: string;
    timeFilter?: TimeFilter;
    limit?: number;
    offset?: number;
  } = {}): Promise<FragmentToolResult> {
    try {
      const query: FragmentQuery = {
        type: params.type as FragmentType,
        tags: params.tags,
        status: params.status as FragmentStatus,
        priority: params.priority as FragmentPriority,
        search: params.search,
        timeFilter: params.timeFilter,
        limit: params.limit,
        offset: params.offset
      };
      
      const results = await this.store.searchFragments(query);
      
      return {
        success: true,
        data: results,
        message: `Found ${results.fragments.length} fragments`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `listFragments error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Search fragments by exact title match
   */
  async searchFragmentsByTitle(params: {
    title: string;
  }): Promise<FragmentToolResult> {
    try {
      if (!params.title?.trim()) {
        return {
          success: false,
          error: 'Title is required for search'
        };
      }
      
      const fragments = await this.store.searchFragmentsByTitle(params.title.trim());
      
      return {
        success: true,
        data: fragments,
        message: `Found ${fragments.length} fragments with title "${params.title}"`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `searchFragmentsByTitle error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Search fragments by similarity using vector search
   */
  async searchFragmentsSimilar(params: {
    query: string;
    limit?: number;
    threshold?: number;
    type?: string;
    tags?: string[];
    status?: string;
    timeFilter?: TimeFilter;
  }): Promise<FragmentToolResult> {
    try {
      if (!params.query?.trim()) {
        return {
          success: false,
          error: 'Query text is required for similarity search'
        };
      }
      
      const query: FragmentSimilarityQuery = {
        query: params.query.trim(),
        limit: params.limit,
        threshold: params.threshold,
        type: params.type as FragmentType,
        tags: params.tags,
        status: params.status as FragmentStatus,
        timeFilter: params.timeFilter
      };
      
      const results = await this.store.searchFragmentsSimilar(query);
      
      return {
        success: true,
        data: results,
        message: `Found ${results.fragments.length} similar fragments for query "${params.query}"`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `searchFragmentsSimilar error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get a single fragment by ID
   */
  async getFragment(params: {
    id: string;
  }): Promise<FragmentToolResult> {
    try {
      if (!params.id?.trim()) {
        return {
          success: false,
          error: 'Fragment ID is required'
        };
      }
      
      const fragment = await this.store.getFragment(params.id.trim());
      
      if (!fragment) {
        return {
          success: false,
          error: `Fragment with ID ${params.id} not found`
        };
      }
      
      return {
        success: true,
        data: fragment,
        message: `Retrieved fragment "${fragment.title}"`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `getFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Update an existing fragment
   */
  async updateFragment(params: {
    id: string;
    title?: string;
    body?: string;
    type?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    relatedIds?: string[];
    priority?: string;
    status?: string;
  }): Promise<FragmentToolResult> {
    try {
      if (!params.id?.trim()) {
        return {
          success: false,
          error: 'Fragment ID is required'
        };
      }
      
      const request: UpdateFragmentRequest = {
        id: params.id.trim(),
        title: params.title?.trim(),
        body: params.body?.trim(),
        type: params.type as FragmentType,
        tags: params.tags,
        metadata: params.metadata,
        relatedIds: params.relatedIds,
        priority: params.priority as FragmentPriority,
        status: params.status as FragmentStatus
      };
      
      const fragment = await this.store.updateFragment(request);
      
      if (!fragment) {
        return {
          success: false,
          error: `Fragment with ID ${params.id} not found`
        };
      }
      
      return {
        success: true,
        data: fragment,
        message: `Fragment "${fragment.title}" updated successfully`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `updateFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Delete a fragment
   */
  async deleteFragment(params: {
    id: string;
  }): Promise<FragmentToolResult> {
    try {
      if (!params.id?.trim()) {
        return {
          success: false,
          error: 'Fragment ID is required'
        };
      }
      
      const deleted = await this.store.deleteFragment(params.id.trim());
      
      if (!deleted) {
        return {
          success: false,
          error: `Fragment with ID ${params.id} not found`
        };
      }
      
      return {
        success: true,
        message: `Fragment with ID ${params.id} deleted successfully`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `deleteFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Get fragment statistics
   */
  async getFragmentStats(): Promise<FragmentToolResult> {
    try {
      const totalCount = await this.store.getFragmentCount();
      const allFragments = await this.store.getAllFragments();
      
      // Calculate statistics
      const stats = {
        total: totalCount,
        byType: {} as Record<string, number>,
        byStatus: {} as Record<string, number>,
        byPriority: {} as Record<string, number>,
        recent: allFragments
          .sort((a, b) => b.updated.getTime() - a.updated.getTime())
          .slice(0, 5)
          .map(f => ({ id: f.id, title: f.title, updated: f.updated }))
      };
      
      // Count by type
      for (const fragment of allFragments) {
        stats.byType[fragment.type] = (stats.byType[fragment.type] || 0) + 1;
        
        if (fragment.status) {
          stats.byStatus[fragment.status] = (stats.byStatus[fragment.status] || 0) + 1;
        }
        
        if (fragment.priority) {
          stats.byPriority[fragment.priority] = (stats.byPriority[fragment.priority] || 0) + 1;
        }
      }
      
      return {
        success: true,
        data: stats,
        message: `Fragment statistics retrieved`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `getFragmentStats error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Initialize the fragment store
   */
  async initialize(): Promise<FragmentToolResult> {
    try {
      await this.store.initialize();
      
      return {
        success: true,
        message: 'Fragment store initialized successfully'
      };
      
    } catch (error) {
      logger.error('FragmentTools', `initialize error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Advanced fragment search combining multiple search methods
   */
  async searchFragmentsAdvanced(params: {
    similarTo?: string;
    similarityThreshold?: number;
    textSearch?: string;
    searchFields?: ('title' | 'body')[];
    useRegex?: boolean;
    timeFilter?: TimeFilter;
    type?: string;
    status?: string;
    priority?: string;
    tags?: string[];
    filterMode?: 'pre' | 'post';
    limit?: number;
    offset?: number;
    sortBy?: 'relevance' | 'created' | 'updated' | 'title';
    sortOrder?: 'asc' | 'desc';
  }): Promise<FragmentToolResult> {
    try {
      // Build the advanced query
      const query: AdvancedFragmentQuery = {
        similarTo: params.similarTo?.trim(),
        similarityThreshold: params.similarityThreshold,
        textSearch: params.textSearch?.trim(),
        searchFields: params.searchFields,
        useRegex: params.useRegex,
        timeFilter: params.timeFilter,
        type: params.type as FragmentType,
        status: params.status as FragmentStatus,
        priority: params.priority as FragmentPriority,
        tags: params.tags,
        filterMode: params.filterMode,
        limit: params.limit,
        offset: params.offset,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder
      };
      
      // Perform the advanced search
      const results = await this.store.searchFragmentsAdvanced(query);
      
      return {
        success: true,
        data: results,
        message: `Advanced search found ${results.fragments.length} fragments ${results.queryTime ? `in ${results.queryTime}ms` : ''}`
      };
      
    } catch (error) {
      logger.error('FragmentTools', `searchFragmentsAdvanced error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Health check for the fragment system
   */
  async healthCheck(): Promise<FragmentToolResult> {
    try {
      // Check if store is accessible
      const count = await this.store.getFragmentCount();
      
      return {
        success: true,
        data: { fragmentCount: count },
        message: 'Fragment system is healthy'
      };
      
    } catch (error) {
      logger.error('FragmentTools', `healthCheck error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

/**
 * Default fragment tools instance
 */
let defaultFragmentTools: FragmentTools | null = null;

/**
 * Get the default fragment tools instance
 */
export function getFragmentTools(): FragmentTools {
  if (!defaultFragmentTools) {
    defaultFragmentTools = new FragmentTools();
  }
  return defaultFragmentTools;
}

/**
 * Set a custom fragment tools instance
 */
export function setFragmentTools(tools: FragmentTools): void {
  defaultFragmentTools = tools;
}

/**
 * Utility function to validate fragment types
 */
export function validateFragmentType(type: string): boolean {
  const validTypes = ['question', 'answer', 'note', 'documentation', 'issue', 'solution', 'reference'];
  return validTypes.includes(type);
}

/**
 * Utility function to validate fragment priorities
 */
export function validateFragmentPriority(priority: string): boolean {
  const validPriorities = ['low', 'medium', 'high'];
  return validPriorities.includes(priority);
}

/**
 * Utility function to validate fragment statuses
 */
export function validateFragmentStatus(status: string): boolean {
  const validStatuses = ['active', 'archived', 'draft'];
  return validStatuses.includes(status);
}