/**
 * File format specifications for knowledge entries
 * 
 * This module defines the markdown format with YAML frontmatter for storing
 * knowledge entries as files in the file-based backend.
 */

import { KnowledgeType, TYPE_PREFIXES } from './types.ts';

/**
 * Cross-reference pattern for [[ENTRY_ID]] syntax
 */
export const CROSS_REFERENCE_PATTERN = /\[\[([A-Z]+_\d+)\]\]/g;

/**
 * Type prefixes for entry IDs
 */
export const QUESTION_ = TYPE_PREFIXES[KnowledgeType.QUESTION];
export const ANSWER_ = TYPE_PREFIXES[KnowledgeType.ANSWER];
export const NOTE_ = TYPE_PREFIXES[KnowledgeType.NOTE];
export const ISSUE_ = TYPE_PREFIXES[KnowledgeType.ISSUE];
export const MILESTONE_ = TYPE_PREFIXES[KnowledgeType.MILESTONE];

/**
 * Markdown file format specification
 * 
 * Each knowledge entry is stored as a markdown file with YAML frontmatter.
 * The file format follows this structure:
 * 
 * ```markdown
 * ---
 * id: ISSUE_123
 * type: issue
 * status: open
 * priority: high
 * assignee: john.doe
 * dueDate: 2024-01-15T00:00:00.000Z
 * timestamp: 2024-01-01T12:00:00.000Z
 * lastUpdated: 2024-01-02T14:30:00.000Z
 * tags:
 *   - bug
 *   - urgent
 *   - frontend
 * processId: proc_abc123
 * relatedIds:
 *   - NOTE_456
 *   - QUESTION_789
 * metadata:
 *   reporter: user123
 *   severity: critical
 * ---
 * 
 * # Fix login form validation
 * 
 * The login form is not properly validating email addresses, allowing
 * invalid formats to be submitted. This causes backend errors and poor
 * user experience.
 * 
 * ## Steps to Reproduce
 * 
 * 1. Navigate to /login
 * 2. Enter invalid email like "test@"
 * 3. Click submit
 * 
 * ## Expected Behavior
 * 
 * Form should show validation error before submission.
 * 
 * ## Related Issues
 * 
 * See [[NOTE_456]] for email validation patterns and [[QUESTION_789]]
 * for discussion on validation library options.
 * ```
 * 
 * ## Cross-References
 * 
 * Cross-references use the syntax [[ENTRY_ID]] where ENTRY_ID follows
 * the pattern: TYPE_NUMBER (e.g., ISSUE_123, NOTE_456, QUESTION_789)
 * 
 * ## Field Types by Entry Type
 * 
 * ### Common Fields (all types)
 * - id: string (e.g., "ISSUE_123")
 * - type: string (question|answer|note|issue)
 * - status: string (open|in-progress|completed|archived)
 * - timestamp: ISO date string
 * - lastUpdated: ISO date string
 * - tags: string array
 * - processId: optional string
 * - metadata: optional object
 * 
 * ### Question-specific
 * - answered: boolean
 * - answerIds: string array
 * - priority: optional string (low|medium|high)
 * 
 * ### Answer-specific
 * - questionId: string
 * - accepted: boolean
 * - votes: optional number
 * 
 * ### Note-specific
 * - category: optional string
 * - relatedIds: optional string array
 * 
 * ### Issue-specific
 * - priority: string (low|medium|high)
 * - assignee: optional string
 * - dueDate: optional ISO date string
 * - relatedIds: optional string array
 *
 * ### Milestone-specific
 * - title: string (brief milestone description)
 * - description: string (detailed explanation, stored in content)
 * - targetDate: optional ISO date string
 * - progress: optional number (0-100 percentage)
 * - relatedIssueIds: string array (for linked issues via [[ISSUE_X]])
 */

/**
 * File extension for knowledge entries
 */
export const KNOWLEDGE_FILE_EXTENSION = '.md';

/**
 * YAML frontmatter delimiters
 */
export const FRONTMATTER_DELIMITER = '---';

/**
 * Example markdown templates for each knowledge type
 */
export const MARKDOWN_TEMPLATES = {
  [KnowledgeType.QUESTION]: `---
id: QUESTION_1
type: question
status: open
answered: false
priority: medium
timestamp: 2024-01-01T12:00:00.000Z
lastUpdated: 2024-01-01T12:00:00.000Z
tags:
  - help
  - configuration
answerIds: []
metadata: {}
---

# How do I configure the process timeout?

I'm trying to set a custom timeout for long-running processes but can't
find the configuration option. Where should this be set?

## Context

I'm running batch processing jobs that take more than the default timeout.
`,

  [KnowledgeType.ANSWER]: `---
id: ANSWER_1
type: answer
status: open
questionId: QUESTION_1
accepted: false
timestamp: 2024-01-01T13:00:00.000Z
lastUpdated: 2024-01-01T13:00:00.000Z
tags:
  - configuration
  - timeout
votes: 0
metadata: {}
---

# Process Timeout Configuration

You can set the process timeout in the configuration file or via environment
variables:

## Configuration File

\`\`\`json
{
  "processTimeout": 300000
}
\`\`\`

## Environment Variable

\`\`\`bash
export PROCESS_TIMEOUT=300000
\`\`\`

See [[NOTE_123]] for more configuration options.
`,

  [KnowledgeType.NOTE]: `---
id: NOTE_1
type: note
status: open
category: observation
timestamp: 2024-01-01T14:00:00.000Z
lastUpdated: 2024-01-01T14:00:00.000Z
tags:
  - performance
  - monitoring
relatedIds:
  - QUESTION_456
metadata:
  severity: info
---

# Process Memory Usage Patterns

Observed that processes with large datasets tend to show memory growth
patterns during the initial loading phase, then stabilize.

## Key Observations

- Memory usage peaks at ~2x final size during loading
- Garbage collection occurs regularly after stabilization
- No memory leaks detected in 24-hour monitoring

## Related

This observation helps answer [[QUESTION_456]] about memory requirements.
`,

  [KnowledgeType.ISSUE]: `---
id: ISSUE_1
type: issue
status: open
priority: high
assignee: developer
dueDate: 2024-01-15T00:00:00.000Z
timestamp: 2024-01-01T15:00:00.000Z
lastUpdated: 2024-01-01T15:00:00.000Z
tags:
  - bug
  - urgent
  - process-manager
processId: proc_abc123
relatedIds:
  - NOTE_789
metadata:
  reporter: user123
  severity: critical
---

# Process fails to start with custom environment variables

When starting a process with custom environment variables, the process
fails to spawn with error "Environment variable format invalid".

## Steps to Reproduce

1. Start process with env vars: \`{"NODE_ENV": "development"}\`
2. Process fails immediately
3. Check logs for error message

## Expected Behavior

Process should start normally with the provided environment variables.

## Workaround

Using system environment variables works correctly. Issue seems specific
to runtime environment variable injection.

## Related

See [[NOTE_789]] for environment variable handling documentation.
`,

  [KnowledgeType.MILESTONE]: `---
id: MILESTONE_1
type: milestone
status: open
title: Phase 1 Implementation Complete
targetDate: 2024-12-31T00:00:00.000Z
progress: 25
timestamp: 2024-01-01T16:00:00.000Z
lastUpdated: 2024-01-01T16:00:00.000Z
tags:
  - milestone
  - phase-1
  - implementation
relatedIssueIds:
  - ISSUE_123
  - ISSUE_456
metadata:
  owner: development-team
  priority: high
---

# Phase 1 Implementation Complete

Complete the core functionality for the MCP Process Management Server including
process lifecycle management, registry operations, and basic monitoring capabilities.

## Key Deliverables

- Process spawning and monitoring system
- Registry-based process storage 
- MCP tool integration with 5 core tools
- Basic logging and error handling
- Unit test coverage for core modules

## Success Criteria

- All core MCP tools implemented and tested
- Process lifecycle (start/stop/monitor) working reliably
- Registry operations performant with 100+ processes
- Error handling covers edge cases
- Documentation complete for developer onboarding

## Related Issues

This milestone encompasses the following issues:
- [[ISSUE_123]] - Process manager implementation
- [[ISSUE_456]] - MCP server integration

## Progress Notes

- Core process management: ✅ Complete
- Registry implementation: ✅ Complete  
- MCP tools: 🔄 In Progress (3/5 tools complete)
- Testing: 📋 Pending
- Documentation: 📋 Pending
`
} as const;