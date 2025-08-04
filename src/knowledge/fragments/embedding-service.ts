/**
 * Embedding Service
 * 
 * Provides text embedding functionality using LM Studio's embedding endpoint.
 * Uses the Qwen3-Embedding-0.6B-Q8_0.gguf model for generating vector embeddings.
 */

import { logger } from '../../shared/logger.ts';

/**
 * Configuration for the embedding service
 */
export interface EmbeddingConfig {
  /** Base URL for LM Studio API */
  baseUrl: string;
  
  /** Model name for embeddings */
  model: string;
  
  /** API timeout in milliseconds */
  timeout: number;
  
  /** Maximum retry attempts */
  maxRetries: number;
  
  /** Retry delay in milliseconds */
  retryDelay: number;
}

/**
 * Default configuration for LM Studio
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  baseUrl: 'http://localhost:1234/v1',
  model: 'text-embedding-ada-002', // LM Studio default
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 1000 // 1 second
};

/**
 * Embedding API response from LM Studio
 */
interface EmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

/**
 * Embedding service class
 */
export class EmbeddingService {
  private readonly config: EmbeddingConfig;
  
  constructor(config: Partial<EmbeddingConfig> = {}) {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  }
  
  /**
   * Generate embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    if (!text.trim()) {
      throw new Error('Text cannot be empty');
    }
    
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }
  
  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    
    // Filter out empty texts
    const validTexts = texts.filter(text => text.trim().length > 0);
    if (validTexts.length === 0) {
      throw new Error('All texts are empty');
    }
    
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.makeEmbeddingRequest(validTexts);
        
        // Sort by index to maintain order
        const sortedData = response.data.sort((a, b) => a.index - b.index);
        return sortedData.map(item => item.embedding);
        
      } catch (error) {
        lastError = error as Error;
        logger.warn('EmbeddingService', `Embedding attempt ${attempt} failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        if (attempt < this.config.maxRetries) {
          await this.delay(this.config.retryDelay * attempt);
        }
      }
    }
    
    throw new Error(`Failed to generate embeddings after ${this.config.maxRetries} attempts: ${lastError?.message}`);
  }
  
  /**
   * Generate embedding for fragment content (combines title and body)
   */
  async embedFragment(title: string, body: string): Promise<number[]> {
    // Combine title and body with separator
    const text = `${title}\n\n${body}`;
    return this.embed(text);
  }
  
  /**
   * Calculate cosine similarity between two embeddings
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embedding vectors must have the same length');
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }
    
    return dotProduct / denominator;
  }
  
  /**
   * Check if the embedding service is available
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to embed a simple test string
      await this.embed('test');
      return true;
    } catch (error) {
      logger.warn('EmbeddingService', `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    }
  }
  
  /**
   * Get embedding dimensions by making a test request
   */
  async getEmbeddingDimensions(): Promise<number> {
    const embedding = await this.embed('test');
    return embedding.length;
  }
  
  /**
   * Make HTTP request to LM Studio embedding endpoint
   */
  private async makeEmbeddingRequest(texts: string[]): Promise<EmbeddingResponse> {
    const url = `${this.config.baseUrl}/embeddings`;
    
    const requestBody = {
      model: this.config.model,
      input: texts
    };
    
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.config.timeout);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const data = await response.json() as EmbeddingResponse;
      
      // Validate response structure
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('Invalid response format: missing data array');
      }
      
      if (data.data.length !== texts.length) {
        throw new Error(`Expected ${texts.length} embeddings, got ${data.data.length}`);
      }
      
      // Validate each embedding
      for (const item of data.data) {
        if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
          throw new Error('Invalid embedding format');
        }
      }
      
      return data;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.timeout}ms`);
      }
      
      throw error;
    }
  }
  
  /**
   * Delay utility for retry logic
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Create a default embedding service instance
   */
  static createDefault(): EmbeddingService {
    return new EmbeddingService();
  }
}

/**
 * Singleton instance for global use
 */
let defaultEmbeddingService: EmbeddingService | null = null;

/**
 * Get the default embedding service instance
 */
export function getEmbeddingService(): EmbeddingService {
  if (!defaultEmbeddingService) {
    defaultEmbeddingService = EmbeddingService.createDefault();
  }
  return defaultEmbeddingService;
}

/**
 * Set a custom embedding service instance
 */
export function setEmbeddingService(service: EmbeddingService): void {
  defaultEmbeddingService = service;
}