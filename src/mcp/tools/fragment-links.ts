/**
 * Fragment Link MCP Tools
 * 
 * MCP tool handlers for fragment link management and traversal.
 * Provides bidirectional relationship management between fragments.
 */

import { CallToolResult, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../shared/logger.ts';
import { getFragmentLinkStore } from '../../knowledge/fragments/link-store.ts';
import { getFragmentStore } from '../../knowledge/fragments/fragment-store.ts';
import { FragmentLinkType, LinkDirection, FragmentLink } from '../../knowledge/fragments/link-types.ts';
import { Fragment } from '../../knowledge/fragments/fragment-types.ts';
import { MCPToolResponse, MCPResponseContent } from '../../shared/types.ts';

/**
 * Fragment link tool definitions for MCP server registration
 */
export const fragmentLinkToolDefinitions = [
  {
    name: 'create_fragment_link',
    description: 'Create a bidirectional link between two fragments with semantic relationship type.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'ID of the source fragment'
        },
        targetId: {
          type: 'string',
          description: 'ID of the target fragment'
        },
        linkType: {
          type: 'string',
          enum: ['answers', 'references', 'related', 'supersedes'],
          description: 'Type of relationship'
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata for the link'
        }
      },
      required: ['sourceId', 'targetId', 'linkType']
    }
  },
  
  {
    name: 'delete_fragment_link',
    description: 'Delete a link between fragments.',
    inputSchema: {
      type: 'object',
      properties: {
        linkId: {
          type: 'string',
          description: 'ID of the link to delete'
        }
      },
      required: ['linkId']
    }
  },
  
  {
    name: 'get_fragment_links',
    description: 'Get all links for a fragment with filtering options.',
    inputSchema: {
      type: 'object',
      properties: {
        fragmentId: {
          type: 'string',
          description: 'Fragment ID to get links for'
        },
        direction: {
          type: 'string',
          enum: ['outgoing', 'incoming', 'both'],
          description: 'Link direction (default: both)'
        },
        linkType: {
          type: 'string',
          enum: ['answers', 'references', 'related', 'supersedes'],
          description: 'Filter by link type'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of links to return',
          minimum: 1,
          maximum: 100
        }
      },
      required: ['fragmentId']
    }
  },

  {
    name: 'traverse_fragment_links',
    description: 'Traverse fragment relationships up to N levels deep with cycle detection.',
    inputSchema: {
      type: 'object',
      properties: {
        startId: {
          type: 'string',
          description: 'Starting fragment ID'
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum traversal depth (default: 3, max: 10)',
          minimum: 1,
          maximum: 10
        },
        linkTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['answers', 'references', 'related', 'supersedes']
          },
          description: 'Link types to follow'
        },
        direction: {
          type: 'string',
          enum: ['outgoing', 'incoming', 'both'],
          description: 'Direction to traverse (default: both)'
        },
        includeFragments: {
          type: 'boolean',
          description: 'Include full fragment details in results (default: true)'
        }
      },
      required: ['startId']
    }
  },

  {
    name: 'get_fragment_with_links',
    description: 'Get a fragment with all its linked fragments pre-loaded.',
    inputSchema: {
      type: 'object',
      properties: {
        fragmentId: {
          type: 'string',
          description: 'Fragment ID'
        },
        linkDepth: {
          type: 'number',
          description: 'How many levels of links to load (default: 1)',
          minimum: 1,
          maximum: 3
        }
      },
      required: ['fragmentId']
    }
  }
];

/**
 * Traversal result with fragment and link information
 */
interface TraversalNode {
  fragment: Fragment;
  depth: number;
  linkPath: FragmentLink[];
  children?: TraversalNode[];
}

/**
 * Traversal result graph
 */
interface TraversalResult {
  startFragment: Fragment;
  nodes: Map<string, TraversalNode>;
  totalNodes: number;
  maxDepthReached: number;
  cyclesDetected: string[];
}

/**
 * Fragment with loaded links
 */
interface FragmentWithLinks {
  fragment: Fragment;
  outgoingLinks: Array<{
    link: FragmentLink;
    targetFragment: Fragment;
  }>;
  incomingLinks: Array<{
    link: FragmentLink;
    sourceFragment: Fragment;
  }>;
  totalLinkCount: number;
}

/**
 * Fragment link tool handlers
 */
export class FragmentLinkToolHandlers {
  private readonly linkStore = getFragmentLinkStore();
  private readonly fragmentStore = getFragmentStore();
  
  /**
   * Create a structured MCP tool response
   */
  private createResponse(text: string, content?: MCPResponseContent[]): CallToolResult {
    const response: MCPToolResponse = {
      content: [
        { type: 'text', text }
      ]
    };
    
    if (content && content.length > 0) {
      response.content.push(...content);
    }
    
    return response;
  }

  /**
   * Handle create fragment link tool
   */
  async handleCreateFragmentLink(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
      }

      const { sourceId, targetId, linkType, metadata } = args as {
        sourceId?: string;
        targetId?: string; 
        linkType?: string;
        metadata?: Record<string, unknown>;
      };

      // Validate required parameters
      if (!sourceId || typeof sourceId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'sourceId is required and must be a string');
      }
      if (!targetId || typeof targetId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'targetId is required and must be a string');
      }
      if (!linkType || typeof linkType !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'linkType is required and must be a string');
      }

      // Validate link type
      const validLinkTypes: FragmentLinkType[] = ['answers', 'references', 'related', 'supersedes'];
      if (!validLinkTypes.includes(linkType as FragmentLinkType)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid linkType. Must be one of: ${validLinkTypes.join(', ')}`);
      }

      // Check that both fragments exist
      const [sourceFragment, targetFragment] = await Promise.all([
        this.fragmentStore.getFragment(sourceId),
        this.fragmentStore.getFragment(targetId)
      ]);

      if (!sourceFragment) {
        throw new McpError(ErrorCode.InvalidParams, `Source fragment not found: ${sourceId}`);
      }
      if (!targetFragment) {
        throw new McpError(ErrorCode.InvalidParams, `Target fragment not found: ${targetId}`);
      }

      // Create the link
      const link = await this.linkStore.createLink(
        sourceId,
        targetId,
        linkType as FragmentLinkType,
        metadata
      );

      return this.createResponse(
        `Successfully created ${linkType} link from "${sourceFragment.title}" to "${targetFragment.title}"\n\nLink Details:\n- ID: ${link.id}\n- Type: ${linkType}\n- Created: ${link.created.toISOString()}`
      );

    } catch (error) {
      logger.error('FragmentLinkTools', `Error creating fragment link: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to create fragment link: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle delete fragment link tool
   */
  async handleDeleteFragmentLink(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
      }

      const { linkId } = args as { linkId?: string };

      if (!linkId || typeof linkId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'linkId is required and must be a string');
      }

      // Get the link first to provide context in response
      const link = await this.linkStore.getLink(linkId);
      if (!link) {
        throw new McpError(ErrorCode.InvalidParams, `Link not found: ${linkId}`);
      }

      // Delete the link
      const deleted = await this.linkStore.deleteLink(linkId);

      if (!deleted) {
        throw new McpError(ErrorCode.InternalError, `Failed to delete link: ${linkId}`);
      }

      return this.createResponse(
        `Successfully deleted ${link.linkType} link: ${link.sourceId} -> ${link.targetId}`
      );

    } catch (error) {
      logger.error('FragmentLinkTools', `Error deleting fragment link: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to delete fragment link: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle get fragment links tool
   */
  async handleGetFragmentLinks(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
      }

      const { fragmentId, direction, linkType, limit } = args as {
        fragmentId?: string;
        direction?: string;
        linkType?: string;
        limit?: number;
      };

      if (!fragmentId || typeof fragmentId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'fragmentId is required and must be a string');
      }

      // Validate optional parameters
      const validDirections: LinkDirection[] = ['outgoing', 'incoming', 'both'];
      const parsedDirection = (direction as LinkDirection) || 'both';
      if (!validDirections.includes(parsedDirection)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid direction. Must be one of: ${validDirections.join(', ')}`);
      }

      const validLinkTypes: FragmentLinkType[] = ['answers', 'references', 'related', 'supersedes'];
      if (linkType && !validLinkTypes.includes(linkType as FragmentLinkType)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid linkType. Must be one of: ${validLinkTypes.join(', ')}`);
      }

      const parsedLimit = limit && limit > 0 ? Math.min(limit, 100) : 50;

      // Check that fragment exists
      const fragment = await this.fragmentStore.getFragment(fragmentId);
      if (!fragment) {
        throw new McpError(ErrorCode.InvalidParams, `Fragment not found: ${fragmentId}`);
      }

      // Query links
      const links = await this.linkStore.queryLinks({
        fragmentId,
        direction: parsedDirection,
        linkType: linkType as FragmentLinkType,
        limit: parsedLimit
      });

      // Group links by direction for better presentation
      const outgoingLinks = links.filter(link => link.sourceId === fragmentId);
      const incomingLinks = links.filter(link => link.targetId === fragmentId);

      const summary = [
        `Found ${links.length} links for fragment "${fragment.title}":`,
        `- ${outgoingLinks.length} outgoing links`,
        `- ${incomingLinks.length} incoming links`
      ].join('\n');

      const linkDetails = links.map(link => {
        const isOutgoing = link.sourceId === fragmentId;
        const direction = isOutgoing ? 'outgoing' : 'incoming';
        const otherFragmentId = isOutgoing ? link.targetId : link.sourceId;
        
        return {
          id: link.id,
          direction,
          linkType: link.linkType,
          otherFragmentId,
          created: link.created.toISOString(),
          metadata: link.metadata
        };
      });

      // Format link details for text output
      const linkSummaries = links.map(link => {
        const isOutgoing = link.sourceId === fragmentId;
        const direction = isOutgoing ? '→' : '←';
        const otherFragmentId = isOutgoing ? link.targetId : link.sourceId;
        return `  ${direction} ${link.linkType}: ${otherFragmentId} (${link.created.toISOString().split('T')[0]})`;
      }).join('\n');

      const fullSummary = summary + (links.length > 0 ? '\n\nLinks:\n' + linkSummaries : '');
      
      return this.createResponse(fullSummary);

    } catch (error) {
      logger.error('FragmentLinkTools', `Error getting fragment links: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get fragment links: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle traverse fragment links tool
   */
  async handleTraverseFragmentLinks(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
      }

      const { startId, maxDepth, linkTypes, direction, includeFragments } = args as {
        startId?: string;
        maxDepth?: number;
        linkTypes?: string[];
        direction?: string;
        includeFragments?: boolean;
      };

      if (!startId || typeof startId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'startId is required and must be a string');
      }

      const parsedMaxDepth = maxDepth && maxDepth > 0 ? Math.min(maxDepth, 10) : 3;
      const parsedDirection = (direction as LinkDirection) || 'both';
      const parsedIncludeFragments = includeFragments !== false; // default true

      // Validate direction
      const validDirections: LinkDirection[] = ['outgoing', 'incoming', 'both'];
      if (!validDirections.includes(parsedDirection)) {
        throw new McpError(ErrorCode.InvalidParams, `Invalid direction. Must be one of: ${validDirections.join(', ')}`);
      }

      // Validate link types if provided
      const validLinkTypes: FragmentLinkType[] = ['answers', 'references', 'related', 'supersedes'];
      if (linkTypes) {
        for (const type of linkTypes) {
          if (!validLinkTypes.includes(type as FragmentLinkType)) {
            throw new McpError(ErrorCode.InvalidParams, `Invalid linkType: ${type}. Must be one of: ${validLinkTypes.join(', ')}`);
          }
        }
      }

      // Check start fragment exists
      const startFragment = await this.fragmentStore.getFragment(startId);
      if (!startFragment) {
        throw new McpError(ErrorCode.InvalidParams, `Start fragment not found: ${startId}`);
      }

      // Perform traversal
      const result = await this.traverseLinks(
        startId,
        parsedMaxDepth,
        linkTypes as FragmentLinkType[],
        parsedDirection,
        parsedIncludeFragments
      );

      const summary = [
        `Traversed fragment links from "${startFragment.title}":`,
        `- Visited ${result.totalNodes} fragments`,
        `- Maximum depth reached: ${result.maxDepthReached}`,
        `- Cycles detected: ${result.cyclesDetected.length}`
      ].join('\n');

      // Add traversal details to summary
      const fullSummary = summary + (result.cyclesDetected.length > 0 
        ? `\n- Cycles detected at: ${result.cyclesDetected.join(', ')}`
        : '');

      return this.createResponse(fullSummary);

    } catch (error) {
      logger.error('FragmentLinkTools', `Error traversing fragment links: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to traverse fragment links: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Handle get fragment with links tool
   */
  async handleGetFragmentWithLinks(args: unknown): Promise<CallToolResult> {
    try {
      if (!args || typeof args !== 'object') {
        throw new McpError(ErrorCode.InvalidParams, 'Arguments must be an object');
      }

      const { fragmentId, linkDepth } = args as {
        fragmentId?: string;
        linkDepth?: number;
      };

      if (!fragmentId || typeof fragmentId !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'fragmentId is required and must be a string');
      }

      const parsedLinkDepth = linkDepth && linkDepth > 0 ? Math.min(linkDepth, 3) : 1;

      // Get the main fragment
      const fragment = await this.fragmentStore.getFragment(fragmentId);
      if (!fragment) {
        throw new McpError(ErrorCode.InvalidParams, `Fragment not found: ${fragmentId}`);
      }

      // Load the fragment with its links
      const enrichedFragment = await this.loadFragmentWithLinks(fragmentId, parsedLinkDepth);

      const summary = [
        `Fragment "${fragment.title}" with linked fragments:`,
        `- ${enrichedFragment.outgoingLinks.length} outgoing links`,
        `- ${enrichedFragment.incomingLinks.length} incoming links`,
        `- Total connected fragments: ${enrichedFragment.totalLinkCount}`
      ].join('\n');

      // Add link details to summary
      const outgoingDetails = enrichedFragment.outgoingLinks.map(
        ({ link, targetFragment }) => `  → ${link.linkType}: "${targetFragment.title}" (${targetFragment.id})`
      ).join('\n');
      
      const incomingDetails = enrichedFragment.incomingLinks.map(
        ({ link, sourceFragment }) => `  ← ${link.linkType}: "${sourceFragment.title}" (${sourceFragment.id})`
      ).join('\n');

      const fullSummary = summary + 
        (outgoingDetails ? '\n\nOutgoing Links:\n' + outgoingDetails : '') +
        (incomingDetails ? '\n\nIncoming Links:\n' + incomingDetails : '');

      return this.createResponse(fullSummary);

    } catch (error) {
      logger.error('FragmentLinkTools', `Error getting fragment with links: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (error instanceof McpError) {
        throw error;
      }
      
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to get fragment with links: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Perform breadth-first traversal with cycle detection
   */
  private async traverseLinks(
    startId: string,
    maxDepth: number,
    linkTypes?: FragmentLinkType[],
    direction: LinkDirection = 'both',
    includeFragments: boolean = true
  ): Promise<TraversalResult> {
    const visited = new Set<string>();
    const nodes = new Map<string, TraversalNode>();
    const cyclesDetected: string[] = [];
    const queue: Array<{ fragmentId: string; depth: number; linkPath: FragmentLink[] }> = [];
    
    let maxDepthReached = 0;

    // Initialize with start fragment
    const startFragment = await this.fragmentStore.getFragment(startId);
    if (!startFragment) {
      throw new Error(`Start fragment not found: ${startId}`);
    }

    queue.push({ fragmentId: startId, depth: 0, linkPath: [] });
    
    while (queue.length > 0) {
      const { fragmentId, depth, linkPath } = queue.shift()!;
      
      // Skip if we've exceeded max depth
      if (depth > maxDepth) {
        continue;
      }

      // Track max depth reached
      maxDepthReached = Math.max(maxDepthReached, depth);

      // Check for cycles
      if (visited.has(fragmentId)) {
        cyclesDetected.push(fragmentId);
        continue;
      }

      visited.add(fragmentId);

      // Get fragment details if needed
      let fragment: Fragment | undefined;
      if (includeFragments) {
        const fragmentResult = await this.fragmentStore.getFragment(fragmentId);
        if (!fragmentResult) {
          continue; // Skip if fragment doesn't exist
        }
        fragment = fragmentResult;
      }

      // Create traversal node
      const node: TraversalNode = {
        fragment: fragment || { id: fragmentId } as Fragment,
        depth,
        linkPath: [...linkPath]
      };
      nodes.set(fragmentId, node);

      // Don't traverse further if we're at max depth
      if (depth >= maxDepth) {
        continue;
      }

      // Get links for this fragment
      const links = await this.linkStore.queryLinks({
        fragmentId,
        direction,
        linkType: linkTypes?.[0], // TODO: Handle multiple link types
        limit: 100
      });

      // Filter by link types if specified
      const filteredLinks = linkTypes 
        ? links.filter(link => linkTypes.includes(link.linkType))
        : links;

      // Add connected fragments to queue
      for (const link of filteredLinks) {
        const nextFragmentId = link.sourceId === fragmentId ? link.targetId : link.sourceId;
        
        if (!visited.has(nextFragmentId)) {
          queue.push({
            fragmentId: nextFragmentId,
            depth: depth + 1,
            linkPath: [...linkPath, link]
          });
        }
      }
    }

    return {
      startFragment,
      nodes,
      totalNodes: nodes.size,
      maxDepthReached,
      cyclesDetected
    };
  }

  /**
   * Load a fragment with its immediate links and linked fragments
   */
  private async loadFragmentWithLinks(fragmentId: string, depth: number = 1): Promise<FragmentWithLinks> {
    const fragment = await this.fragmentStore.getFragment(fragmentId);
    if (!fragment) {
      throw new Error(`Fragment not found: ${fragmentId}`);
    }

    // Get all links for this fragment
    const links = await this.linkStore.getLinksForFragment(fragmentId, 'both');

    // Separate outgoing and incoming links
    const outgoingLinkPromises = links
      .filter(link => link.sourceId === fragmentId)
      .map(async (link) => {
        const targetFragment = await this.fragmentStore.getFragment(link.targetId);
        return targetFragment ? { link, targetFragment } : null;
      });

    const incomingLinkPromises = links
      .filter(link => link.targetId === fragmentId)
      .map(async (link) => {
        const sourceFragment = await this.fragmentStore.getFragment(link.sourceId);
        return sourceFragment ? { link, sourceFragment } : null;
      });

    const [outgoingResults, incomingResults] = await Promise.all([
      Promise.all(outgoingLinkPromises),
      Promise.all(incomingLinkPromises)
    ]);

    const outgoingLinks = outgoingResults.filter(result => result !== null) as Array<{
      link: FragmentLink;
      targetFragment: Fragment;
    }>;

    const incomingLinks = incomingResults.filter(result => result !== null) as Array<{
      link: FragmentLink;
      sourceFragment: Fragment;
    }>;

    return {
      fragment,
      outgoingLinks,
      incomingLinks,
      totalLinkCount: outgoingLinks.length + incomingLinks.length
    };
  }
}

/**
 * Fragment link tool handlers instance
 */
export const fragmentLinkToolHandlers = new FragmentLinkToolHandlers();