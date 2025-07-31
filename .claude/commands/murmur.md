# /murmuration - Claude Orientation for Murmuration Toolset

## Welcome to Murmuration

You are working with Murmuration, a comprehensive MCP Process Management Server with persistent knowledge management. This orientation will help you work effectively with the toolset.

## Core Principles

### 1. Issue-First Workflow

**ALWAYS start by checking existing issues:**
```bash
# List open issues to see what needs work
mcp.list_issues({ status: "open" })

# Check in-progress issues to avoid duplicating effort
mcp.list_issues({ status: "in-progress" })
```

**Before implementing ANY feature:**
1. Check if an issue exists for it
2. If not, create an issue FIRST using `mcp.record_issue()`
3. Update the issue to "in-progress" when you start work
4. Record progress and findings in the issue as you work
5. Mark as "completed" when done

### 2. Use Persistent Issue Tracking

**PREFER issue tracking over TodoWrite():**
- Issues persist between sessions (TodoWrite doesn't)
- Multiple agents can collaborate on the same issues
- Complete audit trail of changes
- Better organization with status-based workflow

**Example workflow:**
```typescript
// BAD: Using TodoWrite (ephemeral, lost between sessions)
TodoWrite([{ content: "Fix memory leak", status: "pending" }])

// GOOD: Using issue tracking (persistent, collaborative)
mcp.record_issue({
  title: "Fix WebSocket memory leak",
  content: "Detailed description of the problem...",
  priority: "high",
  tags: ["bug", "websocket", "memory"]
})
```

### 3. Leverage Specialized Agents

**Use the right agent for the job:**
- `plan-implementer`: For implementing features with clear scope
- `strategic-planner`: For planning complex tasks without implementing
- `systematic-debugger`: For debugging issues and troubleshooting
- `codebase-researcher`: For understanding existing code structure

**Stay focused on coordination:**
- You are the orchestrator, not the implementer
- Delegate complex tasks to specialized agents
- Track progress through issues
- Keep the user's goal in focus

## Bootup Checklist

When starting a new session, ALWAYS:

1. **Read core documentation:**
   ```bash
   # Understand the project
   Read("README.md")
   Read("SPEC.md")
   Read("llms.txt")
   ```

2. **Check existing knowledge:**
   ```bash
   # Search for relevant context
   Glob({ pattern: ".knowledge/**/*.md" })
   
   # Look for specific topics
   mcp.list_notes({ category: "configuration" })
   mcp.list_questions_and_answers({ answered: true })
   ```

3. **Review open issues:**
   ```bash
   # See what needs attention
   mcp.list_issues({ status: "open", limit: 10 })
   
   # Check high-priority items
   mcp.list_issues({ status: "open", tags: ["high-priority"] })
   ```

4. **Document for future instances:**
   ```bash
   # Record important discoveries
   mcp.record_note({
     category: "configuration",
     content: "Important finding that future agents need to know...",
     tags: ["setup", "important"]
   })
   ```

## Example Workflows

### Starting a New Feature

```typescript
// 1. First, check if issue exists
const issues = await mcp.list_issues({ 
  status: "open", 
  tags: ["enhancement"] 
});

// 2. Create issue if needed
const issue = await mcp.record_issue({
  title: "Add authentication to WebSocket server",
  content: "Implement JWT-based auth for WebSocket connections",
  priority: "medium",
  tags: ["enhancement", "security", "websocket"]
});

// 3. Update to in-progress
await mcp.update_issue({
  issue_id: issue.id,
  status: "in-progress"
});

// 4. Use appropriate agent
await Task({
  description: "Implement WebSocket authentication",
  subagent_type: "plan-implementer",
  prompt: `Implement JWT authentication for WebSocket server as described in ${issue.id}...`
});

// 5. Update issue with results
await mcp.update_issue({
  issue_id: issue.id,
  content: issue.content + "\n\n## Implementation Complete\n\nAdded JWT auth with...",
  status: "completed"
});
```

### Debugging an Issue

```typescript
// 1. Find the bug report
const bugs = await mcp.list_issues({ 
  status: "open", 
  tags: ["bug"] 
});

// 2. Start investigation
await mcp.update_issue({
  issue_id: "ISSUE_123",
  status: "in-progress"
});

// 3. Use debugger agent
await Task({
  description: "Debug memory leak",
  subagent_type: "systematic-debugger",
  prompt: "Investigate the WebSocket memory leak described in ISSUE_123..."
});

// 4. Document findings
await mcp.record_note({
  category: "troubleshooting",
  content: "Memory leak was caused by...",
  process_id: "related-process-id",
  tags: ["websocket", "memory", "solution"]
});
```

### Cross-Referencing Issues

```typescript
// When issues are related, link them
await mcp.update_issue({
  issue_id: "ISSUE_124",
  content: originalContent + "\n\nRelated to [[ISSUE_123]] - uses similar auth pattern"
});
```

## Best Practices

1. **Issue Hygiene:**
   - Keep titles clear and searchable
   - Use consistent tags (bug, enhancement, documentation)
   - Update status as work progresses
   - Cross-reference related issues

2. **Knowledge Capture:**
   - Document solutions in notes for future reference
   - Answer questions that arise during development
   - Tag knowledge entries for easy discovery

3. **Process Management:**
   - Use descriptive titles when starting processes
   - Monitor running processes regularly
   - Clean up failed processes
   - Document process configurations that work

4. **Collaboration:**
   - Write issues assuming another agent will implement
   - Include enough context for others to understand
   - Update issues with progress and blockers
   - Use cross-references to connect related work

## Quick Command Reference

```bash
# Issue Management
mcp.record_issue({ title, content, priority, tags })
mcp.list_issues({ status, tags, limit })
mcp.update_issue({ issue_id, status, content, priority, tags })
mcp.delete_issue({ issue_id })

# Knowledge Management
mcp.record_note({ category, content, tags })
mcp.record_question({ content, tags })
mcp.record_answer({ question_id, content })
mcp.list_notes({ category, tags })
mcp.list_questions_and_answers({ answered, tags })

# Process Management
mcp.start_process({ script_name, title, args })
mcp.list_processes({ status, limit })
mcp.stop_process({ process_id })
mcp.get_process_logs({ process_id })
```

## Remember

- **Issues first, implementation second**
- **Document as you go**
- **Use the right agent for the task**
- **Keep the user's goal in focus**
- **Persist knowledge for future sessions**

This orientation helps you work effectively with the Murmuration toolset. Always prioritize the issue-driven workflow and leverage the persistent knowledge base to build on previous work.