---
id: ISSUE_16
type: issue
status: open
timestamp: '2025-07-31T08:31:23.697Z'
lastUpdated: '2025-07-31T08:31:23.697Z'
tags:
  - enhancement
  - web-ui
  - hud
  - milestone
  - ui-design
title: Create unified HUD layout for web UI
priority: medium
---

# Create unified HUD layout for web UI

# Create unified HUD layout for web UI

## Description
Transform the current sectioned dashboard into a unified HUD (Heads-Up Display) that shows issues, processes, and notes in a single, cohesive interface.

## Current State
- Dashboard has separate tabs/sections for processes, queue, knowledge
- Each section operates independently
- No unified view of system state

## Requirements
1. **Unified Layout:**
   - Single-page view without tabs
   - Kanban board as primary focus (left/center)
   - Process monitor sidebar (right)
   - Notes/knowledge panel (bottom or collapsible)

2. **HUD Features:**
   - Compact, information-dense display
   - Real-time updates across all sections
   - Minimal chrome, maximum content
   - Dark mode friendly design

3. **Layout Mockup:**
```
┌─────────────────────────────────────────────────────┐
│ Murmuration HUD                    🔍 Search    ⚙️   │
├───────────────────────────────────┬─────────────────┤
│          KANBAN BOARD             │    PROCESSES    │
│  ┌──────┬──────┬──────┬──────┐   │ ┌─────────────┐ │
│  │ OPEN │ WIP  │ DONE │ ARCH │   │ │ ▶ Process 1 │ │
│  ├──────┼──────┼──────┼──────┤   │ │ ⏸ Process 2 │ │
│  │ cards│ cards│ cards│      │   │ │ ✓ Process 3 │ │
│  │      │      │      │      │   │ └─────────────┘ │
│  └──────┴──────┴──────┴──────┘   │ Queue: 3 pending│
├───────────────────────────────────┴─────────────────┤
│ NOTES & KNOWLEDGE                          [▼ Hide] │
│ Recent notes, Q&A, documentation links              │
└─────────────────────────────────────────────────────┘
```

## Implementation Details
1. Redesign `public/index.html` for HUD layout
2. Update CSS for compact, dense information display
3. Modify JavaScript to manage unified state
4. Add collapsible panels for space efficiency
5. Implement responsive breakpoints

## Success Criteria
- All information visible at a glance
- No need to switch tabs/pages
- Efficient use of screen space
- Fast, responsive interactions
- Works on standard desktop resolutions

## Dependencies
- Requires [[ISSUE_14]] - Kanban board component
- Requires [[ISSUE_15]] - File-based issue integration
- Builds on [[ISSUE_13]] - Static file serving

Related to milestone: Web UI HUD with URL returns from MCP tools