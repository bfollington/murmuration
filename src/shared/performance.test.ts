import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  MemoryIndex,
  MemoryMultiIndex,
  LRUCache,
  paginate,
  debounce,
  throttle,
  BatchProcessor,
  PerformanceCollector,
  performanceCollector
} from './performance.ts';

// Test data
interface TestItem {
  id: string;
  name: string;
  category: string;
  tags: string[];
  value: number;
}

function createTestItems(count: number): TestItem[] {
  const items: TestItem[] = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: `item-${i}`,
      name: `Item ${i}`,
      category: `category-${i % 5}`,
      tags: [`tag-${i % 3}`, `tag-${i % 7}`],
      value: i
    });
  }
  return items;
}

Deno.test("MemoryIndex - basic operations", () => {
  const index = new MemoryIndex<TestItem>();
  const items = createTestItems(10);
  
  // Rebuild index
  index.rebuild(items, item => item.id);
  
  // Test get
  const item = index.get('item-5');
  assertExists(item);
  assertEquals(item.name, 'Item 5');
  
  // Test getMany
  const many = index.getMany(['item-1', 'item-3', 'item-invalid']);
  assertEquals(many.length, 2);
  assertEquals(many[0].id, 'item-1');
  assertEquals(many[1].id, 'item-3');
  
  // Test has
  assertEquals(index.has('item-0'), true);
  assertEquals(index.has('item-invalid'), false);
  
  // Test size
  assertEquals(index.size(), 10);
  
  // Test clear
  index.clear();
  assertEquals(index.size(), 0);
  assertEquals(index.get('item-0'), undefined);
});

Deno.test("MemoryMultiIndex - multi-field indexing", () => {
  const index = new MemoryMultiIndex<TestItem>();
  const items = createTestItems(20);
  
  // Add indexes
  index.addIndex('byCategory', item => item.category);
  index.addIndex('byTags', item => item.tags);
  
  // Rebuild
  index.rebuild(items);
  
  // Query by category
  const category2Items = index.get('byCategory', 'category-2');
  assertEquals(category2Items.length, 4); // items 2, 7, 12, 17
  assertEquals(category2Items.every(item => item.category === 'category-2'), true);
  
  // Query by tag
  const tag0Items = index.get('byTags', 'tag-0');
  // tag-0 appears on items where i % 3 == 0 OR i % 7 == 0
  // That's: 0, 3, 6, 7, 9, 12, 14, 15, 18 = 9 items
  assertEquals(tag0Items.length, 9);
  
  // Remove index
  index.removeIndex('byCategory');
  assertEquals(index.get('byCategory', 'category-2').length, 0);
  
  // Clear
  index.clear();
  assertEquals(index.get('byTags', 'tag-0').length, 0);
});

Deno.test("LRUCache - eviction policy", () => {
  const cache = new LRUCache<string, string>(3);
  
  // Fill cache
  cache.set('a', 'value-a');
  cache.set('b', 'value-b');
  cache.set('c', 'value-c');
  
  assertEquals(cache.size(), 3);
  assertEquals(cache.get('a'), 'value-a');
  
  // Add one more - should evict 'b' (a was accessed, so it's more recent)
  cache.set('d', 'value-d');
  
  assertEquals(cache.size(), 3);
  assertEquals(cache.has('b'), false); // b was evicted
  assertEquals(cache.has('a'), true);  // a is still there
  assertEquals(cache.has('c'), true);
  assertEquals(cache.has('d'), true);
  
  // Access 'c' to make it most recent
  cache.get('c');
  
  // Add another - should evict 'a' now
  cache.set('e', 'value-e');
  
  assertEquals(cache.has('a'), false); // a was evicted
  assertEquals(cache.has('c'), true);  // c is still there (recently accessed)
  assertEquals(cache.has('d'), true);
  assertEquals(cache.has('e'), true);
});

Deno.test("paginate - basic pagination", () => {
  const items = createTestItems(25);
  
  // Page 1
  const page1 = paginate(items, { page: 1, pageSize: 10 });
  assertEquals(page1.items.length, 10);
  assertEquals(page1.total, 25);
  assertEquals(page1.totalPages, 3);
  assertEquals(page1.hasNext, true);
  assertEquals(page1.hasPrevious, false);
  assertEquals(page1.items[0].id, 'item-0');
  
  // Page 2
  const page2 = paginate(items, { page: 2, pageSize: 10 });
  assertEquals(page2.items.length, 10);
  assertEquals(page2.hasNext, true);
  assertEquals(page2.hasPrevious, true);
  assertEquals(page2.items[0].id, 'item-10');
  
  // Last page
  const page3 = paginate(items, { page: 3, pageSize: 10 });
  assertEquals(page3.items.length, 5);
  assertEquals(page3.hasNext, false);
  assertEquals(page3.hasPrevious, true);
  assertEquals(page3.items[0].id, 'item-20');
  
  // Out of bounds - should clamp to last page
  const page99 = paginate(items, { page: 99, pageSize: 10 });
  assertEquals(page99.page, 3);
  assertEquals(page99.items.length, 5);
});

Deno.test("paginate - with sorting", () => {
  const items = createTestItems(10);
  
  // Sort by value descending
  const sorted = paginate(
    items,
    { page: 1, pageSize: 5, sortOrder: 'desc' },
    (a, b) => a.value - b.value
  );
  
  assertEquals(sorted.items.length, 5);
  assertEquals(sorted.items[0].id, 'item-9'); // Highest value first
  assertEquals(sorted.items[4].id, 'item-5');
});

Deno.test("debounce - delays execution", async () => {
  let callCount = 0;
  let lastValue = '';
  
  const debouncedFn = debounce((value: string) => {
    callCount++;
    lastValue = value;
  }, 50);
  
  // Call multiple times quickly
  debouncedFn('first');
  debouncedFn('second');
  debouncedFn('third');
  
  // Should not have been called yet
  assertEquals(callCount, 0);
  
  // Wait for debounce delay
  await new Promise(resolve => setTimeout(resolve, 60));
  
  // Should have been called once with last value
  assertEquals(callCount, 1);
  assertEquals(lastValue, 'third');
});

Deno.test("throttle - limits execution rate", async () => {
  let callCount = 0;
  const values: string[] = [];
  
  const throttledFn = throttle((value: string) => {
    callCount++;
    values.push(value);
  }, 50);
  
  // Call multiple times quickly
  throttledFn('first');  // Should execute
  throttledFn('second'); // Should be throttled
  throttledFn('third');  // Should be throttled
  
  // First call should execute immediately
  assertEquals(callCount, 1);
  assertEquals(values, ['first']);
  
  // Wait for throttle period to end
  await new Promise(resolve => setTimeout(resolve, 60));
  
  // Now we can call again
  throttledFn('fourth'); // Should execute
  assertEquals(callCount, 2);
  assertEquals(values, ['first', 'fourth']);
  
  // Wait for throttle to clear before test ends
  await new Promise(resolve => setTimeout(resolve, 60));
});

Deno.test("BatchProcessor - batches items", async () => {
  const processedBatches: string[][] = [];
  
  const processor = new BatchProcessor<string>(
    3, // batch size
    50, // delay
    async (items) => {
      processedBatches.push([...items]);
    }
  );
  
  // Add items - should trigger batch when size reached
  processor.add('item1');
  processor.add('item2');
  processor.add('item3'); // Should trigger immediate flush
  
  // Give time for async processing
  await new Promise(resolve => setTimeout(resolve, 10));
  
  assertEquals(processedBatches.length, 1);
  assertEquals(processedBatches[0], ['item1', 'item2', 'item3']);
  
  // Add more items - should wait for delay
  processor.add('item4');
  processor.add('item5');
  
  assertEquals(processedBatches.length, 1); // No new batch yet
  
  // Wait for delay
  await new Promise(resolve => setTimeout(resolve, 60));
  
  assertEquals(processedBatches.length, 2);
  assertEquals(processedBatches[1], ['item4', 'item5']);
});

Deno.test("PerformanceCollector - collects metrics", () => {
  const collector = new PerformanceCollector();
  
  // Record some metrics
  for (let i = 0; i < 10; i++) {
    collector.record('test-metric', i * 10);
  }
  
  const stats = collector.getStats('test-metric');
  assertExists(stats);
  assertEquals(stats.count, 10);
  assertEquals(stats.min, 0);
  assertEquals(stats.max, 90);
  assertEquals(stats.avg, 45);
  assertEquals(stats.p50, 50);
  assertEquals(stats.p95, 90);
  
  // Clear specific metric
  collector.clear('test-metric');
  assertEquals(collector.getStats('test-metric'), null);
});

Deno.test("Performance - handles large datasets efficiently", () => {
  const items = createTestItems(5000);
  const index = new MemoryIndex<TestItem>();
  
  // Measure indexing time
  const startIndex = performance.now();
  index.rebuild(items, item => item.id);
  const indexTime = performance.now() - startIndex;
  
  performanceCollector.record('index-rebuild-5000', indexTime);
  
  // Measure lookup time
  const startLookup = performance.now();
  for (let i = 0; i < 1000; i++) {
    index.get(`item-${Math.floor(Math.random() * 5000)}`);
  }
  const lookupTime = performance.now() - startLookup;
  
  performanceCollector.record('index-lookup-1000', lookupTime);
  
  // Measure pagination time
  const startPaginate = performance.now();
  const page = paginate(items, { page: 50, pageSize: 100 });
  const paginateTime = performance.now() - startPaginate;
  
  performanceCollector.record('paginate-5000', paginateTime);
  
  // Verify reasonable performance (these are generous limits)
  assertEquals(indexTime < 100, true, `Indexing took ${indexTime}ms`);
  assertEquals(lookupTime < 50, true, `1000 lookups took ${lookupTime}ms`);
  assertEquals(paginateTime < 50, true, `Pagination took ${paginateTime}ms`);
  assertEquals(page.items.length, 100);
});