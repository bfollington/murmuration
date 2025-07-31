---
id: ISSUE_9
type: issue
status: completed
timestamp: '2025-07-31T06:36:53.004Z'
lastUpdated: '2025-07-31T07:28:55.470Z'
tags:
  - enhancement
  - knowledge-management
  - mcp-tool
  - persistence
title: Add persistent milestone tracking with MCP tool
priority: high
---

# Add persistent milestone tracking with MCP tool

# Add persistent milestone tracking with MCP tool

## Overview
Implement a system to capture and track the next "milestone" or "north star" for the project. This milestone should be:
1. Persisted to the filesystem between sessions
2. Exposed via an MCP tool for easy access and updates
3. Support changing/updating the milestone as project progresses

## Requirements

### Persistence
- Store milestone data in a structured format (JSON or markdown)
- Location: `.knowledge/GOAL.md or similar
- Include fields like:
  - title: Brief milestone description
  - description: Detailed explanation
  - targetDate: Optional target completion date
  - status: Current status (planned, in-progress, completed)
  - createdAt: Timestamp
  - updatedAt: Timestamp

### MCP Tools
Create new MCP tools:
1. `get_milestone` - Retrieve current milestone
2. `set_milestone` - Set or update the milestone

### Integration
- Milestone should be visible in web dashboard, we'll need to do [[ISSUE_3]] as well
- Suggest updating milestone after reaching it
- Allow linking issues to the current milestone via [[ISSUE_X]] syntax

## Benefits
- Clear project direction visible to all agents/sessions
- Progress tracking towards specific goals
- Historical record of project evolution
- Better coordination between different work sessions

## Implementation Notes
- Should integrate with existing knowledge management system
- Consider relationship between milestones and issues (issues can contribute to milestone completion)
- Simple API that other tools/agents can query

## Implementation Progress

### ✅ Step 1: Define Milestone Types
- Added MILESTONE to KnowledgeType enum
- Created Milestone interface extending KnowledgeEntry
- Implemented CreateMilestoneRequest with validation
- Added type guards and supporting infrastructure

### ✅ Step 2: Create Milestone File Format
- Extended file format utilities for milestone handling
- Created .knowledge/GOAL.md with proper YAML frontmatter
- Added serialization/parsing for milestone fields
- Verified cross-reference support works

### ✅ Step 3: Implement Milestone Persistence
- Created milestone-persistence.ts with load/save functions
- Implemented atomic writes and error handling
- Added comprehensive test suite (19 tests)
- Handles all edge cases gracefully

### ✅ Step 4: Create Milestone Manager
- Implemented MilestoneManager class with business logic
- Added progress tracking and issue linking
- Event emission for milestone changes
- Full test coverage (16 tests)

### ✅ Step 5: Add MCP Tools
- Added get_milestone tool (no parameters)
- Added set_milestone tool with validation
- Integrated with MCP server
- Tested end-to-end functionality

## Implementation Complete

The milestone tracking feature is now fully implemented and ready for use. The MCP tools `get_milestone` and `set_milestone` are available for tracking project milestones that persist between sessions.

Integration testing will be done through dogfooding. Documentation updates can be added as needed based on real usage experience.