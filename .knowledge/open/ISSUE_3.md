---
id: ISSUE_3
type: issue
status: open
timestamp: '2025-07-31T06:20:00.000Z'
lastUpdated: '2025-07-31T06:20:00.000Z'
tags:
  - web-ui
  - file-based
  - optional
priority: low
---

# Update Web UI for file-based knowledge

Modify the existing knowledge web UI to work with the file-based backend. This is optional since MCP tools are sufficient for dogfooding.

Tasks:
- Update WebSocket handlers to use FileBasedKnowledgeManager
- Ensure real-time updates still work with file watching
- Test creating/editing entries through the UI
- Add issue type to the UI components

Related to [[ISSUE_2]] - should be done after TodoWrite replacement.