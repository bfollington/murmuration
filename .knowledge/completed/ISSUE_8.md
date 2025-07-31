---
id: ISSUE_8
type: issue
status: completed
timestamp: '2025-07-31T06:28:32.691Z'
lastUpdated: '2025-07-31T06:35:15.339Z'
tags:
  - command
  - orientation
  - workflow
  - documentation
title: Create /murmuration command for Claude orientation
priority: high
---

# Create /murmuration command for Claude orientation

# Create /murmuration command for Claude orientation

Implement a `/murmuration` command that briefs a Claude instance on how to use the murmuration toolset effectively at the start of a session.

## Requirements

The command should provide initial orientation that covers:

1. **Issue-First Workflow**
   - Examine issues between each task
   - Record progress in issues as you work
   - Prefer issue tracking over TodoWrite() tool for persistence
   - Never add a feature without a corresponding issue

2. **Agent Usage**
   - Use planning and implementer agents to do the work
   - Stay focused on issues and the user's goal
   - Delegate complex tasks to specialized agents

3. **Best Practices**
   - Check existing issues before starting new work
   - Update issue status as work progresses (open → in-progress → completed)
   - Cross-reference related issues using [[ISSUE_ID]] syntax
   - Keep issues updated with findings and progress

Also cover normal 'bootup' concepts:
  - Read the `README.md`, `SPEC.md` and `llms.txt` files
  - Search the `.knowledge` folder for context
  - Document notes for future instances using the notes tools in murmuration

Write a report on to brief the lead project agent so we can get to work!

## Implementation Notes

- Should be a slash command that outputs a comprehensive prompt
- Include examples of proper murmuration workflow
- Emphasize the persistence benefits over ephemeral tools
- Guide Claude to be issue-driven rather than task-driven

## Expected Output

A `murmur.md` file containing a prompt that acts as a slashcommand for Claude orchestration to properly orient the assistant on the murmuration toolset and workflow.

## Completion Report

✅ **Implemented Successfully**

Created `murmur.md` with comprehensive /murmuration command content that includes:

1. **Core Principles Section**
   - Issue-first workflow with concrete examples
   - Persistent tracking preference over TodoWrite()
   - Agent delegation best practices

2. **Bootup Checklist**
   - Reading core docs (README.md, SPEC.md, llms.txt)
   - Checking existing knowledge in .knowledge folder
   - Reviewing open issues
   - Documenting for future instances

3. **Example Workflows**
   - Starting a new feature (with full issue lifecycle)
   - Debugging an issue (with agent delegation)
   - Cross-referencing related issues

4. **Best Practices & Quick Reference**
   - Issue hygiene guidelines
   - Knowledge capture practices
   - Complete command reference for all MCP tools

5. **Project Status Report**
   - Created comprehensive report as NOTE_1
   - Documented all phases and accomplishments
   - Listed next steps and recommendations
   - Cross-referenced with [[NOTE_1]]

The /murmuration command is now ready to use for orienting new Claude instances on the proper use of the murmuration toolset.