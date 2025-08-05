---
id: ISSUE_26
type: issue
status: open
timestamp: '2025-08-05T08:44:34.461Z'
lastUpdated: '2025-08-05T08:44:34.461Z'
tags:
  - bug
  - fragments
  - persistence
  - search
title: 'Fragment System: Fix Tag Filtering and Persistence Issues'
priority: high
---

# Fragment System: Fix Tag Filtering and Persistence Issues

## Problem Summary

During testing of the enhanced fragment system (ISSUE_24), several bugs were discovered that need to be addressed:

## Issues Found

### 1. Tag Filtering Not Working
**Symptom**: Filtering fragments by tags returns no results even when fragments have matching tags
**Example**:
```typescript
// Fragment updated with tags: ["authentication", "nodejs", "security", "jwt", "oauth", "updated"]
list_fragments({ tags: ["updated"] })
// Result: Found 0 fragments (should have found 1)
```
**Likely Cause**: Tag filtering logic in `searchFragments()` may not be properly implemented or tags aren't being stored/retrieved correctly

### 2. Fragment Persistence Issues
**Symptom**: Some fragments disappear unexpectedly during operations
**Examples**:
- Fragment `711c3662-e4c3-41cf-90ff-f1eda3d33ba9` (API security) - created but couldn't be found later
- Fragment `fe72ad09-3d75-467f-98bf-36700a3b5630` (OAuth comparison) - disappeared after failed update attempt
- Fragment `2d392bb5-f31a-4a64-87af-ea7475775665` (test fragment) - not found after creation

**Likely Causes**:
- Failed operations may be partially completing (e.g., deleting old record but failing to insert new one)
- Vector embedding failures may corrupt the database state
- LanceDB transaction handling may need improvement

### 3. Advanced Search Restrictions
**Symptom**: `search_fragments_advanced` requires either `similarTo` or `textSearch`, preventing metadata-only queries
**Example**:
```typescript
search_fragments_advanced({ 
  tags: ["updated"], 
  timeFilter: { updated: { after: "2025-08-05T08:40:00Z" }}
})
// Error: Either similarTo or textSearch must be provided
```
**Impact**: Users can't use advanced search for pure metadata/time filtering with sorting

## Root Cause Analysis

### Tag Filtering
In `fragment-store.ts`, the tag filtering is done in-memory after the SQL query:
```typescript
// Line 278-282
if (query.tags && query.tags.length > 0) {
  filteredFragments = filteredFragments.filter(fragment => 
    fragment.tags && query.tags!.every(tag => fragment.tags!.includes(tag))
  );
}
```
This suggests tags might not be properly stored in the fragments table or aren't being deserialized correctly.

### Update/Delete Issues
The update pattern in LanceDB is delete + insert, which isn't atomic:
```typescript
// Line 201-202
await this.table!.delete(`id = '${request.id}'`);
await this.table!.add([row]);
```
If the add fails (e.g., vector issue), the fragment is lost.

## Proposed Fixes

### 1. Fix Tag Storage/Retrieval
- [ ] Verify tags are properly serialized/deserialized in `fragmentToRow`/`rowToFragment`
- [ ] Check if LanceDB is storing JSON string fields correctly
- [ ] Add logging to debug tag filtering
- [ ] Consider indexing tags for better performance

### 2. Improve Transaction Safety
- [ ] Implement proper error handling with rollback capability
- [ ] Try insert first, then delete old record only if successful
- [ ] Add transaction-like behavior or use LanceDB transactions if available
- [ ] Log all operations for debugging

### 3. Relax Advanced Search Requirements
- [ ] Make both `similarTo` and `textSearch` optional
- [ ] Allow pure metadata queries with sorting
- [ ] Update validation in `handleSearchFragmentsAdvanced`

### 4. Add Comprehensive Tests
- [ ] Test tag filtering with various tag combinations
- [ ] Test update failures and recovery
- [ ] Test fragment persistence across operations
- [ ] Add integration tests for complex scenarios

## Implementation Priority

1. **High**: Fix tag filtering (breaks basic functionality)
2. **High**: Fix persistence issues (data loss risk)
3. **Medium**: Relax advanced search restrictions
4. **Medium**: Add comprehensive test coverage

## Success Criteria

- [ ] Tag filtering returns correct results
- [ ] Fragments persist correctly even when operations fail
- [ ] Advanced search supports metadata-only queries
- [ ] All tests pass consistently
- [ ] No data loss during update operations