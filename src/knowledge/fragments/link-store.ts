/**
 * Fragment Link Store
 * 
 * LanceDB-based storage for bidirectional fragment relationships.
 * Manages links between fragments with referential integrity.
 */

import { connect, Connection, Table } from '@lancedb/lancedb';
import { logger } from '../../shared/logger.ts';
import { 
  FragmentLink,
  FragmentLinkRow,
  LinkQuery,
  FragmentLinkType,
  LinkDirection,
  linkToRow,
  rowToLink,
  validateFragmentLink,
  validateLinkQuery,
  generateLinkId,
  areLinksEquivalent,
  isValidLinkType
} from './link-types.ts';

/**
 * Configuration for the fragment link store
 */
export interface FragmentLinkStoreConfig {
  /** Path to the LanceDB database directory */
  dbPath: string;
  
  /** Name of the links table */
  tableName: string;
}

/**
 * Default configuration
 */
export const DEFAULT_FRAGMENT_LINK_STORE_CONFIG: FragmentLinkStoreConfig = {
  dbPath: '.knowledge/lance_fragments',
  tableName: 'fragment_links'
};

/**
 * Fragment link store class
 */
export class FragmentLinkStore {
  private readonly config: FragmentLinkStoreConfig;
  private connection: Connection | null = null;
  private table: Table | null = null;
  private isInitialized = false;
  
  constructor(config: Partial<FragmentLinkStoreConfig> = {}) {
    this.config = { ...DEFAULT_FRAGMENT_LINK_STORE_CONFIG, ...config };
  }
  
  /**
   * Initialize the store and create table if needed
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    try {
      // Connect to LanceDB
      this.connection = await connect(this.config.dbPath);
      
      // Check if table exists
      const tableNames = await this.connection.tableNames();
      
      if (!tableNames.includes(this.config.tableName)) {
        // Create initial table
        await this.createInitialTable();
      } else {
        // Open existing table
        this.table = await this.connection.openTable(this.config.tableName);
      }
      
      this.isInitialized = true;
      logger.info('FragmentLinkStore', `Initialized with database at ${this.config.dbPath}`);
      
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Create a new link between fragments
   */
  async createLink(
    sourceId: string, 
    targetId: string, 
    linkType: FragmentLinkType, 
    metadata?: Record<string, unknown>
  ): Promise<FragmentLink> {
    await this.ensureInitialized();
    
    // Validate inputs
    if (!sourceId?.trim()) {
      throw new Error('Source ID is required');
    }
    if (!targetId?.trim()) {
      throw new Error('Target ID is required');
    }
    if (sourceId === targetId) {
      throw new Error('Source and target IDs cannot be the same (self-links not allowed)');
    }
    if (!isValidLinkType(linkType)) {
      throw new Error(`Invalid link type: ${linkType}`);
    }
    
    // Create link object
    const link: FragmentLink = {
      id: generateLinkId(sourceId, targetId, linkType),
      sourceId,
      targetId,
      linkType,
      created: new Date(),
      metadata
    };
    
    // Validate the complete link
    const validationErrors = validateFragmentLink(link);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid link: ${validationErrors.join(', ')}`);
    }
    
    // Check for existing link (prevent duplicates)
    const existingLink = await this.getLink(link.id);
    if (existingLink) {
      throw new Error(`Link already exists: ${sourceId} -> ${targetId} (${linkType})`);
    }
    
    // Convert to row format and insert
    const row = linkToRow(link);
    await this.table!.add([row as any]);
    
    logger.info('FragmentLinkStore', `Created link ${link.id}: ${sourceId} -> ${targetId} (${linkType})`);
    return link;
  }
  
  /**
   * Delete a link by ID
   */
  async deleteLink(linkId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    if (!linkId?.trim()) {
      throw new Error('Link ID is required');
    }
    
    try {
      // Check if link exists
      const existing = await this.getLink(linkId);
      if (!existing) {
        return false;
      }
      
      // Delete the link
      await this.table!.delete(`id = '${linkId.replace(/'/g, "''")}'`);
      logger.info('FragmentLinkStore', `Deleted link ${linkId}`);
      return true;
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to delete link ${linkId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Get a single link by ID
   */
  async getLink(linkId: string): Promise<FragmentLink | null> {
    await this.ensureInitialized();
    
    if (!linkId?.trim()) {
      throw new Error('Link ID is required');
    }
    
    try {
      const results: unknown[] = [];
      for await (const batch of this.table!
        .query()
        .where(`id = '${linkId.replace(/'/g, "''")}'`)
        .limit(1)
      ) {
        results.push(...batch);
      }
      
      if (results.length === 0) {
        return null;
      }
      
      return rowToLink(results[0] as FragmentLinkRow);
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to get link ${linkId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Query links with flexible filtering
   */
  async queryLinks(query: LinkQuery): Promise<FragmentLink[]> {
    await this.ensureInitialized();
    
    // Validate query
    const validationErrors = validateLinkQuery(query);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid query: ${validationErrors.join(', ')}`);
    }
    
    try {
      let search = this.table!.query();
      
      // Build WHERE clause
      const conditions: string[] = [];
      
      // Handle fragment ID with direction
      if (query.fragmentId) {
        const fragmentId = query.fragmentId.replace(/'/g, "''");
        const direction = query.direction || 'both';
        
        switch (direction) {
          case 'outgoing':
            conditions.push(`\`sourceId\` = '${fragmentId}'`);
            break;
          case 'incoming':
            conditions.push(`\`targetId\` = '${fragmentId}'`);
            break;
          case 'both':
            conditions.push(`(\`sourceId\` = '${fragmentId}' OR \`targetId\` = '${fragmentId}')`);
            break;
        }
      }
      
      // Handle specific source/target filters
      if (query.sourceId) {
        conditions.push(`\`sourceId\` = '${query.sourceId.replace(/'/g, "''")}'`);
      }
      
      if (query.targetId) {
        conditions.push(`\`targetId\` = '${query.targetId.replace(/'/g, "''")}'`);
      }
      
      // Filter by link type
      if (query.linkType) {
        conditions.push(`\`linkType\` = '${query.linkType}'`);
      }
      
      // Apply WHERE clause if we have conditions
      if (conditions.length > 0) {
        const whereClause = conditions.join(' AND ');
        search = search.where(whereClause);
      }
      
      // Apply limit and offset
      const limit = query.limit || 50;
      const offset = query.offset || 0;
      
      search = search.limit(limit + offset);
      
      const results: unknown[] = [];
      for await (const batch of search) {
        results.push(...batch);
      }
      
      // Apply offset manually (LanceDB doesn't have native offset)
      const slicedResults = results.slice(offset, offset + limit);
      
      // Convert to links
      return slicedResults.map(row => rowToLink(row as FragmentLinkRow));
      
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to query links: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Get all links for a specific fragment (convenience method)
   */
  async getLinksForFragment(
    fragmentId: string, 
    direction: LinkDirection = 'both'
  ): Promise<FragmentLink[]> {
    if (!fragmentId?.trim()) {
      throw new Error('Fragment ID is required');
    }
    
    return this.queryLinks({ fragmentId, direction });
  }
  
  /**
   * Delete all links for a fragment (when fragment is deleted)
   */
  async deleteLinksForFragment(fragmentId: string): Promise<number> {
    await this.ensureInitialized();
    
    if (!fragmentId?.trim()) {
      throw new Error('Fragment ID is required');
    }
    
    try {
      // Get all links for this fragment first (to count them)
      const linksToDelete = await this.getLinksForFragment(fragmentId, 'both');
      const count = linksToDelete.length;
      
      if (count === 0) {
        return 0;
      }
      
      // Delete links where fragment is source or target
      const fragmentIdEscaped = fragmentId.replace(/'/g, "''");
      await this.table!.delete(`\`sourceId\` = '${fragmentIdEscaped}' OR \`targetId\` = '${fragmentIdEscaped}'`);
      
      logger.info('FragmentLinkStore', `Deleted ${count} links for fragment ${fragmentId}`);
      return count;
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to delete links for fragment ${fragmentId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Find orphaned links (links pointing to non-existent fragments)
   * This requires a callback to check if fragments exist
   */
  async findOrphanedLinks(fragmentExistsCallback: (id: string) => Promise<boolean>): Promise<FragmentLink[]> {
    await this.ensureInitialized();
    
    try {
      // Get all links
      const allLinks = await this.getAllLinks();
      const orphanedLinks: FragmentLink[] = [];
      
      // Check each link for fragment existence
      for (const link of allLinks) {
        const sourceExists = await fragmentExistsCallback(link.sourceId);
        const targetExists = await fragmentExistsCallback(link.targetId);
        
        if (!sourceExists || !targetExists) {
          orphanedLinks.push(link);
        }
      }
      
      logger.info('FragmentLinkStore', `Found ${orphanedLinks.length} orphaned links out of ${allLinks.length} total`);
      return orphanedLinks;
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to find orphaned links: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Get all links (with optional limit)
   */
  async getAllLinks(limit?: number): Promise<FragmentLink[]> {
    await this.ensureInitialized();
    
    try {
      let search = this.table!.query();
      
      if (limit) {
        search = search.limit(limit);
      }
      
      const results: unknown[] = [];
      for await (const batch of search) {
        results.push(...batch);
      }
      
      return results.map(row => rowToLink(row as FragmentLinkRow));
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to get all links: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Get total number of links
   */
  async getLinkCount(): Promise<number> {
    await this.ensureInitialized();
    
    try {
      const results: unknown[] = [];
      for await (const batch of this.table!.query()) {
        results.push(...batch);
      }
      return results.length;
    } catch (error) {
      logger.error('FragmentLinkStore', `Failed to get link count: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Close the store connection
   */
  async close(): Promise<void> {
    if (this.connection) {
      // LanceDB connections are automatically managed, no explicit close needed
      this.connection = null;
      this.table = null;
      this.isInitialized = false;
    }
  }
  
  /**
   * Create initial table with proper schema
   */
  private async createInitialTable(): Promise<void> {
    // Create initial data with proper schema (no vector embeddings needed for links)
    const initialData = [{
      id: 'init_link',
      sourceId: 'init_source',
      targetId: 'init_target',
      linkType: 'related',
      created: new Date().toISOString(),
      metadata: JSON.stringify({ test: true })
    }];
    
    // Create table
    this.table = await this.connection!.createTable(this.config.tableName, initialData);
    
    // Remove the initial link
    await this.table.delete(`id = 'init_link'`);
    
    logger.info('FragmentLinkStore', `Created fragment links table`);
  }
  
  /**
   * Ensure store is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
}

/**
 * Default fragment link store instance
 */
let defaultFragmentLinkStore: FragmentLinkStore | null = null;

/**
 * Get the default fragment link store instance
 */
export function getFragmentLinkStore(): FragmentLinkStore {
  if (!defaultFragmentLinkStore) {
    defaultFragmentLinkStore = new FragmentLinkStore();
  }
  return defaultFragmentLinkStore;
}

/**
 * Set a custom fragment link store instance
 */
export function setFragmentLinkStore(store: FragmentLinkStore): void {
  defaultFragmentLinkStore = store;
}