# MCP Process Management Server - Developer Guide

This document provides comprehensive development guidance for the MCP Process Management Server project. It covers the current implementation patterns, testing approaches, and future development steps.

## Phase 1 Status: COMPLETE ✅

As of the last development session, Phase 1 has been successfully completed with all core features implemented, tested, and working. The MCP server is fully functional with process management capabilities.

## Phase 2 Status: IN PROGRESS 🚧

Currently implementing the WebSocket-based web interface for real-time process monitoring and management.

### Completed Steps:
1. ✅ **Step 1: Define WebSocket Message Types** (`src/web/types.ts`)
   - Comprehensive message types for client-server communication
   - Full TypeScript interfaces for all message types
   - Type guards for runtime validation of messages
   - Support for process operations, subscriptions, and heartbeat
   - 100% test coverage with 9 tests passing

### Next Steps:
2. 🔄 **Step 2: Create WebSocket Connection Manager Type**
3. 📋 **Step 3: Create Basic WebSocket Server**
4. 📋 **Step 4: Implement Connection Manager**
5. 📋 **Step 5: Add Basic Message Handling**
... (15 more steps)

## Project Architecture

The project follows a layered, domain-driven design approach:

```
src/
├── shared/
│   ├── types.ts          # Core domain types (ProcessStatus, ProcessEntry, LogEntry)
│   └── logger.ts         # Smart logging system with MCP mode detection
├── process/
│   ├── types.ts          # Process-specific types and validation
│   ├── registry.ts       # ProcessRegistry data layer
│   └── manager.ts        # ProcessManager business logic layer
├── mcp/
│   └── server.ts         # MCP integration layer
├── web/
│   └── types.ts          # WebSocket message types and validation
└── main.ts               # Server entry point
```

### Design Philosophy

The implementation follows these core principles:

1. **Type-First Development**: Start with the type domain, defining data structures that cleanly map to the problem
2. **Pure Functions**: Build utility functions that operate within the type domain before adding effects
3. **Domain-Driven Design**: Model bounded contexts explicitly, use ubiquitous language
4. **Functional Programming**: Prefer functions as primary abstraction, focus on values over mutable state
5. **Make Invalid States Unrepresentable**: Use TypeScript's type system to prevent invalid configurations

## Current Implementation

### Type System

#### Core Domain Types (`src/shared/types.ts`)

```typescript
enum ProcessStatus {
  starting = 'starting',
  running = 'running', 
  stopping = 'stopping',
  stopped = 'stopped',
  failed = 'failed'
}

interface ProcessEntry {
  id: string;
  title: string;  // User-provided title for easy identification (REQUIRED)
  name: string;   // Process/command name
  command: string[];
  status: ProcessStatus;
  startTime: Date;
  endTime?: Date;
  pid?: number;
  child?: Deno.ChildProcess;
  logs: LogEntry[];
  metadata: Record<string, unknown>;
  exitCode?: number;
  exitSignal?: string;
}

interface LogEntry {
  timestamp: Date;
  type: 'stdout' | 'stderr' | 'system';
  content: string;
}
```

#### Process-Specific Types (`src/process/types.ts`)

The process module defines additional types for:

- **State Management**: `ProcessStateTransition` with validation via `VALID_STATE_TRANSITIONS`
- **MCP Integration**: `StartProcessRequest` with validation via `isValidStartProcessRequest()`
- **Configuration**: `ProcessOptions`, `ProcessTerminationOptions`, `ProcessMonitoringConfig`
- **Querying**: `ProcessQuery` with filtering, sorting, and pagination
- **Events**: `ProcessEvent` and `ProcessEventType` for internal event system
- **Statistics**: `ProcessStats` for monitoring and reporting

Key patterns:
- Type guards for runtime validation (`isValidStartProcessRequest`, `isValidStateTransition`)
- Const assertions for state transition rules
- Comprehensive interfaces covering all use cases

### Data Layer - ProcessRegistry

The `ProcessRegistry` class (`src/process/registry.ts`) provides the core data management layer:

```typescript
class ProcessRegistry {
  private readonly processes: Map<string, ProcessEntry> = new Map();
  
  // CRUD operations with deep copying to prevent mutations
  addProcess(process: ProcessEntry): void
  getProcess(id: string): ProcessEntry | undefined
  updateProcess(id: string, updates: Partial<ProcessEntry>): boolean
  removeProcess(id: string): boolean
  
  // Query operations
  getAllProcesses(): ProcessEntry[]
  getProcessesByStatus(status: ProcessStatus): ProcessEntry[]
  getProcessIdsByStatus(status: ProcessStatus): string[]
  
  // Utility operations
  hasProcess(id: string): boolean
  getProcessCount(): number
  clear(): void
  static generateProcessId(): string
}
```

**Key Design Patterns:**

1. **Immutability**: All operations return deep copies to prevent external mutations
2. **Thread Safety**: Map-based storage is safe for async operations
3. **Type Safety**: Full TypeScript coverage with proper error handling
4. **Singleton Pattern**: Default instance exported for convenience, but class can be instantiated
5. **Defensive Programming**: Input validation and existence checks throughout

## Development Practices

### Testing Strategy

**Use Deno's Built-in Test Runner**

```bash
# Run all tests
deno test

# Run tests with coverage
deno test --coverage

# Run specific test file
deno test src/process/registry.test.ts

# Watch mode for development
deno test --watch
```

**Test Organization:**
- Name test files with `.test.ts` suffix
- Place tests adjacent to source files
- Use descriptive test names that explain behavior
- Group related tests with `Deno.test()` calls

**Test Structure Example:**
```typescript
import { assertEquals, assertThrows } from "@std/assert";
import { ProcessRegistry } from "./registry.ts";
import { ProcessStatus } from "../shared/types.ts";

Deno.test("ProcessRegistry - addProcess should store process correctly", () => {
  const registry = new ProcessRegistry();
  const process = createTestProcess();
  
  registry.addProcess(process);
  
  assertEquals(registry.getProcessCount(), 1);
  assertEquals(registry.getProcess(process.id), process);
});

Deno.test("ProcessRegistry - addProcess should throw on duplicate ID", () => {
  const registry = new ProcessRegistry();
  const process = createTestProcess();
  
  registry.addProcess(process);
  
  assertThrows(() => registry.addProcess(process), Error, "already exists");
});
```

**AVOID `deno eval`** - Use proper test files and the test runner instead.

### Development Workflow

**Available Tasks (`deno.json`):**
```bash
# Development server (when main.ts is implemented)
deno task dev

# Build executable
deno task build

# Web development server (future)
deno task web-dev
```

**Development Approach:**
1. **Start with Types**: Define interfaces and enums first
2. **Build Pure Functions**: Create utility functions without side effects
3. **Test Early**: Write tests for utility functions before integration
4. **Add Effects Gradually**: Introduce I/O, state, and side effects incrementally
5. **Iterate on Design**: Refactor when patterns emerge or complexity grows

### Code Style Guidelines

**Function Design:**
- Prefer static pure functions over methods when possible
- Use higher-order functions naturally (map, filter, reduce)
- Model functions as primary unit of abstraction
- Think about types and transitions explicitly

**Module Organization:**
- Keep modules focused but not overly decomposed
- Split files when they strain to maintain single focus
- Decouple modules as much as possible
- Use clear, descriptive names that tell a coherent story

**Error Handling:**
- Use Result types or exceptions consistently
- Make invalid states unrepresentable through types
- Provide meaningful error messages
- Log errors with sufficient context

## State Management Patterns

### Process State Machine

The process state transitions are explicitly modeled:

```typescript
const VALID_STATE_TRANSITIONS: ProcessStateTransition[] = [
  { from: ProcessStatus.starting, to: ProcessStatus.running, action: 'spawn_success' },
  { from: ProcessStatus.starting, to: ProcessStatus.failed, action: 'spawn_failure' },
  { from: ProcessStatus.running, to: ProcessStatus.stopping, action: 'terminate_requested' },
  { from: ProcessStatus.running, to: ProcessStatus.failed, action: 'process_error' },
  { from: ProcessStatus.running, to: ProcessStatus.stopped, action: 'process_exit' },
  { from: ProcessStatus.stopping, to: ProcessStatus.stopped, action: 'terminate_success' },
  { from: ProcessStatus.stopping, to: ProcessStatus.failed, action: 'terminate_failure' },
];
```

Use `isValidStateTransition(from, to)` to validate state changes before applying them.

### Registry Patterns

The ProcessRegistry implements several key patterns:

1. **Deep Copying**: Prevents external mutation of internal state
2. **Partial Updates**: `updateProcess()` accepts `Partial<ProcessEntry>` for flexible updates
3. **Query Methods**: Multiple ways to retrieve and filter processes
4. **Atomic Operations**: Each method is atomic and thread-safe

## Completed Implementation (Phase 1)

### ProcessManager (`src/process/manager.ts`)

The ProcessManager has been fully implemented with:
- Process spawning using `Deno.Command`
- Automatic stream monitoring for stdout/stderr
- State transition validation
- Log rotation and buffering
- Graceful and forced termination
- Comprehensive query capabilities
- Resource cleanup and shutdown coordination

### MCP Server (`src/mcp/server.ts`)

The MCP integration is complete with all 5 tools:
1. `start_process` - Start new processes with title, args, env vars
2. `list_processes` - Query with filtering, sorting, pagination
3. `get_process_status` - Detailed process information
4. `stop_process` - Graceful/forced termination
5. `get_process_logs` - Log retrieval with filtering

### Logger System (`src/shared/logger.ts`)

A smart logging system that:
- Detects MCP mode (piped stdio) and suppresses console output
- Respects DEBUG environment variable
- Provides component-based logging
- Prevents interference with JSON-RPC communication

## Phase 2 Implementation Details

### WebSocket Types (`src/web/types.ts`)

The WebSocket type system provides comprehensive message definitions for bidirectional communication:

#### Client-to-Server Messages:
- `ListProcessesMessage` - Request process list with optional filtering
- `StartProcessMessage` - Start a new process with full configuration
- `StopProcessMessage` - Stop a process with optional termination options
- `GetLogsMessage` - Retrieve logs with filtering by lines or time
- `SubscribeMessage` - Subscribe to specific process updates
- `UnsubscribeMessage` - Unsubscribe from process updates
- `SubscribeAllMessage` - Subscribe to all process events
- `UnsubscribeAllMessage` - Unsubscribe from all events

#### Server-to-Client Messages:
- `ProcessListMessage` - List of processes response
- `ProcessStartedMessage` - Notification of new process
- `ProcessUpdatedMessage` - Process state/log updates
- `ProcessEndedMessage` - Process termination notification
- `LogUpdateMessage` - Incremental log updates
- `ErrorMessage` - Error responses with codes
- `SuccessMessage` - Operation confirmations
- `ConnectedMessage` - Connection established with session ID
- `PingMessage`/`PongMessage` - Heartbeat mechanism

#### Key Design Patterns:
1. **Type Guards**: Every message type has a corresponding type guard for runtime validation
2. **Reuse of Existing Types**: Leverages `ProcessEntry`, `StartProcessRequest`, etc. from existing modules
3. **Optional Fields**: Smart use of optional fields for flexibility
4. **Error Handling**: Structured error messages with codes and details
5. **Connection Management**: Built-in support for connection state and heartbeat

## Phase 2 Development Progress

### Step 1: WebSocket Message Types (✅ COMPLETE)

Defined comprehensive WebSocket message types in `src/web/types.ts`:
- **Client Messages**: list_processes, start_process, stop_process, get_logs, subscribe/unsubscribe
- **Server Messages**: process_list, process_started/updated/ended, log_update, error, success
- **Type Guards**: Full validation for all message types with inline validation
- **Connection Types**: WebSocketState enum, WebSocketConfig, ClientSubscriptions

### Step 2: ConnectionManager Interface (✅ COMPLETE)

Designed and implemented the ConnectionManager interface in `src/web/types.ts`:

**Key Design Decisions:**
1. **Session-Based**: Each connection gets a unique sessionId for tracking
2. **Subscription Model**: Supports both process-specific and global subscriptions
3. **Event System**: Built-in event emitter pattern for connection lifecycle events
4. **Filtering**: Comprehensive ConnectionFilter for targeted operations
5. **Statistics**: Real-time connection statistics for monitoring
6. **Activity Tracking**: Last activity timestamps for connection health
7. **Cleanup**: Built-in inactive connection cleanup mechanism

**Interface Methods:**
- Connection Management: add/remove/get connections
- Message Routing: sendToConnection, broadcast, broadcastToProcess
- Subscription Management: updateSubscription, getSubscriptions, isSubscribedToProcess
- Maintenance: updateActivity, cleanupInactive, closeAll
- Monitoring: getStats, onConnectionEvent

**Supporting Types:**
- `WebSocketConnection`: Complete connection state with metadata
- `ConnectionEvent`: Typed events for connection lifecycle
- `SendOptions`: Message sending configuration
- `ConnectionFilter`: Flexible connection selection criteria
- `ConnectionStats`: Aggregated connection metrics

This design ensures:
- Thread-safe operations for concurrent connections
- Clear separation between connection management and message handling
- Testable interface with mock implementation provided
- Extensible event system for future enhancements

## Phase 2 Development Steps

### Web Dashboard Interface

```typescript
// src/web/server.ts
class WebDashboardServer {
  constructor(private processManager: ProcessManager) {}
  
  // WebSocket for real-time updates
  setupWebSocket(): void
  
  // REST API endpoints
  setupRoutes(): void
  
  // Static file serving for UI
  serveStaticFiles(): void
}
```

### Process Templates

```typescript
// src/templates/types.ts
interface ProcessTemplate {
  id: string;
  title: string;
  description: string;
  script_name: string;
  args: string[];
  env_vars?: Record<string, string>;
  tags: string[];
}

// src/templates/manager.ts
class TemplateManager {
  loadBuiltInTemplates(): ProcessTemplate[]
  loadUserTemplates(): ProcessTemplate[]
  applyTemplate(templateId: string, overrides?: Partial<StartProcessRequest>): StartProcessRequest
}
```

## MCP Integration Patterns

### Tool Definition Structure

Each MCP tool should follow this pattern:

```typescript
const toolDefinition = {
  name: "start_process",
  description: "Start a new background process",
  inputSchema: {
    type: "object",
    properties: {
      script_name: { type: "string", description: "Script to execute" },
      title: { type: "string", description: "User-friendly title to identify this process" },
      args: { type: "array", items: { type: "string" }, description: "Arguments" },
      env_vars: { type: "object", description: "Environment variables" },
      name: { type: "string", description: "Display name" }
    },
    required: ["script_name", "title"]
  }
};
```

### Error Handling

MCP tools should return consistent error formats:

```typescript
interface MCPError {
  code: string;
  message: string;
  details?: unknown;
}

// Success response
{ success: true, data: result }

// Error response  
{ success: false, error: { code: "PROCESS_NOT_FOUND", message: "Process ID not found" } }
```

## Testing Guidance

### Unit Testing

Focus on testing pure functions and isolated components:

```typescript
// Test type guards
Deno.test("isValidStartProcessRequest - validates required fields", () => {
  const valid = { script_name: "test.sh" };
  const invalid = { args: ["--help"] }; // missing script_name
  
  assertEquals(isValidStartProcessRequest(valid), true);
  assertEquals(isValidStartProcessRequest(invalid), false);
});

// Test registry operations  
Deno.test("ProcessRegistry - updateProcess preserves ID", () => {
  const registry = new ProcessRegistry();
  const process = createTestProcess();
  registry.addProcess(process);
  
  const updated = registry.updateProcess(process.id, { name: "new-name", id: "different-id" });
  const retrieved = registry.getProcess(process.id);
  
  assertEquals(updated, true);
  assertEquals(retrieved?.id, process.id); // ID should be preserved
  assertEquals(retrieved?.name, "new-name");
});
```

### Integration Testing

Test interactions between layers:

```typescript
// Test manager-registry integration
Deno.test("ProcessManager - startProcess creates registry entry", async () => {
  const registry = new ProcessRegistry();
  const manager = new ProcessManager(registry);
  
  const result = await manager.startProcess({ script_name: "echo", args: ["hello"] });
  
  assertEquals(result.success, true);
  assertEquals(registry.getProcessCount(), 1);
  assertEquals(registry.getProcess(result.processId!)?.status, ProcessStatus.starting);
});
```

### Test Utilities

Create helper functions for common test scenarios:

```typescript
// src/test/helpers.ts
export function createTestProcess(overrides: Partial<ProcessEntry> = {}): ProcessEntry {
  return {
    id: ProcessRegistry.generateProcessId(),
    title: "Test Process",
    name: "test-process",
    command: ["echo", "test"],
    status: ProcessStatus.starting,
    startTime: new Date(),
    logs: [],
    metadata: {},
    ...overrides
  };
}

export function createTestRegistry(): ProcessRegistry {
  return new ProcessRegistry();
}
```

## Debugging and Troubleshooting

### Common Issues

1. **State Transition Errors**
   - Verify transition is valid using `isValidStateTransition()`
   - Check current process status before attempting changes
   - Review state machine diagram for valid paths

2. **Process Registry Mutations**
   - Registry returns deep copies - mutations won't affect stored data
   - Use `updateProcess()` for modifications
   - Verify process exists before updating

3. **Type Validation Failures**
   - Use type guards like `isValidStartProcessRequest()` for runtime validation
   - Check TypeScript compilation for type mismatches
   - Ensure all required fields are present

### Debugging Tools

```typescript
// Enable debug logging
const DEBUG = Deno.env.get("DEBUG") === "true";

function debugLog(message: string, data?: unknown) {
  if (DEBUG) {
    console.log(`[DEBUG] ${new Date().toISOString()} ${message}`, data);
  }
}

// Process state inspection
function inspectProcess(registry: ProcessRegistry, id: string) {
  const process = registry.getProcess(id);
  if (process) {
    console.log("Process State:", {
      id: process.id,
      name: process.name,
      status: process.status,
      pid: process.pid,
      logCount: process.logs.length,
      runtime: process.endTime ? 
        process.endTime.getTime() - process.startTime.getTime() : 
        Date.now() - process.startTime.getTime()
    });
  }
}
```

### Performance Monitoring

```typescript
// Track registry performance
function monitorRegistryPerformance(registry: ProcessRegistry) {
  return {
    processCount: registry.getProcessCount(),
    runningCount: registry.getProcessesByStatus(ProcessStatus.running).length,
    failedCount: registry.getProcessesByStatus(ProcessStatus.failed).length,
    memoryUsage: (performance as any).memory?.usedJSHeapSize || "unknown"
  };
}
```

## Key Implementation Learnings

### Testing Permissions

Always run tests with proper permissions:
```bash
deno test --allow-all  # Or specific: --allow-run --allow-read --allow-write --allow-env
```

### Title Field Enhancement

The mandatory `title` field was added in the final phase to improve process identification:
- Required in `StartProcessRequest`
- Displayed in all process listings and responses
- Makes managing multiple processes much easier
- Validated at both type guard and MCP levels

### MCP Mode Detection

The logger detects MCP mode by checking:
```typescript
const isMCPMode = !Deno.env.get('DEBUG') && !Deno.stdout.isTerminal();
```
This prevents console output from interfering with JSON-RPC.

### Resource Cleanup

Proper cleanup is critical to avoid test failures:
- Always kill child processes in test cleanup
- Wait for process.child.status to ensure termination
- Stop monitoring before killing processes
- Add small delays for resource release

## Phase 2 Preparation

### Immediate Priorities

1. **Web Dashboard**
   - Real-time process monitoring
   - WebSocket for live updates
   - Process control UI
   - Log streaming viewer

2. **Process Templates**
   - Common development workflows
   - Build and test scripts
   - Server configurations
   - Custom user templates

3. **Enhanced Monitoring**
   - CPU and memory usage
   - Process health checks
   - Alert thresholds
   - Historical metrics

### Architecture Considerations

- Keep the MCP server lightweight and focused
- Web dashboard should be optional
- Templates should be extensible
- Maintain backward compatibility

## Session Summary

This development session successfully completed Phase 1 of the MCP Process Management Server:

1. **Fixed all test failures** - Updated tests to use proper permissions and fixed resource leaks
2. **Added mandatory title field** - Enhanced process identification across the system
3. **Implemented smart logging** - Prevents console output in MCP mode
4. **Achieved 100% test pass rate** - 94 tests passing
5. **Built production binary** - Ready for use with Claude Desktop

The server is now fully functional and ready for Phase 2 enhancements.

This developer guide should be updated as new patterns emerge and the implementation progresses. The focus remains on maintaining clean architecture, comprehensive testing, and clear documentation throughout the development process.