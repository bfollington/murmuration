# LanceDB Fragment Tools Implementation Guide

This guide provides complete implementation for fragment storage and search tools using LanceDB with Deno, based on patterns from the dialog-deno-kv project.

## Prerequisites

- **LanceDB**: `@lancedb/lancedb@^0.13.0`
- **Deno**: Latest version with `--unstable-kv` flag
- **Embedding Model**: LM Studio with `Qwen3-Embedding-0.6B-Q8_0.gguf` or similar

## Installation

Add to your `deno.json`:

```json
{
  "imports": {
    "@lancedb/lancedb": "npm:@lancedb/lancedb@^0.13.0"
  }
}
```

## Core Implementation

### 1. Fragment Schema and Types

```typescript
// fragment-types.ts
export interface FragmentData {
  id: string;
  title: string;
  body: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface FragmentEmbedding {
  fragment_id: string;
  title: string;
  body: string;
  vector: number[];
  metadata: string; // JSON stringified metadata
  created_at: string;
  updated_at: string;
  indexed_at: string;
  model_version: string;
}

export interface SearchResult<T> {
  data: T;
  score: number;
  distance: number;
}
```

### 2. Embedding Service

```typescript
// embedding-service.ts
export class EmbeddingService {
  private config = {
    baseUrl: "http://localhost:1234/v1",
    apiKey: "lm-studio",
    model: "Qwen3-Embedding-0.6B-Q8_0.gguf",
    timeout: 30000,
  };

  async embedText(text: string): Promise<number[]> {
    const response = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: [text],
      }),
    });

    if (!response.ok) {
      throw new Error(`Embedding failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  }

  async getVectorDimension(): Promise<number> {
    const testVector = await this.embedText("test");
    return testVector.length;
  }
}
```

### 3. Fragment Store Manager

```typescript
// fragment-store.ts
import * as lancedb from "@lancedb/lancedb";
import { EmbeddingService } from "./embedding-service.ts";
import type { FragmentData, FragmentEmbedding, SearchResult } from "./fragment-types.ts";

export class FragmentStore {
  private db: lancedb.Database | null = null;
  private table: lancedb.Table | null = null;
  private embeddingService = new EmbeddingService();
  private vectorDimension = 768; // Default, will be updated on init

  async initialize(dbPath = "./lance_fragments"): Promise<void> {
    // Connect to LanceDB
    this.db = await lancedb.connect(dbPath);

    // Get actual vector dimension
    this.vectorDimension = await this.embeddingService.getVectorDimension();

    // Create or open table
    try {
      this.table = await this.db.openTable("fragments");
      console.log("✅ Opened existing fragments table");
    } catch {
      // Create new table with sample schema
      const sampleSchema: FragmentEmbedding = {
        fragment_id: "",
        title: "",
        body: "",
        vector: new Array(this.vectorDimension).fill(0),
        metadata: "{}",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        indexed_at: new Date().toISOString(),
        model_version: "Qwen3-Embedding-0.6B-Q8_0.gguf",
      };

      this.table = await this.db.createTable("fragments", [sampleSchema], { mode: "create" });
      console.log("✅ Created new fragments table");
    }
  }

  async recordFragment(title: string, body: string, metadata?: Record<string, any>): Promise<string> {
    if (!this.table) throw new Error("Store not initialized");

    const fragmentId = `F_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    // Generate embedding for title + body
    const combinedText = `${title}\n\n${body}`;
    const embedding = await this.embeddingService.embedText(combinedText);

    const record: FragmentEmbedding = {
      fragment_id: fragmentId,
      title,
      body,
      vector: embedding,
      metadata: JSON.stringify(metadata || {}),
      created_at: now,
      updated_at: now,
      indexed_at: now,
      model_version: "Qwen3-Embedding-0.6B-Q8_0.gguf",
    };

    await this.table.add([record]);
    console.log(`✅ Recorded fragment: ${fragmentId}`);

    return fragmentId;
  }

  async listFragments(metadata?: Record<string, any>, limit = 100): Promise<FragmentData[]> {
    if (!this.table) throw new Error("Store not initialized");

    let query = this.table.query();

    // Apply metadata filters if provided
    if (metadata) {
      // LanceDB doesn't support JSON queries directly, so we fetch all and filter
      const results = await query.limit(1000).toArray();

      return results
        .filter(row => {
          try {
            const rowMeta = JSON.parse(row.metadata);
            return Object.entries(metadata).every(([key, value]) => rowMeta[key] === value);
          } catch {
            return false;
          }
        })
        .slice(0, limit)
        .map(row => ({
          id: row.fragment_id,
          title: row.title,
          body: row.body,
          metadata: JSON.parse(row.metadata),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    }

    // No filters, return latest
    const results = await query
      .limit(limit)
      .toArray();

    return results.map(row => ({
      id: row.fragment_id,
      title: row.title,
      body: row.body,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async searchByTitle(exactTitle: string): Promise<FragmentData[]> {
    if (!this.table) throw new Error("Store not initialized");

    const results = await this.table
      .query()
      .where(`title = '${exactTitle.replace(/'/g, "''")}'`)
      .toArray();

    return results.map(row => ({
      id: row.fragment_id,
      title: row.title,
      body: row.body,
      metadata: JSON.parse(row.metadata),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async searchSimilar(query: string, limit = 10, minScore = 0.0): Promise<SearchResult<FragmentData>[]> {
    if (!this.table) throw new Error("Store not initialized");

    // Generate query embedding
    const queryEmbedding = await this.embeddingService.embedText(query);

    // Vector search with all fields selected
    const results = await this.table
      .vectorSearch(queryEmbedding)
      .select(["fragment_id", "title", "body", "metadata", "created_at", "updated_at", "_distance"])
      .limit(limit)
      .toArray();

    // Convert to SearchResult format
    const searchResults: SearchResult<FragmentData>[] = results.map((row: any) => ({
      data: {
        id: row.fragment_id,
        title: row.title,
        body: row.body,
        metadata: JSON.parse(row.metadata),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
      score: 1.0 - (row._distance || 0),
      distance: row._distance || 0,
    }));

    // Filter by minimum score
    return searchResults.filter(result => result.score >= minScore);
  }

  async close(): Promise<void> {
    // LanceDB connections close automatically
    this.db = null;
    this.table = null;
  }
}
```

### 4. Tool Functions Implementation

```typescript
// fragment-tools.ts
import { FragmentStore } from "./fragment-store.ts";

// Initialize store singleton
let store: FragmentStore | null = null;

async function getStore(): Promise<FragmentStore> {
  if (!store) {
    store = new FragmentStore();
    await store.initialize();
  }
  return store;
}

/**
 * Record a new fragment with automatic embedding
 */
export async function recordFragment(
  title: string,
  body: string,
  metadata?: Record<string, any>
): Promise<{ id: string; success: boolean }> {
  try {
    const fragmentStore = await getStore();
    const id = await fragmentStore.recordFragment(title, body, metadata);
    return { id, success: true };
  } catch (error) {
    console.error("Failed to record fragment:", error);
    throw error;
  }
}

/**
 * List all fragments, optionally filtered by metadata
 */
export async function listFragments(
  metadata?: Record<string, any>,
  limit = 100
): Promise<Array<{
  id: string;
  title: string;
  body: string;
  metadata: Record<string, any>;
  createdAt: string;
}>> {
  try {
    const fragmentStore = await getStore();
    return await fragmentStore.listFragments(metadata, limit);
  } catch (error) {
    console.error("Failed to list fragments:", error);
    throw error;
  }
}

/**
 * Search for fragments by exact title match
 */
export async function searchFragmentsByTitle(
  title: string
): Promise<Array<{
  id: string;
  title: string;
  body: string;
  metadata: Record<string, any>;
}>> {
  try {
    const fragmentStore = await getStore();
    return await fragmentStore.searchByTitle(title);
  } catch (error) {
    console.error("Failed to search by title:", error);
    throw error;
  }
}

/**
 * Search for similar fragments using vector similarity
 */
export async function searchFragmentsSimilar(
  query: string,
  limit = 10,
  minScore = 0.5
): Promise<Array<{
  fragment: {
    id: string;
    title: string;
    body: string;
    metadata: Record<string, any>;
  };
  score: number;
  distance: number;
}>> {
  try {
    const fragmentStore = await getStore();
    const results = await fragmentStore.searchSimilar(query, limit, minScore);

    return results.map(result => ({
      fragment: result.data,
      score: result.score,
      distance: result.distance,
    }));
  } catch (error) {
    console.error("Failed to search similar fragments:", error);
    throw error;
  }
}
```

## Usage Examples

### Basic Usage

```typescript
// example.ts
import {
  recordFragment,
  listFragments,
  searchFragmentsByTitle,
  searchFragmentsSimilar,
} from "./fragment-tools.ts";

// Record a new fragment
const result = await recordFragment(
  "Understanding LanceDB",
  "LanceDB is a vector database that integrates seamlessly with modern ML workflows...",
  { category: "database", tags: ["vector", "embeddings"] }
);
console.log(`Created fragment: ${result.id}`);

// List all fragments with specific metadata
const dbFragments = await listFragments({ category: "database" }, 20);
console.log(`Found ${dbFragments.length} database fragments`);

// Search by exact title
const titleMatches = await searchFragmentsByTitle("Understanding LanceDB");
console.log(`Found ${titleMatches.length} exact title matches`);

// Search for similar content
const similar = await searchFragmentsSimilar(
  "How do vector databases work with embeddings?",
  5,
  0.7
);

for (const result of similar) {
  console.log(`- ${result.fragment.title} (score: ${result.score.toFixed(3)})`);
}
```

### Advanced Integration

```typescript
// advanced-example.ts

// Batch import fragments
async function batchImportFragments(fragments: Array<{ title: string; body: string; tags?: string[] }>) {
  const results = [];

  for (const fragment of fragments) {
    try {
      const result = await recordFragment(
        fragment.title,
        fragment.body,
        { tags: fragment.tags || [], importedAt: new Date().toISOString() }
      );
      results.push({ ...result, title: fragment.title });
    } catch (error) {
      console.error(`Failed to import "${fragment.title}":`, error);
      results.push({ success: false, title: fragment.title, error });
    }
  }

  return results;
}

// Semantic search with context
async function semanticSearchWithContext(query: string, contextMetadata?: Record<string, any>) {
  // First get similar fragments
  const similar = await searchFragmentsSimilar(query, 20, 0.5);

  // Filter by context metadata if provided
  if (contextMetadata) {
    return similar.filter(result => {
      const meta = result.fragment.metadata;
      return Object.entries(contextMetadata).every(([key, value]) => meta[key] === value);
    });
  }

  return similar;
}

// Find related fragments
async function findRelatedFragments(fragmentId: string, limit = 5) {
  // First, get the original fragment
  const fragments = await listFragments();
  const original = fragments.find(f => f.id === fragmentId);

  if (!original) {
    throw new Error(`Fragment ${fragmentId} not found`);
  }

  // Search for similar content, excluding the original
  const similar = await searchFragmentsSimilar(
    `${original.title} ${original.body}`,
    limit + 1,
    0.6
  );

  return similar
    .filter(result => result.fragment.id !== fragmentId)
    .slice(0, limit);
}
```

## Environment Configuration

Create a `.env` file:

```bash
# LM Studio Configuration
LM_STUDIO_BASE_URL=http://localhost:1234/v1
LM_STUDIO_EMBEDDING_MODEL=Qwen3-Embedding-0.6B-Q8_0.gguf

# LanceDB Configuration
LANCE_DB_PATH=./lance_fragments
```

## Best Practices

1. **Embedding Model**: Use a consistent embedding model. The Qwen 0.6B model provides good performance for most use cases.

2. **Metadata Design**: Keep metadata flat and simple. LanceDB doesn't support complex JSON queries efficiently.

3. **Batch Operations**: For bulk imports, consider batching embeddings:

```typescript
async function batchRecordFragments(fragments: Array<{ title: string; body: string }>) {
  const batchSize = 10;

  for (let i = 0; i < fragments.length; i += batchSize) {
    const batch = fragments.slice(i, i + batchSize);
    await Promise.all(
      batch.map(f => recordFragment(f.title, f.body))
    );

    // Cooldown between batches
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

4. **Error Handling**: Always wrap tool calls in try-catch blocks and provide meaningful error messages.

5. **Performance**: Vector dimension affects performance. The 768-dimension vectors from Qwen provide a good balance.

## Troubleshooting

### Common Issues

1. **Connection Refused**: Ensure LM Studio is running on port 1234
2. **Dimension Mismatch**: Delete the lance_fragments directory and reinitialize if you change embedding models
3. **Memory Issues**: For large datasets, implement pagination in list operations

### Debug Mode

```typescript
// Enable debug logging
export function enableDebugMode() {
  console.log("🔍 Debug mode enabled");
  // Add request/response logging to embedding service
  // Add query logging to fragment store
}
```

## Migration from Existing Data

If you have existing fragments in another format:

```typescript
async function migrateFromJSON(jsonPath: string) {
  const data = JSON.parse(await Deno.readTextFile(jsonPath));

  for (const item of data) {
    await recordFragment(
      item.title || item.name,
      item.content || item.body || item.text,
      {
        ...item.metadata,
        migratedFrom: jsonPath,
        migratedAt: new Date().toISOString()
      }
    );
  }
}
```

This guide provides everything needed to implement the fragment tools in a new Deno project using LanceDB.
