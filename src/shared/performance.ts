/**
 * Performance Optimization Utilities
 * 
 * Provides indexing, caching, and pagination support for large datasets
 * to ensure smooth performance with 1000+ entries.
 */

/**
 * Generic index interface for fast lookups
 */
export interface Index<T> {
  get(key: string): T | undefined;
  getMany(keys: string[]): T[];
  has(key: string): boolean;
  rebuild(items: T[], keyExtractor: (item: T) => string): void;
  clear(): void;
  size(): number;
}

/**
 * Multi-field index for complex queries
 */
export interface MultiIndex<T> {
  addIndex(name: string, keyExtractor: (item: T) => string | string[]): void;
  removeIndex(name: string): void;
  rebuild(items: T[]): void;
  get(indexName: string, key: string): T[];
  clear(): void;
}

/**
 * Simple in-memory index implementation
 */
export class MemoryIndex<T> implements Index<T> {
  private map = new Map<string, T>();
  
  get(key: string): T | undefined {
    return this.map.get(key);
  }
  
  getMany(keys: string[]): T[] {
    return keys
      .map(key => this.map.get(key))
      .filter((item): item is T => item !== undefined);
  }
  
  has(key: string): boolean {
    return this.map.has(key);
  }
  
  rebuild(items: T[], keyExtractor: (item: T) => string): void {
    this.map.clear();
    for (const item of items) {
      const key = keyExtractor(item);
      this.map.set(key, item);
    }
  }
  
  clear(): void {
    this.map.clear();
  }
  
  size(): number {
    return this.map.size;
  }
}

/**
 * Multi-field index implementation
 */
export class MemoryMultiIndex<T> implements MultiIndex<T> {
  private indexes = new Map<string, {
    keyExtractor: (item: T) => string | string[];
    index: Map<string, Set<T>>;
  }>();
  
  addIndex(name: string, keyExtractor: (item: T) => string | string[]): void {
    this.indexes.set(name, {
      keyExtractor,
      index: new Map()
    });
  }
  
  removeIndex(name: string): void {
    this.indexes.delete(name);
  }
  
  rebuild(items: T[]): void {
    // Clear all indexes
    for (const [, indexData] of this.indexes) {
      indexData.index.clear();
    }
    
    // Rebuild all indexes
    for (const item of items) {
      for (const [, indexData] of this.indexes) {
        const keys = indexData.keyExtractor(item);
        const keyArray = Array.isArray(keys) ? keys : [keys];
        
        for (const key of keyArray) {
          if (!indexData.index.has(key)) {
            indexData.index.set(key, new Set());
          }
          indexData.index.get(key)!.add(item);
        }
      }
    }
  }
  
  get(indexName: string, key: string): T[] {
    const indexData = this.indexes.get(indexName);
    if (!indexData) {
      return [];
    }
    
    const items = indexData.index.get(key);
    return items ? Array.from(items) : [];
  }
  
  clear(): void {
    for (const [, indexData] of this.indexes) {
      indexData.index.clear();
    }
  }
}

/**
 * LRU Cache implementation
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    // Remove if exists (to update position)
    this.cache.delete(key);
    
    // Add to end
    this.cache.set(key, value);
    
    // Evict oldest if over capacity
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }
  
  has(key: K): boolean {
    return this.cache.has(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
}

/**
 * Pagination utilities
 */
export interface PaginationOptions {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export function paginate<T>(
  items: T[],
  options: PaginationOptions,
  sortComparator?: (a: T, b: T) => number
): PaginatedResult<T> {
  // Apply sorting if comparator provided
  let sorted = items;
  if (sortComparator) {
    sorted = [...items].sort(sortComparator);
    if (options.sortOrder === 'desc') {
      sorted.reverse();
    }
  }
  
  // Calculate pagination
  const total = sorted.length;
  const totalPages = Math.ceil(total / options.pageSize);
  const page = Math.max(1, Math.min(options.page, totalPages));
  const start = (page - 1) * options.pageSize;
  const end = start + options.pageSize;
  
  return {
    items: sorted.slice(start, end),
    total,
    page,
    pageSize: options.pageSize,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1
  };
}

/**
 * Debounce function for performance
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | undefined;
  
  return (...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = undefined;
    }, delay);
  };
}

/**
 * Throttle function for performance
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * Batch processor for efficient bulk operations
 */
export class BatchProcessor<T> {
  private batch: T[] = [];
  private timer?: number;
  
  constructor(
    private readonly batchSize: number,
    private readonly delay: number,
    private readonly processor: (items: T[]) => Promise<void>
  ) {}
  
  add(item: T): void {
    this.batch.push(item);
    
    if (this.batch.length >= this.batchSize) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }
  
  private scheduleFlush(): void {
    if (this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.flush();
      }, this.delay);
    }
  }
  
  async flush(): Promise<void> {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    
    if (this.batch.length > 0) {
      const items = this.batch;
      this.batch = [];
      await this.processor(items);
    }
  }
}

/**
 * Memory usage monitor
 */
export class MemoryMonitor {
  private measurements: Array<{ timestamp: Date; usage: number }> = [];
  private readonly maxMeasurements = 100;
  
  measure(): number {
    const usage = this.getCurrentMemoryUsage();
    
    this.measurements.push({
      timestamp: new Date(),
      usage
    });
    
    // Keep only recent measurements
    if (this.measurements.length > this.maxMeasurements) {
      this.measurements = this.measurements.slice(-this.maxMeasurements);
    }
    
    return usage;
  }
  
  getAverageUsage(periodMs: number = 60000): number {
    const now = Date.now();
    const recentMeasurements = this.measurements.filter(
      m => now - m.timestamp.getTime() <= periodMs
    );
    
    if (recentMeasurements.length === 0) return 0;
    
    const sum = recentMeasurements.reduce((acc, m) => acc + m.usage, 0);
    return sum / recentMeasurements.length;
  }
  
  getTrend(): 'increasing' | 'decreasing' | 'stable' {
    if (this.measurements.length < 10) return 'stable';
    
    const recent = this.measurements.slice(-10);
    const firstHalf = recent.slice(0, 5);
    const secondHalf = recent.slice(5);
    
    const avgFirst = firstHalf.reduce((acc, m) => acc + m.usage, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((acc, m) => acc + m.usage, 0) / secondHalf.length;
    
    const diff = avgSecond - avgFirst;
    const threshold = avgFirst * 0.1; // 10% change threshold
    
    if (diff > threshold) return 'increasing';
    if (diff < -threshold) return 'decreasing';
    return 'stable';
  }
  
  private getCurrentMemoryUsage(): number {
    // In Deno, we can estimate memory usage from performance API
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize || 0;
    }
    return 0;
  }
}

/**
 * Performance metrics collector
 */
export class PerformanceCollector {
  private metrics = new Map<string, number[]>();
  private readonly maxSamples = 1000;
  
  record(metric: string, value: number): void {
    if (!this.metrics.has(metric)) {
      this.metrics.set(metric, []);
    }
    
    const values = this.metrics.get(metric)!;
    values.push(value);
    
    // Keep only recent samples
    if (values.length > this.maxSamples) {
      this.metrics.set(metric, values.slice(-this.maxSamples));
    }
  }
  
  getStats(metric: string): {
    count: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  } | null {
    const values = this.metrics.get(metric);
    if (!values || values.length === 0) return null;
    
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    
    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)]
    };
  }
  
  clear(metric?: string): void {
    if (metric) {
      this.metrics.delete(metric);
    } else {
      this.metrics.clear();
    }
  }
}

// Export singleton instances for convenience
export const performanceCollector = new PerformanceCollector();
export const memoryMonitor = new MemoryMonitor();