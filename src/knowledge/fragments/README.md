# Fragment Knowledge System

This directory contains the new fragment-based knowledge management system that replaces the old question/answer/note tools with a unified LanceDB-powered approach.

## Overview

The fragment system provides:
- **Vector similarity search** using LanceDB for semantic knowledge retrieval
- **Unified data model** that can represent questions, answers, notes, documentation, etc.
- **Embedding generation** via LM Studio integration
- **Type-safe TypeScript API** with comprehensive error handling
- **Migration tools** to convert existing knowledge data

## Architecture

```
fragments/
├── fragment-types.ts      # Core types and interfaces
├── embedding-service.ts   # LM Studio integration for embeddings
├── fragment-store.ts      # LanceDB storage and retrieval
├── fragment-tools.ts      # High-level operations
├── migrate.ts             # Legacy data migration
├── fragment-store.test.ts # Unit tests
├── mod.ts                 # Module exports
└── README.md              # This file
```

## Key Components

### FragmentStore
The core storage layer using LanceDB for vector operations:
- Creates/reads/updates/deletes fragments
- Vector similarity search with configurable thresholds
- Metadata filtering and full-text search
- Automatic embedding generation

### EmbeddingService
Handles text-to-vector conversion using LM Studio:
- Configurable endpoint (default: http://localhost:1234/v1)
- Batch processing with retry logic
- Health checking and error handling
- Cosine similarity calculations

### FragmentTools
High-level operations for application use:
- Validation and error handling
- Consistent response formats
- Statistics and health monitoring
- Easy integration with MCP tools

## Usage

### Basic Operations

```typescript
import { FragmentStore, CreateFragmentRequest } from './fragment-store.ts';

const store = new FragmentStore();
await store.initialize();

// Create a fragment
const request: CreateFragmentRequest = {
  title: 'How to deploy the application',
  body: 'Use `deno task build` followed by copying the build directory...',
  type: 'documentation',
  tags: ['deployment', 'build'],
  priority: 'high'
};

const fragment = await store.createFragment(request);

// Search by similarity
const results = await store.searchFragmentsSimilar({
  query: 'deployment process',
  limit: 5,
  threshold: 0.7
});

// Search by metadata
const docs = await store.searchFragments({
  type: 'documentation',
  tags: ['deployment'],
  limit: 10
});
```

### MCP Integration

The fragment system provides these MCP tools:
- `record_fragment` - Create new fragments
- `list_fragments` - List with filtering
- `search_fragments_by_title` - Exact title search
- `search_fragments_similar` - Vector similarity search
- `get_fragment` - Retrieve by ID
- `update_fragment` - Modify existing fragments
- `delete_fragment` - Remove fragments
- `get_fragment_stats` - System statistics

### Migration

To migrate from the old knowledge system:

```bash
deno run --allow-all src/knowledge/fragments/migrate.ts
```

This will:
1. Read existing knowledge-state.json
2. Convert entries to fragments
3. Generate embeddings for vector search
4. Backup the original data
5. Report migration statistics

## Configuration

### LM Studio Setup
1. Install and run LM Studio
2. Load an embedding model (recommended: Qwen3-Embedding-0.6B-Q8_0.gguf)
3. Start the server on http://localhost:1234
4. The system will automatically connect and generate embeddings

### Database Storage
- Fragments are stored in `.knowledge/lance_fragments/` directory
- LanceDB handles vector indexing and similarity search automatically
- Data is persisted across application restarts

## Fragment Types

The system supports these fragment types:
- `question` - Questions that need answers
- `answer` - Responses to questions
- `note` - General observations and notes
- `documentation` - How-to guides and references
- `issue` - Problems and their context
- `solution` - Resolutions to problems
- `reference` - External links and resources

## Testing

Run the tests with:
```bash
deno test src/knowledge/fragments/fragment-store.test.ts --allow-all
```

The tests use a mock embedding service to avoid dependencies on external services.

## Performance Considerations

- **Embeddings**: Generated asynchronously with batching support
- **Vector Search**: LanceDB provides efficient ANN (Approximate Nearest Neighbor) search
- **Metadata Filtering**: SQL-based filtering for fast structured queries
- **Caching**: Connection pooling and query result caching where appropriate

## Error Handling

The system provides comprehensive error handling:
- Network timeouts and retries for embedding service
- Validation of fragment data before storage
- Graceful degradation when embedding service is unavailable
- Detailed logging for debugging and monitoring

## Future Enhancements

Potential improvements:
- Multiple embedding model support
- Custom similarity scoring algorithms
- Advanced filtering with boolean queries
- Real-time fragment recommendations
- Integration with external knowledge bases