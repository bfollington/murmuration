/**
 * Fragment MCP Tools
 * 
 * MCP tool handlers for the fragment system. These tools replace the old knowledge tools
 * (record_question, record_answer, record_note, list_questions_and_answers, list_notes)
 * with a unified fragment-based approach using LanceDB for vector search.
 */

import { CallToolResult, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../shared/logger.ts';
import { getFragmentTools, validateFragmentType, validateFragmentPriority, validateFragmentStatus } from '../../knowledge/fragments/fragment-tools.ts';
import { MCPToolResponse, MCPResponseContent } from '../../shared/types.ts';
import { isValidTimeFilter, validateTimeFilter, TimeFilter } from '../../knowledge/fragments/fragment-types.ts';

/**
 * Fragment tool definitions for MCP server registration
 */
export const fragmentToolDefinitions = [
  {
    name: 'record_fragment',
    description: 'Record a new knowledge fragment (replaces record_question, record_answer, record_note). Automatically generates embeddings for vector similarity search.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Title of the fragment'
        },
        body: {
          type: 'string',
          description: 'Main content/body of the fragment'
        },
        type: {
          type: 'string',
          enum: ['question', 'answer', 'note', 'documentation', 'issue', 'solution', 'reference'],
          description: 'Type of fragment'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization'
        },
        metadata: {
          type: 'object',
          description: 'Optional additional metadata'
        },
        relatedIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional IDs of related fragments'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Priority level (default: medium)'
        },
        status: {
          type: 'string',
          enum: ['active', 'archived', 'draft'],
          description: 'Fragment status (default: active)'
        }
      },
      required: ['title', 'body', 'type']
    }
  },
  {
    name: 'list_fragments',
    description: 'List knowledge fragments with optional filtering including time-based filters (replaces list_questions_and_answers, list_notes).',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['question', 'answer', 'note', 'documentation', 'issue', 'solution', 'reference'],
          description: 'Filter by fragment type'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (must have all specified tags)'
        },
        status: {
          type: 'string',
          enum: ['active', 'archived', 'draft'],
          description: 'Filter by status'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Filter by priority'
        },
        search: {
          type: 'string',
          description: 'Full-text search in title and body'
        },
        timeFilter: {
          type: 'object',
          properties: {
            created: {
              type: 'object',
              properties: {
                after: { type: 'string', description: 'Include fragments created after this date (ISO string)' },
                before: { type: 'string', description: 'Include fragments created before this date (ISO string)' }
              }
            },
            updated: {
              type: 'object',
              properties: {
                after: { type: 'string', description: 'Include fragments updated after this date (ISO string)' },
                before: { type: 'string', description: 'Include fragments updated before this date (ISO string)' }
              }
            },
            lastNDays: {
              type: 'number',
              description: 'Filter to fragments updated in last N days',
              minimum: 1
            }
          },
          description: 'Time-based filtering options'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50)',
          minimum: 1,
          maximum: 200
        },
        offset: {
          type: 'number',
          description: 'Skip first N results for pagination',
          minimum: 0
        }
      },
      required: []
    }
  },
  {
    name: 'search_fragments_by_title',
    description: 'Search for fragments by exact title match.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Exact title to search for'
        }
      },
      required: ['title']
    }
  },
  {
    name: 'search_fragments_similar',
    description: 'Search for fragments similar to a query using vector similarity search with optional time filtering. This is the most powerful basic search method.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query text to find similar fragments'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
          minimum: 1,
          maximum: 50
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity score 0-1 (default: 0.1)',
          minimum: 0,
          maximum: 1
        },
        type: {
          type: 'string',
          enum: ['question', 'answer', 'note', 'documentation', 'issue', 'solution', 'reference'],
          description: 'Filter by fragment type'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags'
        },
        status: {
          type: 'string',
          enum: ['active', 'archived', 'draft'],
          description: 'Filter by status'
        },
        timeFilter: {
          type: 'object',
          properties: {
            created: {
              type: 'object',
              properties: {
                after: { type: 'string', description: 'Include fragments created after this date (ISO string)' },
                before: { type: 'string', description: 'Include fragments created before this date (ISO string)' }
              }
            },
            updated: {
              type: 'object',
              properties: {
                after: { type: 'string', description: 'Include fragments updated after this date (ISO string)' },
                before: { type: 'string', description: 'Include fragments updated before this date (ISO string)' }
              }
            },
            lastNDays: {
              type: 'number',
              description: 'Filter to fragments updated in last N days',
              minimum: 1
            }
          },
          description: 'Time-based filtering options'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'get_fragment',
    description: 'Get a specific fragment by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Fragment ID'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'update_fragment',
    description: 'Update an existing fragment.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Fragment ID to update'
        },
        title: {
          type: 'string',
          description: 'New title'
        },
        body: {
          type: 'string',
          description: 'New body content'
        },
        type: {
          type: 'string',
          enum: ['question', 'answer', 'note', 'documentation', 'issue', 'solution', 'reference'],
          description: 'New type'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'New tags'
        },
        metadata: {
          type: 'object',
          description: 'New metadata'
        },
        relatedIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'New related fragment IDs'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'New priority'
        },
        status: {
          type: 'string',
          enum: ['active', 'archived', 'draft'],
          description: 'New status'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_fragment',
    description: 'Delete a fragment by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Fragment ID to delete'
        }
      },
      required: ['id']
    }
  },
  {
    name: 'get_fragment_stats',
    description: 'Get statistics about the fragment knowledge base.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'search_fragments_advanced',
    description: 'Advanced fragment search combining vector similarity, text search, metadata filters, and time filters. Supports regex patterns and flexible filtering modes.',
    inputSchema: {
      type: 'object',
      properties: {
        similarTo: {
          type: 'string',
          description: 'Text to find similar fragments (uses vector embeddings)'
        },
        similarityThreshold: {
          type: 'number',
          description: 'Minimum similarity score 0-1 (default: 0.5)',
          minimum: 0,
          maximum: 1
        },
        textSearch: {
          type: 'string',
          description: 'Text to search for in title and body'
        },
        searchFields: {
          type: 'array',
          items: { type: 'string', enum: ['title', 'body'] },
          description: 'Fields to search in (default: both)'
        },
        useRegex: {
          type: 'boolean',
          description: 'Treat textSearch as regex pattern'
        },
        timeFilter: {
          type: 'object',
          properties: {
            created: {
              type: 'object',
              properties: {
                after: { type: 'string', description: 'ISO date string' },
                before: { type: 'string', description: 'ISO date string' }
              }
            },
            updated: {
              type: 'object',
              properties: {
                after: { type: 'string', description: 'ISO date string' },
                before: { type: 'string', description: 'ISO date string' }
              }
            },
            lastNDays: {
              type: 'number',
              description: 'Filter to fragments updated in last N days'
            }
          },
          description: 'Time-based filtering options'
        },
        type: {
          type: 'string',
          enum: ['question', 'answer', 'note', 'documentation', 'issue', 'solution', 'reference'],
          description: 'Filter by fragment type'
        },
        status: {
          type: 'string',
          enum: ['active', 'archived', 'draft'],
          description: 'Filter by status'
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Filter by priority'
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (must have all specified tags)'
        },
        filterMode: {
          type: 'string',
          enum: ['pre', 'post'],
          description: 'Apply filters before (pre) or after (post) vector search'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          minimum: 1,
          maximum: 100
        },
        offset: {
          type: 'number',
          description: 'Skip first N results for pagination',
          minimum: 0
        },
        sortBy: {
          type: 'string',
          enum: ['relevance', 'created', 'updated', 'title'],
          description: 'Sort results by specified field'
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order'
        }
      },
      required: []
    }
  }
];

/**
 * Fragment tool handlers
 */
export class FragmentToolHandlers {
  private readonly fragmentTools = getFragmentTools();
  
  /**
   * Handle record_fragment tool calls
   */
  async handleRecordFragment(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'record_fragment requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      // Validate required parameters
      if (!params.title || typeof params.title !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'title is required and must be a string');
      }
      
      if (!params.body || typeof params.body !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'body is required and must be a string');
      }
      
      if (!params.type || typeof params.type !== 'string' || !validateFragmentType(params.type)) {
        throw new McpError(ErrorCode.InvalidRequest, 'type is required and must be one of: question, answer, note, documentation, issue, solution, reference');
      }
      
      // Validate optional parameters
      if (params.priority && !validateFragmentPriority(params.priority as string)) {
        throw new McpError(ErrorCode.InvalidRequest, 'priority must be one of: low, medium, high');
      }
      
      if (params.status && !validateFragmentStatus(params.status as string)) {
        throw new McpError(ErrorCode.InvalidRequest, 'status must be one of: active, archived, draft');
      }
      
      const result = await this.fragmentTools.recordFragment({
        title: params.title as string,
        body: params.body as string,
        type: params.type as string,
        tags: params.tags as string[],
        metadata: params.metadata as Record<string, unknown>,
        relatedIds: params.relatedIds as string[],
        priority: params.priority as string,
        status: params.status as string
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to record fragment');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Fragment recorded successfully'
          }
        ]
      };
      
      if (result.data) {
        response.content.push({
          type: 'text',
          text: `Fragment details: ${JSON.stringify(result.data, null, 2)}`
        });
      }
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleRecordFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle list_fragments tool calls
   */
  async handleListFragments(args: unknown): Promise<CallToolResult> {
    try {
      const params = (args as Record<string, unknown>) || {};
      
      // Validate timeFilter if provided
      if (params.timeFilter && !isValidTimeFilter(params.timeFilter)) {
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid timeFilter format');
      }
      
      const result = await this.fragmentTools.listFragments({
        type: params.type as string,
        tags: params.tags as string[],
        status: params.status as string,
        priority: params.priority as string,
        search: params.search as string,
        timeFilter: params.timeFilter as TimeFilter,
        limit: params.limit as number,
        offset: params.offset as number
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to list fragments');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Fragments retrieved successfully'
          },
          {
            type: 'text',
            text: `Results: ${JSON.stringify(result.data, null, 2)}`
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleListFragments error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle search_fragments_by_title tool calls
   */
  async handleSearchFragmentsByTitle(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'search_fragments_by_title requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.title || typeof params.title !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'title is required and must be a string');
      }
      
      const result = await this.fragmentTools.searchFragmentsByTitle({
        title: params.title as string
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to search fragments by title');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Title search completed successfully'
          },
          {
            type: 'text',
            text: `Results: ${JSON.stringify(result.data, null, 2)}`
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleSearchFragmentsByTitle error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle search_fragments_similar tool calls
   */
  async handleSearchFragmentsSimilar(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'search_fragments_similar requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.query || typeof params.query !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'query is required and must be a string');
      }
      
      // Validate timeFilter if provided
      if (params.timeFilter && !isValidTimeFilter(params.timeFilter)) {
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid timeFilter format');
      }
      
      const result = await this.fragmentTools.searchFragmentsSimilar({
        query: params.query as string,
        limit: params.limit as number,
        threshold: params.threshold as number,
        type: params.type as string,
        tags: params.tags as string[],
        status: params.status as string,
        timeFilter: params.timeFilter as TimeFilter
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to search similar fragments');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Similarity search completed successfully'
          },
          {
            type: 'text',
            text: `Results: ${JSON.stringify(result.data, null, 2)}`
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleSearchFragmentsSimilar error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle get_fragment tool calls
   */
  async handleGetFragment(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'get_fragment requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.id || typeof params.id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'id is required and must be a string');
      }
      
      const result = await this.fragmentTools.getFragment({
        id: params.id as string
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to get fragment');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Fragment retrieved successfully'
          },
          {
            type: 'text',
            text: `Fragment: ${JSON.stringify(result.data, null, 2)}`
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleGetFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle update_fragment tool calls
   */
  async handleUpdateFragment(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'update_fragment requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.id || typeof params.id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'id is required and must be a string');
      }
      
      const result = await this.fragmentTools.updateFragment({
        id: params.id as string,
        title: params.title as string,
        body: params.body as string,
        type: params.type as string,
        tags: params.tags as string[],
        metadata: params.metadata as Record<string, unknown>,
        relatedIds: params.relatedIds as string[],
        priority: params.priority as string,
        status: params.status as string
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to update fragment');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Fragment updated successfully'
          },
          {
            type: 'text',
            text: `Updated fragment: ${JSON.stringify(result.data, null, 2)}`
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleUpdateFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle delete_fragment tool calls
   */
  async handleDeleteFragment(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidRequest, 'delete_fragment requires arguments');
      }
      
      const params = args as Record<string, unknown>;
      
      if (!params.id || typeof params.id !== 'string') {
        throw new McpError(ErrorCode.InvalidRequest, 'id is required and must be a string');
      }
      
      const result = await this.fragmentTools.deleteFragment({
        id: params.id as string
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to delete fragment');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Fragment deleted successfully'
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleDeleteFragment error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle get_fragment_stats tool calls
   */
  async handleGetFragmentStats(args: unknown): Promise<CallToolResult> {
    try {
      const result = await this.fragmentTools.getFragmentStats();
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to get fragment stats');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Fragment statistics retrieved successfully'
          },
          {
            type: 'text',
            text: `Statistics: ${JSON.stringify(result.data, null, 2)}`
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleGetFragmentStats error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
  
  /**
   * Handle search_fragments_advanced tool calls
   */
  async handleSearchFragmentsAdvanced(args: unknown): Promise<CallToolResult> {
    try {
      const params = (args as Record<string, unknown>) || {};
      
      // Validate that at least one search criteria is provided
      if (!params.similarTo && !params.textSearch) {
        throw new McpError(ErrorCode.InvalidRequest, 'Either similarTo or textSearch must be provided');
      }
      
      // Validate timeFilter if provided
      if (params.timeFilter && !isValidTimeFilter(params.timeFilter)) {
        throw new McpError(ErrorCode.InvalidRequest, 'Invalid timeFilter format');
      }
      
      // Validate numeric ranges
      if (params.similarityThreshold !== undefined) {
        const threshold = params.similarityThreshold as number;
        if (threshold < 0 || threshold > 1) {
          throw new McpError(ErrorCode.InvalidRequest, 'similarityThreshold must be between 0 and 1');
        }
      }
      
      if (params.limit !== undefined && (params.limit as number) < 1) {
        throw new McpError(ErrorCode.InvalidRequest, 'limit must be greater than 0');
      }
      
      if (params.offset !== undefined && (params.offset as number) < 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'offset must be greater than or equal to 0');
      }
      
      // Validate searchFields if provided
      if (params.searchFields) {
        const fields = params.searchFields as string[];
        const validFields = ['title', 'body'];
        const invalidFields = fields.filter(field => !validFields.includes(field));
        if (invalidFields.length > 0) {
          throw new McpError(ErrorCode.InvalidRequest, `Invalid search fields: ${invalidFields.join(', ')}`);
        }
      }
      
      // Validate useRegex usage
      if (params.useRegex && !params.textSearch) {
        throw new McpError(ErrorCode.InvalidRequest, 'useRegex requires textSearch to be specified');
      }
      
      // Validate sortOrder usage
      if (params.sortOrder && !params.sortBy) {
        throw new McpError(ErrorCode.InvalidRequest, 'sortOrder requires sortBy to be specified');
      }
      
      const result = await this.fragmentTools.searchFragmentsAdvanced({
        similarTo: params.similarTo as string,
        similarityThreshold: params.similarityThreshold as number,
        textSearch: params.textSearch as string,
        searchFields: params.searchFields as ('title' | 'body')[],
        useRegex: params.useRegex as boolean,
        timeFilter: params.timeFilter as TimeFilter,
        type: params.type as string,
        status: params.status as string,
        priority: params.priority as string,
        tags: params.tags as string[],
        filterMode: params.filterMode as 'pre' | 'post',
        limit: params.limit as number,
        offset: params.offset as number,
        sortBy: params.sortBy as 'relevance' | 'created' | 'updated' | 'title',
        sortOrder: params.sortOrder as 'asc' | 'desc'
      });
      
      if (!result.success) {
        throw new McpError(ErrorCode.InternalError, result.error || 'Failed to perform advanced fragment search');
      }
      
      const response: MCPToolResponse = {
        content: [
          {
            type: 'text',
            text: result.message || 'Advanced search completed successfully'
          },
          {
            type: 'text',
            text: `Results: ${JSON.stringify(result.data, null, 2)}`
          }
        ]
      };
      
      return response;
      
    } catch (error) {
      logger.error('FragmentMCP', `handleSearchFragmentsAdvanced error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(ErrorCode.InternalError, error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

/**
 * Default fragment tool handlers instance
 */
export const fragmentToolHandlers = new FragmentToolHandlers();