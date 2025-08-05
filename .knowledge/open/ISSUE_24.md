---
id: ISSUE_24
type: issue
status: open
timestamp: '2025-08-05T07:13:56.291Z'
lastUpdated: '2025-08-05T07:13:56.291Z'
tags:
  - enhancement
  - fragments
  - search
  - performance
title: 'Fragment System: Add Time Filtering, Combined Queries, and Bidirectional Links'
priority: high
---

# Fragment System: Add Time Filtering, Combined Queries, and Bidirectional Links

## Summary

Enhance the fragment system with time-based filtering, combined query capabilities, and robust bidirectional linking. LanceDB already supports the necessary SQL features - we just need to expose them through our MCP tools.

## Current Implementation

- Timestamps stored as ISO strings in `created` and `updated` fields
- Basic SQL filtering for type, status, priority
- Vector similarity search with limited metadata filters
- One-way `relatedIds` array with no integrity checks

## Proposed Changes

### 1. Time-Based Filtering (Quick Win)

LanceDB supports SQL timestamp comparisons. Add to existing tools:

```typescript
// Add to FragmentQuery and FragmentSimilarityQuery
timeFilter?: {
  created?: { after?: string; before?: string; }
  updated?: { after?: string; before?: string; }
  // Convenience option
  lastNDays?: number;
}
```

Implementation in fragment-store.ts:
```typescript
// In searchFragments() and searchFragmentsSimilar()
if (query.timeFilter?.created?.after) {
  conditions.push(`created > timestamp '${query.timeFilter.created.after}'`);
}
if (query.timeFilter?.lastNDays) {
  const date = new Date();
  date.setDate(date.getDate() - query.timeFilter.lastNDays);
  conditions.push(`updated > timestamp '${date.toISOString()}'`);
}
```

### 2. Combined Query Tool

Create `search_fragments_advanced` that combines all search methods:

```typescript
interface AdvancedFragmentQuery {
  // Vector search (optional)
  similarTo?: string;
  
  // Text search with regex support
  textSearch?: string;
  useRegex?: boolean;
  
  // All existing filters
  type?: FragmentType;
  status?: FragmentStatus;
  priority?: FragmentPriority;
  tags?: string[];
  timeFilter?: TimeFilter;
  
  // Control and pagination
  filterMode?: 'pre' | 'post'; // default: 'pre'
  limit?: number;
  offset?: number;
}
```

This leverages LanceDB's ability to combine vector search with SQL WHERE clauses.

### 3. Bidirectional Links System

Create a separate links table for better querying:

```typescript
// New table: fragment_links
interface FragmentLink {
  id: string;
  sourceId: string;
  targetId: string;
  linkType: 'answers' | 'references' | 'related' | 'supersedes';
  created: string; // ISO timestamp
  metadata?: Record<string, any>;
}
```

New MCP tools:
- `create_fragment_link` - Creates bidirectional link
- `delete_fragment_link` - Removes link safely
- `get_fragment_links` - Get all links for a fragment
- `traverse_fragment_links` - Follow links N levels deep

Benefits:
- Query both directions efficiently: `WHERE sourceId = ? OR targetId = ?`
- Maintain referential integrity
- Support typed relationships
- Easy to add link metadata

### 4. Performance Optimizations

1. **Add scalar indexes**:
   ```sql
   CREATE INDEX idx_created ON fragments(created);
   CREATE INDEX idx_updated ON fragments(updated);
   CREATE INDEX idx_source ON fragment_links(sourceId);
   CREATE INDEX idx_target ON fragment_links(targetId);
   ```

2. **Use pre-filtering** by default (better for large datasets)

3. **Batch link queries** to avoid N+1 problems

## Implementation Steps

### Phase 1: Time Filtering (1-2 days)
- [ ] Add timeFilter to FragmentQuery interface
- [ ] Update searchFragments() with timestamp WHERE clauses
- [ ] Add timeFilter to search_fragments_similar
- [ ] Create scalar indexes on date columns
- [ ] Update MCP tool schemas
- [ ] Add tests for date filtering

### Phase 2: Combined Search (2-3 days)
- [ ] Create AdvancedFragmentQuery interface
- [ ] Implement searchFragmentsAdvanced() method
- [ ] Add regex support using regexp_match()
- [ ] Create search_fragments_advanced MCP tool
- [ ] Add query plan logging
- [ ] Test various query combinations

### Phase 3: Links Table (3-4 days)
- [ ] Design fragment_links table schema
- [ ] Create FragmentLinkStore class
- [ ] Implement link CRUD operations
- [ ] Add bidirectional querying
- [ ] Create link-related MCP tools
- [ ] Add link integrity checks
- [ ] Migrate existing relatedIds data

### Phase 4: Link Traversal (2-3 days)
- [ ] Implement get_fragment_with_links tool
- [ ] Add traverse_fragment_links with depth limit
- [ ] Implement cycle detection
- [ ] Add link path finding
- [ ] Create link statistics tool
- [ ] Performance test deep traversals

## Technical Notes

1. **LanceDB SQL Examples**:
   ```python
   # Time + type filter
   .where("created > timestamp '2024-01-01' AND type = 'question'")
   
   # Complex conditions
   .where("(updated > timestamp '2024-12-01') AND (status IN ('active', 'draft'))")
   
   # Regex search
   .where("regexp_match(body, 'auth.*token')")
   ```

2. **Known Limitations**:
   - Date filtering + FTS bug (reported Sept 2024) - use vector search instead
   - No native JOINs - implement via multiple queries
   - Field names with periods not supported

3. **Migration Strategy**:
   - Keep relatedIds field for backwards compatibility
   - Populate links table from existing relatedIds
   - Mark relatedIds as deprecated
   - Remove in future version

## Success Criteria

- [ ] Can query fragments by date ranges
- [ ] Can combine vector + text + metadata + time in one query  
- [ ] Links persist when fragments are edited
- [ ] Can traverse fragment relationships efficiently
- [ ] All existing tools continue working
- [ ] Performance remains under 100ms for typical queries

## Future Enhancements

- Graph visualization of fragment relationships
- Link strength/confidence scores
- Auto-suggested links based on content similarity
- Time-based link expiration
- Fragment versioning with link history