---
id: ISSUE_15
type: issue
status: completed
timestamp: '2025-07-31T08:30:09.802Z'
lastUpdated: '2025-07-31T09:43:56.766Z'
tags:
  - enhancement
  - web-ui
  - file-based
  - integration
  - milestone
priority: high
---

# Connect web UI to file-based issue system

# Connect web UI to file-based issue system

## Description
The web UI currently uses the in-memory KnowledgeManager but needs to be updated to read from the file-based issue system in `.knowledge/` directories.

## Current State
- File-based issues stored in `.knowledge/{status}/*.md`
- Web UI reads from in-memory KnowledgeManager
- WebSocket handlers don't use FileBasedKnowledgeManager

## Requirements
1. **Update WebSocket Handlers:**
   - Modify `src/web/handlers/` to use FileBasedKnowledgeManager
   - Ensure all CRUD operations work with files
   - Maintain real-time updates

2. **File System Integration:**
   - Read issues from `.knowledge/` directories
   - Watch for file changes and broadcast updates
   - Handle file parsing errors gracefully

3. **API Consistency:**
   - Ensure web API matches MCP tool responses
   - Use same issue ID format
   - Consistent error handling

## Implementation Steps
1. Update `src/web/server.ts` to inject FileBasedKnowledgeManager
2. Modify WebSocket message handlers for issues
3. Add file watching for real-time updates
4. Test all CRUD operations through web UI

## Success Criteria
- Web UI displays all file-based issues
- Can create/update/delete issues via web UI
- Real-time sync between file changes and UI
- No data loss or corruption

Related to [[ISSUE_3]] - Builds on existing web UI update task