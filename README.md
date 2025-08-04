# Murmuration

<img width="300" height="200" alt="image" src="https://github.com/user-attachments/assets/146024ee-6251-4afa-a6ee-a770dbbdc01c" />

🐦‍⬛🕊️🦤🦉🦅🦢

A toolset for harmonious coordination between AI subagents, built on the Model Context Protocol (MCP). Murmuration provides process management, persistent knowledge storage, issue tracking, and intelligent queuing to enable multiple AI agents to work together effectively on complex tasks.

## Overview

Murmuration enables AI assistants to collaborate effectively through:

- **Process Management**: Start, monitor, and manage long-running processes with full lifecycle control
- **Knowledge Persistence**: Store and retrieve information using a vector database with semantic search
- **Issue Tracking**: File-based issue management system with kanban board visualization
- **Intelligent Queuing**: Priority-based process execution with configurable concurrency limits
- **Web Dashboard**: Real-time monitoring interface with WebSocket updates
- **Agent Coordination**: Specialized commands and workflows for multi-agent collaboration

This toolset is designed for complex AI-assisted development workflows where multiple agents need to coordinate their efforts, share knowledge, and track progress across sessions.

## Features

### Core Capabilities

#### Process Management
- **Lifecycle Control**: Start, stop, and monitor processes with configurable timeouts
- **Real-time Logging**: Stream stdout/stderr with automatic buffering and rotation
- **State Machine**: Validated transitions between starting, running, stopping, stopped, and failed states
- **Process Registry**: In-memory tracking with deep immutability protection
- **Graceful Shutdown**: Clean termination with force kill fallback

#### Knowledge Management (Fragments)
- **Vector Database**: LanceDB-powered semantic search with automatic embeddings
- **Unified Storage**: Replace separate Q&A and notes with flexible fragment types
- **Rich Metadata**: Tags, priority levels, status tracking, and cross-references
- **Multiple Types**: Questions, answers, notes, documentation, issues, solutions, references
- **Similarity Search**: Find related knowledge using vector embeddings

#### Issue Tracking System
- **File-Based Storage**: Markdown files organized by status (open/in-progress/completed/archived)
- **Rich Metadata**: Priority levels, tags, timestamps, and cross-references
- **Kanban Board**: Web-based visualization with drag-and-drop status updates
- **Persistent Tracking**: Issues survive between sessions for long-term project management
- **Milestone Support**: Track high-level goals and link related issues

#### Process Queue Management
- **Priority Execution**: 1-10 priority scale with automatic scheduling
- **Concurrency Control**: Configurable limits to prevent resource exhaustion
- **Retry Logic**: Automatic retries with exponential backoff for failed processes
- **Queue Persistence**: State survives server restarts
- **Queue Controls**: Pause, resume, and cancel queued processes

#### Web Dashboard
- **Real-time Updates**: WebSocket-based live process monitoring
- **Process Control**: Start, stop, and view logs from the browser
- **Issue Management**: Kanban board for visual issue tracking
- **Queue Visualization**: Monitor queue status and pending processes
- **Color-coded Logs**: Distinguish stdout, stderr, and system messages

#### Agent Coordination
- **Specialized Commands**: `/murmuration` for orientation, `/backlog` for planning
- **Issue-First Workflow**: Enforce documentation before implementation
- **Knowledge Sharing**: Agents can access shared knowledge base
- **Progress Tracking**: Multiple agents can collaborate on the same issues

## Installation

### Prerequisites

- [Deno](https://deno.land/) 1.40+ installed on your system

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd murmuration
   ```

2. **Install dependencies:**
   ```bash
   # Dependencies are automatically fetched by Deno
   deno cache src/main.ts
   ```

3. **Verify installation:**
   ```bash
   deno task build
   ```

## Usage

### Running the MCP Server

```bash
# Build the executable
deno task build

# Run directly (debug mode)
DEBUG=true deno run --allow-all src/main.ts

# Run the compiled binary
./build/mcp-process-server
```

### MCP Client Configuration

Add the process management server to your MCP client configuration:

```json
{
  "mcpServers": {
    "process-manager": {
      "command": "/path/to/murmuration/build/mcp-process-server",
      "args": [],
      "env": {
        "DEBUG": "false"
      }
    }
  }
}
```

### Available MCP Tools

The server provides comprehensive tools for process management, knowledge capture, issue tracking, and queue control:

#### Process Management Tools

- **`start_process`**: Launch a new process with optional queuing
- **`list_processes`**: Query processes with filtering and pagination
- **`get_process_status`**: Get detailed information about a specific process
- **`stop_process`**: Gracefully terminate a process with optional force kill
- **`get_process_logs`**: Retrieve stdout/stderr logs with filtering

#### Knowledge Management Tools (Fragments)

- **`record_fragment`**: Store knowledge with automatic vector embeddings
- **`list_fragments`**: List fragments with metadata filtering
- **`search_fragments_by_title`**: Find fragments by exact title match
- **`search_fragments_similar`**: Semantic search using vector similarity
- **`get_fragment`**: Retrieve a specific fragment by ID
- **`update_fragment`**: Modify existing fragments
- **`delete_fragment`**: Remove fragments from the knowledge base
- **`get_fragment_stats`**: Get statistics about the knowledge base

#### Issue Management Tools

- **`record_issue`**: Create new issues with priority and tags
- **`get_issue`**: Get detailed issue information including full history
- **`list_issues`**: Query issues by status, tags, or priority
- **`update_issue`**: Modify issue status, content, priority, or tags
- **`delete_issue`**: Remove issues from the tracking system

#### Queue Management Tools

- **`get_queue_status`**: View queue statistics and pending processes
- **`set_queue_config`**: Configure concurrency limits and retry settings
- **`pause_queue`**: Temporarily halt queue processing
- **`resume_queue`**: Resume queue processing after pause
- **`cancel_queued_process`**: Remove a process from the queue

#### Milestone Tools

- **`get_milestone`**: Retrieve current milestone information
- **`set_milestone`**: Update milestone with progress and related issues

### Example Workflows

#### Issue-Driven Development
```typescript
// 1. Create an issue before starting work
const issue = await record_issue({
  title: "Add authentication to API endpoints",
  content: `## Current State
- API endpoints have no authentication
- Need to add JWT validation

## Tasks
- [ ] Add auth middleware
- [ ] Validate tokens
- [ ] Handle auth errors`,
  priority: "high",
  tags: ["enhancement", "security"]
});

// 2. Update status when starting work
await update_issue({
  issue_id: issue.id,
  status: "in-progress"
});

// 3. Use specialized agent for implementation
await Task({
  description: "Implement API authentication",
  subagent_type: "plan-implementer",
  prompt: `Implement JWT authentication as described in ${issue.id}`
});

// 4. Mark complete when done
await update_issue({
  issue_id: issue.id,
  status: "completed"
});
```

#### Knowledge-Enhanced Debugging
```typescript
// 1. Search for similar past issues
const similar = await search_fragments_similar({
  query: "WebSocket memory leak disconnect handler",
  limit: 5,
  threshold: 0.7
});

// 2. Start debugging process
const debugProcess = await start_process({
  script_name: "node",
  title: "Memory Profiler",
  args: ["--inspect", "profile-memory.js"],
  priority: 8
});

// 3. Document the solution
await record_fragment({
  title: "WebSocket Memory Leak Fix",
  body: "Fixed by adding removeEventListener in disconnect handler",
  type: "solution",
  tags: ["websocket", "memory", "debugging"],
  metadata: { 
    issue_id: "ISSUE_123",
    process_id: debugProcess.id 
  }
});
```

#### Coordinated Multi-Agent Workflow
```typescript
// 1. Strategic planning agent creates the plan
await Task({
  description: "Plan refactoring strategy",
  subagent_type: "strategic-planner",
  prompt: "Plan how to refactor the authentication system"
});

// 2. Create issues for each component
const issues = [
  await record_issue({ 
    title: "Refactor JWT validation", 
    content: "...", 
    tags: ["refactor"]
  }),
  await record_issue({ 
    title: "Update auth middleware", 
    content: "...", 
    tags: ["refactor"]
  })
];

// 3. Multiple agents work on different issues
for (const issue of issues) {
  await start_process({
    script_name: "claude",
    title: `Work on ${issue.title}`,
    args: ["--issue", issue.id],
    priority: 7,
    immediate: false // Queue for managed execution
  });
}

// 4. Monitor progress via queue
const queueStatus = await get_queue_status({ 
  include_entries: true 
});
```

## Development

### Project Structure

```
murmuration/
├── src/
│   ├── shared/
│   │   ├── types.ts          # Core domain types (ProcessStatus, ProcessEntry, LogEntry)
│   │   └── logger.ts         # Smart logging system with MCP mode detection
│   ├── process/
│   │   ├── types.ts          # Process-specific types and validation  
│   │   ├── registry.ts       # ProcessRegistry data layer
│   │   └── manager.ts        # ProcessManager business logic
│   ├── mcp/
│   │   └── server.ts         # MCP integration layer
│   ├── web/
│   │   ├── types.ts          # WebSocket message types and ConnectionManager interface
│   │   └── types.test.ts     # ConnectionManager interface tests
│   └── main.ts               # Server entry point
├── deno.json                 # Deno configuration and tasks
├── CLAUDE.md                 # Developer guide
├── SPEC.md                   # Technical specification
└── README.md                 # This file
```

### Available Tasks

```bash
# Run the MCP server
deno task dev

# Build executable binary
deno task build

# Run the web interface (planned)
deno task web-dev

# Run tests
deno test

# Run tests with coverage
deno test --coverage

# Watch tests during development
deno test --watch
```

### Development Workflow

1. **Install Deno**: Ensure you have Deno 1.40+ installed
2. **Clone Repository**: Get the source code locally
3. **Run Tests**: Use `deno test` to verify everything works
4. **Make Changes**: Follow the patterns in `CLAUDE.md`
5. **Test Changes**: Write tests for new functionality
6. **Build**: Use `deno task build` to create executable

### Architecture

The project follows a domain-driven design with clear boundaries:

```
src/
├── shared/           # Core types and utilities
├── process/          # Process management domain
├── mcp/             # MCP server and tool definitions
├── web/             # WebSocket server and web UI handlers
├── knowledge/       # Knowledge base and issue tracking
├── queue/           # Process queuing and scheduling
└── main.ts          # Server entry point
```

#### Domain Boundaries

1. **Process Domain**: Manages process lifecycle, state transitions, and monitoring
2. **Knowledge Domain**: Handles fragments, issues, milestones, and cross-references
3. **Queue Domain**: Controls process scheduling, priorities, and concurrency
4. **Web Domain**: Provides real-time updates and browser interface
5. **MCP Domain**: Integrates all domains into MCP tools

### Key Design Principles

- **Type-First Development**: Define types before implementation
- **Domain-Driven Design**: Clear bounded contexts with minimal coupling
- **Event-Driven Architecture**: Domains communicate through events
- **Functional Core**: Pure functions for business logic
- **Immutable Data**: All operations return new objects
- **File-Based Persistence**: Simple, debuggable storage

## Testing

### Running Tests

```bash
# Run all tests
deno test

# Run specific test file
deno test src/process/registry.test.ts

# Run with coverage reporting
deno test --coverage

# Watch mode for development
deno test --watch
```

### Test Organization

- Test files use `.test.ts` suffix
- Tests are placed adjacent to source files
- Use descriptive test names that explain behavior
- Group related functionality with `Deno.test()`

### Example Test Structure

```typescript
import { assertEquals, assertThrows } from "@std/assert";
import { ProcessRegistry } from "./registry.ts";

Deno.test("ProcessRegistry - should store and retrieve processes", () => {
  const registry = new ProcessRegistry();
  const process = {
    id: "test-id",
    title: "Test Process",
    name: "test-process", 
    command: ["echo", "hello"],
    status: ProcessStatus.starting,
    startTime: new Date(),
    logs: [],
    metadata: {}
  };
  
  registry.addProcess(process);
  const retrieved = registry.getProcess("test-id");
  
  assertEquals(retrieved?.name, "test-process");
  assertEquals(retrieved?.command, ["echo", "hello"]);
});
```

## Special Features

### Agent Commands

Murmuration includes specialized commands in the `.claude/commands/` directory:

- **`/murmuration`**: Orientation guide for new agents working with the toolset
- **`/backlog`**: Agile backlog review process for issue management
- **`/suggest`**: Project-specific suggestions and patterns

### Web Interface

Access the dashboard at `http://localhost:8080` when running `deno task web`:

- **Process Monitor**: Real-time view of running processes with logs
- **Issue Board**: Kanban-style board for dragging issues between states
- **Queue Status**: Monitor pending processes and queue health
- **WebSocket Updates**: Live updates without page refresh

### Knowledge Base

The `.knowledge/` directory contains:
- **Issues**: Markdown files organized by status
- **Fragments**: LanceDB vector database for semantic search
- **Cross-references**: Automatic linking between related items

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEBUG` | Enable debug logging | `false` |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | `info` |
| `MAX_PROCESSES` | Maximum concurrent processes | `50` |
| `LOG_BUFFER_SIZE` | Maximum log entries per process | `1000` |
| `WEB_PORT` | Web interface port (if enabled) | `8080` |

### MCP Client Configuration

For Claude Desktop, add to your configuration:

```json
{
  "mcpServers": {
    "process-manager": {
      "command": "deno",
      "args": [
        "run",
        "--allow-run",
        "--allow-net", 
        "--allow-read",
        "--allow-write",
        "/absolute/path/to/murmuration/src/main.ts"
      ],
      "env": {
        "DEBUG": "false",
        "MAX_PROCESSES": "25"
      }
    }
  }
}
```

For other MCP clients, consult their documentation for server configuration.

## Process States

Processes managed by this server follow a defined state machine:

```
starting → running → stopping → stopped
    ↓         ↓         ↓
  failed    failed    failed
```

### State Descriptions

- **starting**: Process is being spawned
- **running**: Process is active and executing
- **stopping**: Process termination has been requested
- **stopped**: Process has exited normally
- **failed**: Process encountered an error or crashed

### Valid Transitions

- `starting` → `running` (spawn successful)
- `starting` → `failed` (spawn failed)
- `running` → `stopping` (termination requested)
- `running` → `stopped` (normal exit)
- `running` → `failed` (process error)
- `stopping` → `stopped` (termination successful)
- `stopping` → `failed` (termination failed)

## Troubleshooting

### Common Issues

**Process fails to start:**
- Check that the script/command exists and is executable
- Verify environment variables are correctly set
- Review process logs for error messages
- Ensure sufficient system resources are available

**Process appears stuck in 'starting' state:**
- Check if the process requires interactive input
- Verify the command syntax is correct
- Look for permission or path issues in logs

**High memory usage:**
- Reduce `LOG_BUFFER_SIZE` to limit log retention
- Monitor process count against `MAX_PROCESSES` limit
- Check for processes that should have been cleaned up

### Debug Mode

Enable debug logging for detailed information:

```bash
DEBUG=true deno task dev
```

Or set the environment variable in your MCP client configuration.

### Log Analysis

Process logs are categorized by type:
- `stdout`: Standard output from the process
- `stderr`: Error output from the process  
- `system`: Internal messages from the process manager

Use the `get_process_logs` tool to retrieve and analyze process output.

## Contributing

### Development Setup

1. Fork the repository
2. Clone your fork locally
3. Create a feature branch
4. Make your changes following the coding standards
5. Add tests for new functionality
6. Run the test suite to ensure everything passes
7. Submit a pull request

### Coding Standards

- Follow TypeScript best practices
- Use descriptive variable and function names
- Write comprehensive tests for new features
- Document complex logic with comments
- Follow the existing project structure and patterns

### Pull Request Guidelines

- Include a clear description of the changes
- Reference any related issues
- Ensure all tests pass
- Update documentation if needed
- Follow the commit message conventions

## Best Practices

### Issue-First Development
1. Always create an issue before starting work
2. Include concrete evidence, not speculation
3. List only known, actionable tasks
4. Update status as work progresses
5. Document solutions in the issue

### Knowledge Management
1. Use fragments for reusable knowledge
2. Tag entries for easy discovery
3. Link related items with cross-references
4. Prefer semantic search over exact matches
5. Document both problems and solutions

### Process Coordination
1. Use descriptive titles for all processes
2. Set appropriate priorities (1-10 scale)
3. Monitor queue status to prevent overload
4. Clean up failed processes promptly
5. Use the web dashboard for visual monitoring

### Multi-Agent Collaboration
1. Write clear issues that any agent can implement
2. Use the `/murmuration` command for orientation
3. Share knowledge through fragments
4. Update issues with progress regularly
5. Use specialized agents for their strengths

## License

[License information to be added]

## Support

For issues, questions, or contributions:

- Open an issue on the repository
- Review the `CLAUDE.md` developer guide for implementation details
- Check the `.claude/commands/` directory for workflow guides
- Use the web interface for visual debugging

---

*Murmuration: Enabling harmonious coordination between AI subagents through persistent knowledge, intelligent queuing, and shared context.*
