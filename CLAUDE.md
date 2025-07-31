# MCP Process Management Server - Developer Guide

This guide provides essential information for developing and maintaining the MCP Process Management Server (Murmuration).

## Project Status

- **Phase 1**: ✅ Core MCP server with process management
- **Phase 2**: ✅ WebSocket server and browser interface  
- **Phase 3**: ✅ Knowledge management, queuing, and integrations
- **Phase 4**: ✅ File-based issue tracking system

## Quick Start

```bash
# Run the MCP server
deno run --allow-all src/main.ts

# Start web interface (port 8080)
deno task web

# Run tests
deno test --allow-all

# Development mode
deno task dev
```

## Architecture Overview

```
src/
├── shared/           # Core types and utilities
├── process/          # Process management domain
├── mcp/             # MCP server integration
├── web/             # WebSocket server and UI
├── knowledge/       # Knowledge management system
├── queue/           # Process queuing system
└── main.ts          # Server entry point
```

### Design Principles

1. **Type-First Development** - Define types before implementation
2. **Domain-Driven Design** - Clear bounded contexts
3. **Functional Programming** - Pure functions, immutable data
4. **Event-Driven** - Loose coupling between modules
5. **File-Based Persistence** - Simple JSON/Markdown storage

## Core Features

### Process Management

**MCP Tools:**
- `start_process` - Start processes with title, script, args, env vars
- `list_processes` - Query with filtering and pagination
- `get_process_status` - Detailed process information
- `stop_process` - Graceful/forced termination
- `get_process_logs` - Retrieve logs with filtering

**Key Types:**
```typescript
interface ProcessEntry {
  id: string;
  title: string;        // Required user-friendly identifier
  name: string;         // Process/command name
  command: string[];
  status: ProcessStatus;
  startTime: Date;
  logs: LogEntry[];
  // ... additional fields
}
```

### Knowledge Management

**MCP Tools:**
- `record_question` - Record questions for later answering
- `record_answer` - Answer previously asked questions
- `list_questions_and_answers` - Browse knowledge base
- `record_note` - Create standalone notes
- `list_notes` - Retrieve categorized notes

**Storage:** Persisted to `knowledge-state.json`

### Issue Tracking

**MCP Tools:**
- `record_issue` - Create new issues
- `get_issue` - Get issue details
- `list_issues` - List with filtering
- `update_issue` - Update status/content
- `delete_issue` - Remove issues

**File Structure:**
```
.knowledge/
├── open/
├── in-progress/
├── completed/
└── archived/
```

**Issue Format:**
```markdown
---
id: ISSUE_123
title: Fix memory leak
priority: high
status: open
tags: [bug, memory]
---

# Fix memory leak

Description of the issue...
```

### Process Queue

**MCP Tools:**
- `start_process` - With `immediate: false` to queue
- `get_queue_status` - View queue state
- `pause_queue` / `resume_queue` - Queue control
- `cancel_queued_process` - Remove from queue

**Features:**
- Priority-based execution (1-10 scale)
- Configurable concurrency limits
- Automatic retry with backoff
- Persistent queue state

### Milestones

**MCP Tools:**
- `get_milestone` - Current milestone info
- `set_milestone` - Update milestone with progress

**Usage:** Track high-level project goals and link issues to milestones.

## Web Interface

Access at `http://localhost:8080` when running `deno task web`.

**Features:**
- Real-time process monitoring
- Start/stop processes
- View logs with color coding
- WebSocket-based updates
- Queue visualization

## Development Guidelines

### Testing

```bash
# Run all tests
deno test --allow-all

# Specific test file
deno test src/process/manager.test.ts --allow-all

# With coverage
deno test --coverage --allow-all
```

### Adding New Features

1. **Define Types First**
   ```typescript
   // src/feature/types.ts
   interface FeatureConfig {
     // Define the domain model
   }
   ```

2. **Create Pure Functions**
   ```typescript
   // src/feature/utils.ts
   function validateFeature(config: FeatureConfig): boolean {
     // Pure validation logic
   }
   ```

3. **Build Manager/Service**
   ```typescript
   // src/feature/manager.ts
   class FeatureManager {
     // Orchestrate operations
   }
   ```

4. **Add MCP Integration**
   ```typescript
   // src/mcp/tools/feature.ts
   const featureTool = {
     name: "feature_action",
     description: "...",
     inputSchema: { ... },
     handler: async (args) => { ... }
   };
   ```

5. **Write Tests**
   ```typescript
   // src/feature/manager.test.ts
   Deno.test("FeatureManager - should handle case", () => {
     // Test implementation
   });
   ```

### Common Patterns

**State Transitions:**
```typescript
const VALID_TRANSITIONS = [
  { from: Status.A, to: Status.B, action: 'trigger' }
];

function isValidTransition(from: Status, to: Status): boolean {
  return VALID_TRANSITIONS.some(t => t.from === from && t.to === to);
}
```

**Event Handling:**
```typescript
manager.on('event:type', (data) => {
  // React to events
  websocket.broadcast({ type: 'update', data });
});
```

**File Operations:**
```typescript
// Atomic writes
await Deno.writeTextFile(path + '.tmp', content);
await Deno.rename(path + '.tmp', path);
```

## Troubleshooting

### Common Issues

1. **Permission Errors**
   - Run with `--allow-all` or specific permissions
   - Check file/directory ownership

2. **Port Already in Use**
   - Change port in `deno.json` or kill existing process
   - Default ports: MCP (stdio), Web (8080)

3. **Type Errors**
   - Run `deno check src/main.ts` to verify types
   - May need `--no-check` for complex type intersections

4. **Process Cleanup**
   - Processes are killed on server shutdown
   - Check for orphaned processes with `ps aux | grep [process]`

### Debug Mode

```bash
# Enable debug logging
DEBUG=true deno run --allow-all src/main.ts

# MCP mode detection
# Logs are suppressed when stdio is piped (MCP mode)
```

## Best Practices

1. **Use Clear Titles** - Always provide descriptive titles for processes and issues
2. **Tag Consistently** - Use standard tags: bug, enhancement, documentation
3. **Update Status** - Move issues through workflow: open → in-progress → completed
4. **Cross-Reference** - Link related issues with `[[ISSUE_ID]]` syntax
5. **Clean Shutdown** - Always gracefully stop the server with Ctrl+C

## Future Enhancements

Potential areas for expansion:

- **External Integrations**: GitHub, Slack, databases
- **Advanced Analytics**: ML-based insights, anomaly detection  
- **Enhanced UI**: React/Vue dashboard, mobile support
- **Distributed Mode**: Multi-server coordination
- **Plugin System**: Extensible architecture

## Contributing

When contributing:

1. Follow existing patterns and conventions
2. Add tests for new functionality
3. Update this guide for significant changes
4. Ensure all tests pass before submitting

For more detailed implementation information, refer to the source code and inline documentation.