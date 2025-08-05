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
  TimeFilter,
  AdvancedFragmentQuery,
  AdvancedFragmentResults,
  fragmentToRow,
  rowToFragment,
  isValidFragmentType,
  isValidFragmentPriority,
  isValidFragmentStatus,
  validateTimeFilter,
  validateAdvancedQuery
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
      // Validate time filter if provided
      if (query.timeFilter) {
        const timeErrors = validateTimeFilter(query.timeFilter);
        if (timeErrors.length > 0) {
          throw new Error(`Invalid time filter: ${timeErrors.join(', ')}`);
        }
      }
      
      let search = this.table!.query();
      
      // Build WHERE clause
      const conditions: string[] = [];
      
      if (query.type) {
        conditions.push(`type = '${this.escapeSqlString(query.type)}'`);
      }
      
      if (query.status) {
        conditions.push(`status = '${this.escapeSqlString(query.status)}'`);
      }
      
      if (query.priority) {
        conditions.push(`priority = '${this.escapeSqlString(query.priority)}'`);
      }
      
      // Add time filter conditions
      if (query.timeFilter) {
        const timeConditions = this.buildTimeFilterConditions(query.timeFilter);
        conditions.push(...timeConditions);
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
      // Validate time filter if provided
      if (query.timeFilter) {
        const timeErrors = validateTimeFilter(query.timeFilter);
        if (timeErrors.length > 0) {
          throw new Error(`Invalid time filter: ${timeErrors.join(', ')}`);
        }
      }
      
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
        conditions.push(`type = '${this.escapeSqlString(query.type)}'`);
      }
      
      if (query.status) {
        conditions.push(`status = '${this.escapeSqlString(query.status)}'`);
      }
      
      // Add time filter conditions
      if (query.timeFilter) {
        const timeConditions = this.buildTimeFilterConditions(query.timeFilter);
        conditions.push(...timeConditions);
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
   * Advanced fragment search combining multiple search methods
   */
  async searchFragmentsAdvanced(query: AdvancedFragmentQuery): Promise<AdvancedFragmentResults> {
    await this.ensureInitialized();
    
    const startTime = Date.now();
    
    try {
      // Validate the query
      const queryErrors = validateAdvancedQuery(query);
      if (queryErrors.length > 0) {
        throw new Error(`Invalid advanced query: ${queryErrors.join(', ')}`);
      }
      
      // Determine search strategy based on query parameters
      const hasVectorSearch = Boolean(query.similarTo);
      const hasTextSearch = Boolean(query.textSearch);
      const hasFilters = Boolean(
        query.type || query.status || query.priority || 
        query.tags?.length || query.timeFilter
      );
      
      // Default to pre-filtering for better performance
      const filterMode = query.filterMode || 'pre';
      
      let fragments: Fragment[] = [];
      
      if (hasVectorSearch && hasTextSearch && hasFilters && filterMode === 'pre') {
        // Special case: Due to LanceDB bug with date filtering + FTS, use vector search as workaround
        logger.info('FragmentStore', 'Using vector search workaround for combined query due to LanceDB limitations');
        fragments = await this.performVectorSearchWithPostFiltering(query);
      } else if (hasVectorSearch) {
        // Primary vector search
        fragments = await this.performVectorSearch(query, filterMode);
      } else if (hasTextSearch || hasFilters) {
        // Text search or filtering only
        fragments = await this.performTextSearchAndFiltering(query);
      } else {
        // No specific search criteria, return all (with pagination)
        const limit = query.limit || 50;
        fragments = await this.getAllFragments(limit);
      }
      
      // Apply post-processing based on query parameters
      fragments = this.applyPostProcessing(fragments, query);
      
      // Calculate pagination
      const offset = query.offset || 0;
      const limit = query.limit || 50;
      const paginatedFragments = fragments.slice(offset, offset + limit);
      
      const queryTime = Date.now() - startTime;
      
      logger.info('FragmentStore', 
        `Advanced search completed in ${queryTime}ms, found ${fragments.length} results`);
      
      return {
        fragments: paginatedFragments,
        total: fragments.length,
        offset: offset,
        limit: limit,
        queryTime: queryTime,
        filterMode: filterMode
      };
      
    } catch (error) {
      const queryTime = Date.now() - startTime;
      logger.error('FragmentStore', 
        `Advanced search failed after ${queryTime}ms: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Perform vector search with optional pre-filtering
   */
  private async performVectorSearch(query: AdvancedFragmentQuery, filterMode: 'pre' | 'post'): Promise<Fragment[]> {
    const queryEmbedding = await this.embeddingService.embed(query.similarTo!);
    
    let search = this.table!
      .query()
      .nearestTo(queryEmbedding)
      .limit(query.limit || 50);
    
    // Apply pre-filtering if requested
    if (filterMode === 'pre') {
      const conditions = this.buildFilterConditions(query);
      if (conditions.length > 0) {
        search = search.where(conditions.join(' AND '));
      }
    }
    
    const results: unknown[] = [];
    for await (const batch of search) {
      results.push(...batch);
    }
    
    // Convert to fragments and apply similarity threshold
    const fragmentsWithScores = results.map(row => {
      const fragmentRow = row as FragmentRow & { _distance?: number };
      const fragment = rowToFragment(fragmentRow);
      const distance = fragmentRow._distance || 0;
      const score = Math.max(0, 1 - distance / 2);
      return { fragment, score };
    });
    
    const threshold = query.similarityThreshold || 0.1;
    const filteredFragments = fragmentsWithScores
      .filter(item => item.score >= threshold)
      .map(item => item.fragment);
    
    return filteredFragments;
  }

  /**
   * Perform vector search with post-filtering (workaround for LanceDB limitations)
   */
  private async performVectorSearchWithPostFiltering(query: AdvancedFragmentQuery): Promise<Fragment[]> {
    // Use broader vector search first
    const vectorQuery: AdvancedFragmentQuery = {
      similarTo: query.similarTo,
      similarityThreshold: query.similarityThreshold,
      limit: (query.limit || 50) * 3 // Get more results to account for post-filtering
    };
    
    const vectorResults = await this.performVectorSearch(vectorQuery, 'post');
    
    // Apply text search and other filters in memory
    return this.applyInMemoryFilters(vectorResults, query);
  }

  /**
   * Perform text search and filtering
   */
  private async performTextSearchAndFiltering(query: AdvancedFragmentQuery): Promise<Fragment[]> {
    let search = this.table!.query();
    
    // Build conditions
    const conditions = this.buildFilterConditions(query);
    
    // Add regex search if specified (use simpler approach due to LanceDB limitations)
    if (query.textSearch && query.useRegex) {
      logger.info('FragmentStore', 'Regex search requested but using fallback to in-memory filtering due to LanceDB limitations');
      // Note: We'll handle regex in post-processing to avoid LanceDB issues
    }
    
    if (conditions.length > 0) {
      search = search.where(conditions.join(' AND '));
    }
    
    const results: unknown[] = [];
    for await (const batch of search) {
      results.push(...batch);
    }
    
    let fragments = results.map(row => rowToFragment(row as FragmentRow));
    
    // Apply text search (both regex and non-regex handled in-memory)
    if (query.textSearch) {
      fragments = this.applyTextSearchFilter(fragments, query.textSearch, query.searchFields, query.useRegex);
    }
    
    return fragments;
  }

  /**
   * Build filter conditions for SQL WHERE clause
   */
  private buildFilterConditions(query: AdvancedFragmentQuery): string[] {
    const conditions: string[] = [];
    
    if (query.type) {
      conditions.push(`type = '${this.escapeSqlString(query.type)}'`);
    }
    
    if (query.status) {
      conditions.push(`status = '${this.escapeSqlString(query.status)}'`);
    }
    
    if (query.priority) {
      conditions.push(`priority = '${this.escapeSqlString(query.priority)}'`);
    }
    
    // Add time filter conditions
    if (query.timeFilter) {
      const timeConditions = this.buildTimeFilterConditions(query.timeFilter);
      conditions.push(...timeConditions);
    }
    
    return conditions;
  }

  /**
   * Apply in-memory filters for complex queries
   */
  private applyInMemoryFilters(fragments: Fragment[], query: AdvancedFragmentQuery): Fragment[] {
    let filtered = fragments;
    
    // Apply type filter
    if (query.type) {
      filtered = filtered.filter(f => f.type === query.type);
    }
    
    // Apply status filter
    if (query.status) {
      filtered = filtered.filter(f => f.status === query.status);
    }
    
    // Apply priority filter
    if (query.priority) {
      filtered = filtered.filter(f => f.priority === query.priority);
    }
    
    // Apply tags filter
    if (query.tags?.length) {
      filtered = filtered.filter(f => 
        f.tags && query.tags!.every(tag => f.tags!.includes(tag))
      );
    }
    
    // Apply text search
    if (query.textSearch) {
      filtered = this.applyTextSearchFilter(filtered, query.textSearch, query.searchFields, query.useRegex);
    }
    
    // Apply time filter
    if (query.timeFilter) {
      filtered = this.applyTimeFilter(filtered, query.timeFilter);
    }
    
    return filtered;
  }

  /**
   * Apply text search filter in memory
   */
  private applyTextSearchFilter(fragments: Fragment[], searchText: string, fields?: ('title' | 'body')[], useRegex?: boolean): Fragment[] {
    const searchFields = fields || ['title', 'body'];
    
    if (useRegex) {
      try {
        const regex = new RegExp(searchText, 'i'); // Case-insensitive regex
        return fragments.filter(fragment => {
          return searchFields.some(field => regex.test(fragment[field]));
        });
      } catch (error) {
        logger.error('FragmentStore', `Invalid regex pattern '${searchText}': ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Fall back to literal search if regex is invalid
        const searchLower = searchText.toLowerCase();
        return fragments.filter(fragment => {
          return searchFields.some(field => {
            const fieldValue = fragment[field].toLowerCase();
            return fieldValue.includes(searchLower);
          });
        });
      }
    } else {
      const searchLower = searchText.toLowerCase();
      return fragments.filter(fragment => {
        return searchFields.some(field => {
          const fieldValue = fragment[field].toLowerCase();
          return fieldValue.includes(searchLower);
        });
      });
    }
  }

  /**
   * Apply time filter in memory
   */
  private applyTimeFilter(fragments: Fragment[], timeFilter: TimeFilter): Fragment[] {
    return fragments.filter(fragment => {
      // Check created date filters
      if (timeFilter.created?.after) {
        const afterDate = new Date(timeFilter.created.after);
        if (fragment.created < afterDate) return false;
      }
      if (timeFilter.created?.before) {
        const beforeDate = new Date(timeFilter.created.before);
        if (fragment.created >= beforeDate) return false;
      }
      
      // Check updated date filters
      if (timeFilter.updated?.after) {
        const afterDate = new Date(timeFilter.updated.after);
        if (fragment.updated < afterDate) return false;
      }
      if (timeFilter.updated?.before) {
        const beforeDate = new Date(timeFilter.updated.before);
        if (fragment.updated >= beforeDate) return false;
      }
      
      // Check lastNDays filter
      if (timeFilter.lastNDays) {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - timeFilter.lastNDays);
        if (fragment.updated < daysAgo) return false;
      }
      
      return true;
    });
  }

  /**
   * Apply post-processing like sorting
   */
  private applyPostProcessing(fragments: Fragment[], query: AdvancedFragmentQuery): Fragment[] {
    let processed = [...fragments];
    
    // Apply sorting
    if (query.sortBy && query.sortBy !== 'relevance') {
      processed.sort((a, b) => {
        let valueA: Date | string;
        let valueB: Date | string;
        
        switch (query.sortBy) {
          case 'created':
            valueA = a.created;
            valueB = b.created;
            break;
          case 'updated':
            valueA = a.updated;
            valueB = b.updated;
            break;
          case 'title':
            valueA = a.title.toLowerCase();
            valueB = b.title.toLowerCase();
            break;
          default:
            return 0;
        }
        
        const comparison = valueA < valueB ? -1 : valueA > valueB ? 1 : 0;
        return query.sortOrder === 'desc' ? -comparison : comparison;
      });
    }
    
    return processed;
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

  /**
   * Build SQL WHERE conditions from time filter
   */
  private buildTimeFilterConditions(timeFilter: TimeFilter): string[] {
    const conditions: string[] = [];
    
    // Handle created date filters
    if (timeFilter.created?.after) {
      conditions.push(`created > timestamp '${this.sanitizeTimestamp(timeFilter.created.after)}'`);
    }
    if (timeFilter.created?.before) {
      conditions.push(`created < timestamp '${this.sanitizeTimestamp(timeFilter.created.before)}'`);
    }
    
    // Handle updated date filters  
    if (timeFilter.updated?.after) {
      conditions.push(`updated > timestamp '${this.sanitizeTimestamp(timeFilter.updated.after)}'`);
    }
    if (timeFilter.updated?.before) {
      conditions.push(`updated < timestamp '${this.sanitizeTimestamp(timeFilter.updated.before)}'`);
    }
    
    // Handle lastNDays filter
    if (timeFilter.lastNDays) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - timeFilter.lastNDays);
      conditions.push(`updated > timestamp '${daysAgo.toISOString()}'`);
    }
    
    return conditions;
  }

  /**
   * Sanitize timestamp to prevent SQL injection
   */
  private sanitizeTimestamp(timestamp: string): string {
    // Parse and validate the timestamp, then convert back to ISO string
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid timestamp: ${timestamp}`);
    }
    return date.toISOString();
  }

  /**
   * Escape SQL string literals to prevent injection
   */
  private escapeSqlString(value: string): string {
    return value.replace(/'/g, "''");
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