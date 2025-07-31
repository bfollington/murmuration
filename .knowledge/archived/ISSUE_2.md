---
id: ISSUE_2
type: issue
status: archived
timestamp: '2025-07-31T06:19:30.000Z'
lastUpdated: '2025-07-31T06:24:06.482Z'
tags:
  - file-based
  - migration
  - todowrite
priority: high
---

# Replace TodoWrite usage throughout codebase

Replace all instances of TodoWrite() tool with the new file-based issue management system. This includes:

- Find all TodoWrite() calls using grep
- Replace with record_issue MCP tool calls or direct file manager usage
- Ensure same functionality but persistent to files
- Update any agent instructions in CLAUDE.md to use the new system

This will complete the migration to persistent, file-based issue tracking that survives between sessions and enables multi-agent collaboration.