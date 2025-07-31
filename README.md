# MCP Process Management Server

A Model Context Protocol (MCP) server that provides background process management capabilities for AI assistants and automation workflows. This server allows Claude and other MCP-compatible AI systems to start, monitor, and manage long-running processes in a controlled environment.

## Overview

The MCP Process Management Server enables AI assistants to:

- **Start Background Processes**: Launch scripts, commands, and long-running tasks
- **Monitor Process Status**: Track running, stopped, and failed processes
- **Capture Process Output**: Stream and store stdout/stderr from managed processes  
- **Manage Process Lifecycle**: Stop, restart, and clean up processes as needed
- **Query Process Information**: List processes with filtering and search capabilities

This is particularly useful for AI-assisted development workflows where Claude needs to run build tools, development servers, tests, or other background tasks while maintaining context about their status and output.

## Features

### Phase 1 - Core MCP Server (✅ COMPLETE)

- ✅ **Type-Safe Process Management**: Comprehensive TypeScript types for all process operations
- ✅ **Process Registry**: In-memory storage with CRUD operations for process tracking
- ✅ **State Machine**: Explicit process state transitions with validation
- ✅ **Deep Immutability**: Protection against external mutations of process data
- ✅ **Query System**: Flexible filtering, sorting, and pagination for process lists
- ✅ **Process Manager**: Business logic layer for process lifecycle management
- ✅ **MCP Integration**: Full Model Context Protocol server implementation with 5 tools
- ✅ **Log Streaming**: Real-time capture and streaming of process output
- ✅ **Process Monitoring**: Automatic stdout/stderr capture with log rotation
- ✅ **Graceful Shutdown**: Clean process termination with configurable timeouts
- ✅ **Title Field**: Mandatory user-friendly titles for process identification

### Phase 2 - Enhanced Features (🚧 IN PROGRESS)

- 🚧 **Web Dashboard**: Real-time process monitoring interface
  - ✅ WebSocket message types defined with full validation
  - ✅ ConnectionManager interface with subscription tracking
  - ✅ Basic WebSocket server with connection lifecycle management
  - ✅ ConnectionManager implementation with comprehensive test coverage
  - 🔄 WebSocket message processing (Step 5 next)
  - 📋 ProcessManager integration (Step 6)
- 🚧 **Process Templates**: Predefined workflows and scripts
- 🚧 **Enhanced Statistics**: Memory usage, CPU metrics
- 🚧 **Log Persistence**: Optional file-based log storage

### Phase 3 - Advanced Capabilities (📋 PLANNED)

- 📋 **Process Queuing**: Manage resource limits and scheduling
- 📋 **Auto-restart Policies**: Handle crashed processes automatically
- 📋 **Event System**: WebSocket-based real-time events
- 📋 **Process Groups**: Manage related processes together
- 📋 **Metrics Export**: Prometheus/OpenTelemetry integration

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

The server provides comprehensive tools for process management, knowledge capture, and issue tracking:

#### Process Management Tools

##### `start_process`
Start a new background process:
```json
{
  "script_name": "npm",
  "title": "Development Server",
  "args": ["run", "dev"],
  "env_vars": {
    "NODE_ENV": "development",
    "PORT": "3000"
  },
  "name": "dev-server",
  "priority": 5,
  "immediate": false
}
```

##### `stop_process`
Stop a running process:
```json
{
  "process_id": "uuid-process-id",
  "force": false,
  "timeout": 5000
}
```

##### `list_processes`
List and filter processes:
```json
{
  "status": "running",
  "limit": 10,
  "sort_by": "startTime",
  "sort_order": "desc"
}
```

##### `get_process_logs`
Retrieve process output:
```json
{
  "process_id": "uuid-process-id",
  "limit": 100,
  "log_type": "stdout"
}
```

##### `get_process_status`
Get detailed status of a specific process:
```json
{
  "process_id": "uuid-process-id"
}
```

#### Issue Management Tools

##### `record_issue`
Create a new issue for tracking tasks and problems:
```json
{
  "title": "Fix WebSocket memory leak",
  "content": "WebSocket connections are not being properly cleaned up when clients disconnect.",
  "priority": "high",
  "tags": ["bug", "websocket", "memory"]
}
```

##### `get_issue`
Get detailed information for a specific issue:
```json
{
  "issue_id": "ISSUE_123"
}
```

##### `list_issues`
List issues with optional filtering:
```json
{
  "status": "open",
  "tags": ["bug"],
  "limit": 20
}
```

##### `update_issue`
Update an existing issue:
```json
{
  "issue_id": "ISSUE_123",
  "status": "in-progress",
  "priority": "high"
}
```

##### `delete_issue`
Delete an issue:
```json
{
  "issue_id": "ISSUE_123"
}
```

#### Knowledge Management Tools

##### `record_note`
Create a note for documentation:
```json
{
  "content": "The WebSocket memory leak was caused by missing removeEventListener calls",
  "category": "troubleshooting",
  "tags": ["websocket", "memory", "solution"],
  "process_id": "uuid-process-id"
}
```

##### `record_question` / `record_answer`
Build a Q&A knowledge base:
```json
{
  "content": "How do we handle WebSocket reconnection?",
  "tags": ["websocket", "architecture"]
}
```

### Example Workflows

#### Development Server Management
```typescript
// Start a development server
const devServer = await startProcess({
  script_name: "npm",
  title: "React Dev Server",
  args: ["run", "dev"],
  name: "react-dev-server"
});

// Monitor its status
const processes = await listProcesses({ status: "running" });

// View logs if issues occur
const logs = await getProcessLogs(devServer.processId, { limit: 50 });

// Stop when done
await stopProcess(devServer.processId);
```

#### Build Pipeline
```typescript
// Start build process
const build = await startProcess({
  script_name: "npm",
  title: "Production Build",
  args: ["run", "build"],
  name: "production-build"
});

// Start tests in parallel
const tests = await startProcess({
  script_name: "npm",
  title: "Test Suite", 
  args: ["test"],
  name: "test-suite"
});

// Monitor both processes
const allProcesses = await listProcesses();
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

The project follows a layered, domain-driven design:

1. **Type Layer** (`src/shared/`, `src/process/types.ts`): Core domain types and validation
2. **Data Layer** (`src/process/registry.ts`): Process storage and CRUD operations  
3. **Business Layer** (planned: `src/process/manager.ts`): Process lifecycle management
4. **Integration Layer** (planned: `src/mcp/`): MCP protocol implementation
5. **Presentation Layer** (planned: `src/web/`): Optional web interface

### Key Design Principles

- **Type-First Development**: Define types before implementation
- **Immutable Data**: All operations return copies to prevent mutations
- **Pure Functions**: Prefer stateless functions over stateful classes
- **Domain-Driven Design**: Model the problem domain explicitly
- **Comprehensive Testing**: Test each layer independently and together

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

## License

[License information to be added]

## Support

For issues, questions, or contributions:

- Open an issue on the repository
- Review the `CLAUDE.md` developer guide
- Check the `SPEC.md` technical specification

---

## Phase 1 Complete! 🎉

The core MCP Process Management Server is now fully functional with:
- All 5 MCP tools implemented and tested
- Process lifecycle management with proper state transitions
- Real-time log capture and streaming
- Comprehensive test coverage (94 tests passing)
- Production-ready compiled binary

**Next**: Phase 2 will add web dashboard, process templates, and enhanced monitoring capabilities.