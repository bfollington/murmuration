/**
 * Fragment Store
 * 
 * LanceDB-based storage and retrieval for knowledge fragments.
 * Provides vector similarity search and traditional filtering capabilities.
 */

import { connect, Connection, Table } from '@lancedb/lancedb';
import { v4 as uuid } from '@std/uuid';
import { logger } from '../../shared/logger.ts';
import { 
  Fragment, 
  FragmentRow, 
  CreateFragmentRequest, 
  UpdateFragmentRequest,
  FragmentQuery,
  FragmentSimilarityQuery,
  FragmentSearchResults,
  FragmentSimilarityResults,
  FragmentWithScore,
  fragmentToRow,
  rowToFragment,
  isValidFragmentType,
  isValidFragmentPriority,
  isValidFragmentStatus
} from './fragment-types.ts';
import { EmbeddingService, getEmbeddingService } from './embedding-service.ts';

/**
 * Configuration for the fragment store
 */
export interface FragmentStoreConfig {
  /** Path to the LanceDB database directory */
  dbPath: string;
  
  /** Name of the fragments table */
  tableName: string;
  
  /** Embedding service instance */
  embeddingService?: EmbeddingService;
}

/**
 * Default configuration
 */
export const DEFAULT_FRAGMENT_STORE_CONFIG: FragmentStoreConfig = {
  dbPath: '.knowledge/lance_fragments',
  tableName: 'fragments'
};

/**
 * Fragment store class
 */
export class FragmentStore {
  private readonly config: FragmentStoreConfig;
  private readonly embeddingService: EmbeddingService;
  private connection: Connection | null = null;
  private table: Table | null = null;
  private isInitialized = false;
  
  constructor(config: Partial<FragmentStoreConfig> = {}) {
    this.config = { ...DEFAULT_FRAGMENT_STORE_CONFIG, ...config };
    this.embeddingService = config.embeddingService || getEmbeddingService();
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
        // Create initial schema with test data to establish vector dimensions
        await this.createInitialTable();
      } else {
        // Open existing table
        this.table = await this.connection.openTable(this.config.tableName);
      }
      
      this.isInitialized = true;
      logger.info('FragmentStore', `Initialized with database at ${this.config.dbPath}`);
      
    } catch (error) {
      logger.error('FragmentStore', `Failed to initialize: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Create a new fragment
   */
  async createFragment(request: CreateFragmentRequest): Promise<Fragment> {
    await this.ensureInitialized();
    
    // Validate request
    this.validateCreateRequest(request);
    
    // Create fragment object
    const fragment: Fragment = {
      id: crypto.randomUUID(),
      title: request.title,
      body: request.body,
      type: request.type,
      created: new Date(),
      updated: new Date(),
      tags: request.tags,
      metadata: request.metadata,
      relatedIds: request.relatedIds,
      priority: request.priority || 'medium',
      status: request.status || 'active'
    };
    
    // Generate embedding for the fragment
    const embedding = await this.embeddingService.embedFragment(fragment.title, fragment.body);
    
    // Convert to row format
    const row = fragmentToRow(fragment);
    row.vector = embedding;
    
    // Insert into database
    await this.table!.add([row]);
    
    logger.info('FragmentStore', `Created fragment ${fragment.id}: ${fragment.title}`);
    return fragment;
  }
  
  /**
   * Get fragment by ID
   */
  async getFragment(id: string): Promise<Fragment | null> {
    await this.ensureInitialized();
    
    try {
      const results: unknown[] = [];
      for await (const batch of this.table!
        .query()
        .where(`id = '${id}'`)
        .limit(1)
      ) {
        results.push(...batch);
      }
      
      if (results.length === 0) {
        return null;
      }
      
      return rowToFragment(results[0] as FragmentRow);
    } catch (error) {
      logger.error('FragmentStore', `Failed to get fragment ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Update an existing fragment
   */
  async updateFragment(request: UpdateFragmentRequest): Promise<Fragment | null> {
    await this.ensureInitialized();
    
    const existing = await this.getFragment(request.id);
    if (!existing) {
      return null;
    }
    
    // Create updated fragment
    const updated: Fragment = {
      ...existing,
      title: request.title !== undefined ? request.title : existing.title,
      body: request.body !== undefined ? request.body : existing.body,
      type: request.type !== undefined ? request.type : existing.type,
      updated: new Date(),
      tags: request.tags !== undefined ? request.tags : existing.tags,
      metadata: request.metadata !== undefined ? request.metadata : existing.metadata,
      relatedIds: request.relatedIds !== undefined ? request.relatedIds : existing.relatedIds,
      priority: request.priority !== undefined ? request.priority : existing.priority,
      status: request.status !== undefined ? request.status : existing.status
    };
    
    // Generate new embedding if title or body changed
    let embedding: number[] | null = null;
    if (request.title !== undefined || request.body !== undefined) {
      embedding = await this.embeddingService.embedFragment(updated.title, updated.body);
    }
    
    // Convert to row format
    const row = fragmentToRow(updated);
    if (embedding) {
      row.vector = embedding;
    }
    
    // Delete old record and insert new one (LanceDB doesn't have native update)
    await this.table!.delete(`id = '${request.id}'`);
    await this.table!.add([row]);
    
    logger.info('FragmentStore', `Updated fragment ${updated.id}: ${updated.title}`);
    return updated;
  }
  
  /**
   * Delete a fragment by ID
   */
  async deleteFragment(id: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      const existing = await this.getFragment(id);
      if (!existing) {
        return false;
      }
      
      await this.table!.delete(`id = '${id}'`);
      logger.info('FragmentStore', `Deleted fragment ${id}`);
      return true;
    } catch (error) {
      logger.error('FragmentStore', `Failed to delete fragment ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Search fragments by metadata filters
   */
  async searchFragments(query: FragmentQuery): Promise<FragmentSearchResults> {
    await this.ensureInitialized();
    
    try {
      let search = this.table!.query();
      
      // Build WHERE clause
      const conditions: string[] = [];
      
      if (query.type) {
        conditions.push(`type = '${query.type}'`);
      }
      
      if (query.status) {
        conditions.push(`status = '${query.status}'`);
      }
      
      if (query.priority) {
        conditions.push(`priority = '${query.priority}'`);
      }
      
      if (conditions.length > 0) {
        search = search.where(conditions.join(' AND '));
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
      
      // Convert to fragments
      const fragments = slicedResults.map(row => rowToFragment(row as FragmentRow));
      
      // Apply additional filters that can't be done in SQL
      let filteredFragments = fragments;
      
      // Filter by tags
      if (query.tags && query.tags.length > 0) {
        filteredFragments = filteredFragments.filter(fragment => 
          fragment.tags && query.tags!.every(tag => fragment.tags!.includes(tag))
        );
      }
      
      // Full-text search in title and body
      if (query.search) {
        const searchLower = query.search.toLowerCase();
        filteredFragments = filteredFragments.filter(fragment =>
          fragment.title.toLowerCase().includes(searchLower) ||
          fragment.body.toLowerCase().includes(searchLower)
        );
      }
      
      return {
        fragments: filteredFragments,
        total: filteredFragments.length, // Note: this is approximate due to filtering
        offset: offset,
        limit: limit
      };
      
    } catch (error) {
      logger.error('FragmentStore', `Failed to search fragments: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Search fragments by title (exact match)
   */
  async searchFragmentsByTitle(title: string): Promise<Fragment[]> {
    await this.ensureInitialized();
    
    try {
      const results: unknown[] = [];
      for await (const batch of this.table!
        .query()
        .where(`title = '${title.replace(/'/g, "''")}'`) // Escape single quotes
      ) {
        results.push(...batch);
      }
      
      return results.map(row => rowToFragment(row as FragmentRow));
    } catch (error) {
      logger.error('FragmentStore', `Failed to search fragments by title: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Search fragments by similarity using vector search
   */
  async searchFragmentsSimilar(query: FragmentSimilarityQuery): Promise<FragmentSimilarityResults> {
    await this.ensureInitialized();
    
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.embeddingService.embed(query.query);
      
      // Perform vector search  
      let search = this.table!
        .query()
        .nearestTo(queryEmbedding)
        .limit(query.limit || 10);
      
      // Apply metadata filters
      const conditions: string[] = [];
      
      if (query.type) {
        conditions.push(`type = '${query.type}'`);
      }
      
      if (query.status) {
        conditions.push(`status = '${query.status}'`);
      }
      
      if (conditions.length > 0) {
        search = search.where(conditions.join(' AND '));
      }
      
      const results: unknown[] = [];
      for await (const batch of search) {
        results.push(...batch);
      }
      
      // Convert to fragments with scores
      const fragmentsWithScores: FragmentWithScore[] = results.map(row => {
        const fragmentRow = row as FragmentRow & { _distance?: number };
        const fragment = rowToFragment(fragmentRow);
        
        // Convert distance to similarity score (0-1, higher is more similar)
        // LanceDB returns L2 distance, convert to cosine similarity approximation
        const distance = fragmentRow._distance || 0;
        const score = Math.max(0, 1 - distance / 2); // Approximate conversion
        
        return { fragment, score };
      });
      
      // Apply threshold filter
      const threshold = query.threshold || 0.1;
      const filteredFragments = fragmentsWithScores.filter(item => item.score >= threshold);
      
      // Apply tag filtering
      let finalFragments = filteredFragments;
      if (query.tags && query.tags.length > 0) {
        finalFragments = filteredFragments.filter(item => 
          item.fragment.tags && query.tags!.every(tag => item.fragment.tags!.includes(tag))
        );
      }
      
      return {
        fragments: finalFragments,
        query: query.query,
        threshold: threshold
      };
      
    } catch (error) {
      logger.error('FragmentStore', `Failed to search fragments by similarity: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Get all fragments (with optional limit)
   */
  async getAllFragments(limit?: number): Promise<Fragment[]> {
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
      return results.map(row => rowToFragment(row as FragmentRow));
    } catch (error) {
      logger.error('FragmentStore', `Failed to get all fragments: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Get fragment count
   */
  async getFragmentCount(): Promise<number> {
    await this.ensureInitialized();
    
    try {
      const results: unknown[] = [];
      for await (const batch of this.table!.query()) {
        results.push(...batch);
      }
      return results.length;
    } catch (error) {
      logger.error('FragmentStore', `Failed to get fragment count: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    // Create a test embedding to determine vector dimensions
    const testEmbedding = await this.embeddingService.embed('test');
    const vectorDim = testEmbedding.length;
    
    // Create initial data with proper schema
    const initialData: FragmentRow[] = [{
      id: 'init',
      title: 'Initial Fragment',
      body: 'This is an initial fragment used to create the table schema.',
      type: 'note',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      priority: 'low',
      status: 'draft',
      vector: new Array(vectorDim).fill(0) // Zero vector for initialization
    }];
    
    // Create table
    this.table = await this.connection!.createTable(this.config.tableName, initialData);
    
    // Remove the initial fragment
    await this.table.delete(`id = 'init'`);
    
    logger.info('FragmentStore', `Created fragments table with vector dimension ${vectorDim}`);
  }
  
  /**
   * Ensure store is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }
  
  /**
   * Validate create fragment request
   */
  private validateCreateRequest(request: CreateFragmentRequest): void {
    if (!request.title?.trim()) {
      throw new Error('Fragment title is required');
    }
    
    if (!request.body?.trim()) {
      throw new Error('Fragment body is required');
    }
    
    if (!isValidFragmentType(request.type)) {
      throw new Error(`Invalid fragment type: ${request.type}`);
    }
    
    if (request.priority && !isValidFragmentPriority(request.priority)) {
      throw new Error(`Invalid fragment priority: ${request.priority}`);
    }
    
    if (request.status && !isValidFragmentStatus(request.status)) {
      throw new Error(`Invalid fragment status: ${request.status}`);
    }
  }
}

/**
 * Default fragment store instance
 */
let defaultFragmentStore: FragmentStore | null = null;

/**
 * Get the default fragment store instance
 */
export function getFragmentStore(): FragmentStore {
  if (!defaultFragmentStore) {
    defaultFragmentStore = new FragmentStore();
  }
  return defaultFragmentStore;
}

/**
 * Set a custom fragment store instance
 */
export function setFragmentStore(store: FragmentStore): void {
  defaultFragmentStore = store;
}