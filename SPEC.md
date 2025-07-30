# MCP Process Management Server Architecture

## Project Overview

A local Deno-based MCP server that manages asynchronous processes with both MCP client integration (Claude Desktop, Claude Code, Cursor) and web-based management interface via WebSocket streaming.

## Core Architecture

### MCP Server Layer

- **Framework**: Official TypeScript MCP SDK (`@modelcontextprotocol/sdk`)
- **Runtime**: Deno 2 with TypeScript compilation to executable binary
- **Transport**: stdio for local MCP clients (Claude Desktop, Claude Code)
- **Dependencies**:

  ```json
  {
    "@modelcontextprotocol/sdk": "latest",
    "@std/uuid": "jsr:@std/uuid",
    "@std/async": "jsr:@std/async",
    "@std/streams": "jsr:@std/streams"
  }
  ```

### Process Management Core

- **Process Spawning**: Deno.Command API for subprocess management
- **Process Registry**: Map-based process tracking with UUIDs
- **Process States**: `starting`, `running`, `stopping`, `stopped`, `failed`
- **Process Types**: Support for scripts, workflows, shell commands
- **Concurrency**: Promise queues and batching for efficient task management

### Web Interface Layer

- **Server**: Deno.serve() with WebSocket upgrade handling
- **Protocol**: WebSocket for real-time bidirectional communication
- **Frontend**: Single HTML page with vanilla JS/TypeScript client
- **Updates**: Live process status, logs, and management commands

## File Structure

```
project-root/
├── deno.json
├── src/
│   ├── main.ts              # MCP server entry point
│   ├── mcp/
│   │   ├── server.ts        # MCP server implementation
│   │   └── tools.ts         # MCP tool definitions
│   ├── process/
│   │   ├── manager.ts       # Process lifecycle management
│   │   ├── registry.ts      # Process tracking and state
│   │   └── types.ts         # Process-related types
│   ├── web/
│   │   ├── server.ts        # WebSocket server
│   │   ├── handlers.ts      # WebSocket message handlers
│   │   └── client.html      # Web interface
│   └── shared/
│       ├── types.ts         # Common types
│       └── utils.ts         # Shared utilities
├── scripts/                 # Example workflow scripts
└── build/                   # Compiled output
```

## MCP Tools Interface

### Core Tools

1. **`start_process`**
- Start predefined scripts/workflows
- Parameters: `script_name`, `args`, `env_vars`
- Returns: process ID and initial status
1. **`list_processes`**
- List all active/recent processes
- Returns: process summaries with states
1. **`get_process_status`**
- Get detailed process information
- Parameters: `process_id`
- Returns: full process state and recent logs
1. **`stop_process`**
- Terminate running process
- Parameters: `process_id`, `force` (optional)
- Returns: termination status
1. **`get_process_logs`**
- Retrieve process output logs
- Parameters: `process_id`, `lines` (optional)
- Returns: stdout/stderr content

## Process Management Implementation

### Process Registry Structure

```typescript
interface ProcessEntry {
  id: string;
  name: string;
  command: string[];
  status: ProcessStatus;
  startTime: Date;
  endTime?: Date;
  pid?: number;
  child?: Deno.ChildProcess;
  logs: LogEntry[];
  metadata: Record<string, unknown>;
}

interface LogEntry {
  timestamp: Date;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
}
```

### Process Lifecycle

1. **Registration**: Add to registry with `starting` status
2. **Spawning**: Use Deno.Command with piped stdio
3. **Monitoring**: Stream stdout/stderr to log buffers
4. **State Updates**: Broadcast changes via WebSocket
5. **Cleanup**: Handle process exit and resource cleanup

## WebSocket Protocol

### Message Types

```typescript
// Client to Server
type ClientMessage =
  | { type: 'list_processes' }
  | { type: 'start_process', payload: StartProcessRequest }
  | { type: 'stop_process', payload: { id: string } }
  | { type: 'get_logs', payload: { id: string, lines?: number } }
  | { type: 'subscribe', payload: { processId: string } };

// Server to Client
type ServerMessage =
  | { type: 'process_list', payload: ProcessEntry[] }
  | { type: 'process_started', payload: ProcessEntry }
  | { type: 'process_updated', payload: ProcessEntry }
  | { type: 'process_ended', payload: ProcessEntry }
  | { type: 'log_update', payload: { id: string, logs: LogEntry[] } }
  | { type: 'error', payload: { message: string } };
```

### WebSocket Connection Management

- Concurrent connection handling with async connection loops
- Client subscription system for targeted updates
- Automatic cleanup on disconnect
- Heartbeat/ping-pong for connection health

## Configuration & Setup

### deno.json

```json
{
  "name": "mcp-process-server",
  "version": "0.1.0",
  "tasks": {
    "dev": "deno run --allow-run --allow-net --allow-read --allow-write src/main.ts",
    "build": "deno compile --allow-run --allow-net --allow-read --allow-write --output ./build/mcp-process-server src/main.ts",
    "web-dev": "deno run --allow-net --allow-read src/web/server.ts"
  },
  "imports": {
    "@std/": "https://deno.land/std@0.208.0/",
    "@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@latest"
  },
  "compilerOptions": {
    "strict": true,
    "allowJs": true,
    "checkJs": false
  }
}
```

### MCP Client Configuration

For Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "process-manager": {
      "command": "/path/to/build/mcp-process-server"
    }
  }
}
```

## Implementation Strategy

### Phase 1: Core MCP Server

- Basic process spawning and management
- MCP tool implementations
- Process registry and state management

### Phase 2: WebSocket Interface

- Web server with WebSocket support
- Real-time process monitoring
- Basic web UI for process management

### Phase 3: Advanced Features

- Process queuing and batching
- Enhanced web UI with charts/graphs
- new tools to track questions, answers and notes during a session
  - record_question
  - record_answer
  - list_questions_and_answers
  - record_note
  - list_notes
  - delete_note
  - update_note

## Key Technical Considerations

### Concurrency & Resource Management

- Use Promise queues to prevent resource exhaustion
- Implement process limits and cleanup policies
- Handle zombie processes and resource leaks

### Security (Local-only Context)

- No authentication needed for local-only deployment
- Process isolation via Deno permissions
- Script whitelisting for predefined workflows

### Error Handling

- Graceful process termination on server shutdown
- WebSocket reconnection logic
- Comprehensive error logging and reporting

### Performance

- Compile to standalone binary for easy distribution
- Efficient log streaming without memory leaks
- Process monitoring without polling overhead

This architecture provides a solid foundation for iterative development while supporting both MCP integration and web-based management from day one.
