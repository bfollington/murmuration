---
id: ISSUE_14
type: issue
status: open
timestamp: '2025-07-31T08:29:51.768Z'
lastUpdated: '2025-07-31T08:30:30.988Z'
tags:
  - enhancement
  - web-ui
  - kanban
  - milestone
  - ui-component
title: Create kanban board UI for issues
priority: high
---

# Create kanban board UI for issues

# Create kanban board UI for issues

## Description
Build a kanban-style board interface to visualize issues in their workflow states. This is a core requirement of the milestone for the web UI HUD.

## Requirements
1. **Kanban Columns:**
   - Open (todo)
   - In Progress
   - Completed
   - Archived (optional view)

2. **Card Features:**
   - Display issue title, ID, priority
   - Show tags as colored badges
   - Click to view full details
   - Drag and drop between columns

3. **Board Features:**
   - Real-time updates via WebSocket
   - Filter by tags, priority
   - Search functionality
   - Responsive design

## Technical Implementation
1. Create new UI component in `public/js/`
2. Add drag-and-drop library or implement native HTML5 DnD
3. Connect to WebSocket for real-time updates
4. Add API endpoints for issue state changes
5. Update CSS for kanban layout

## UI Mockup Structure
```
┌─────────────┬─────────────┬─────────────┐
│    OPEN     │ IN PROGRESS │  COMPLETED  │
├─────────────┼─────────────┼─────────────┤
│ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │
│ │ ISSUE_12│ │ │ ISSUE_11│ │ │ ISSUE_1 │ │
│ │ High    │ │ │ High    │ │ │ Low     │ │
│ │ [tags]  │ │ │ [tags]  │ │ │ [tags]  │ │
│ └─────────┘ │ └─────────┘ │ └─────────┘ │
│ ┌─────────┐ │             │             │
│ │ ISSUE_13│ │             │             │
│ └─────────┘ │             │             │
└─────────────┴─────────────┴─────────────┘
```

## Dependencies
- Requires [[ISSUE_15]] - Web UI must read file-based issues
- Works with [[ISSUE_13]] - Needs static file serving

Related to milestone: Web UI HUD with URL returns from MCP tools