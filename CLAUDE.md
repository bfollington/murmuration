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

### Web Dashboard Interface - IN PROGRESS

**Step 3: Basic WebSocket Server - COMPLETE ✅**

The WebSocket server (`src/web/server.ts`) has been implemented with:
- HTTP server using `Deno.serve()` with WebSocket upgrade handling
- Connection lifecycle management (open, close, error events)
- Configurable server options (port, hostname, path, max connections)
- Graceful shutdown with proper cleanup
- Health check endpoint at `/health`
- Connection counting and basic status reporting
- Comprehensive test coverage (10 tests passing)

**Step 4: ConnectionManager Implementation - COMPLETE ✅**

The ConnectionManager (`src/web/connection-manager.ts`) provides comprehensive WebSocket connection management:

Key Implementation Details:
- **Session Management**: UUID-based session IDs using crypto.randomUUID()
- **Thread-Safe Storage**: Map-based storage safe for concurrent operations
- **Subscription System**: Process-specific and global subscription tracking
- **Message Filtering**: Smart filtering based on subscription state
- **Event System**: Observable connection lifecycle events
- **Resource Management**: Automatic cleanup of inactive/errored connections
- **Statistics**: Real-time connection and subscription metrics

Features Implemented:
```typescript
class WebSocketConnectionManager implements ConnectionManager {
  // Connection lifecycle
  addConnection(socket: WebSocket, metadata?: Record<string, unknown>): string
  removeConnection(sessionId: string): boolean
  
  // Message routing with subscription filtering
  sendToConnection(sessionId: string, message: ServerMessage): Promise<boolean>
  broadcast(message: ServerMessage, filter?: ConnectionFilter): Promise<number>
  broadcastToProcess(processId: string, message: ServerMessage): Promise<number>
  
  // Subscription management
  updateSubscription(sessionId: string, action: string, processId?: string): boolean
  isSubscribedToProcess(sessionId: string, processId: string): boolean
  
  // Maintenance and monitoring
  cleanupInactive(maxInactiveMs: number): number
  getStats(): ConnectionStats
  closeAll(code?: number, reason?: string): Promise<void>
}
```

Test Coverage:
- 29 comprehensive unit tests
- Tests for concurrent operations
- Mock WebSocket implementation for testing
- Edge case handling (inactive connections, errors, etc.)

Key features:
```typescript
const server = new WebSocketServer({
  port: 8080,
  hostname: '0.0.0.0',
  path: '/ws',
  maxConnections: 100
});

await server.start();
// Server accepts WebSocket connections at ws://localhost:8080/ws
// Health check available at http://localhost:8080/health
await server.stop();
```

**Next Steps:**
- Step 4: Add message processing to handle ClientMessage types
- Step 5: Implement ConnectionManager for subscription management
- Step 6: Integrate with ProcessManager for real-time updates

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

## Phase 2 Status: COMPLETE ✅

Phase 2 has been successfully completed with a fully functional WebSocket server and browser interface!

### Completed Features

1. **WebSocket Server Implementation**
   - Created WebSocket server with connection management
   - Implemented message handling and routing
   - Added process event broadcasting
   - Real-time updates for all connected clients

2. **Process Event System**
   - Added EventEmitter to ProcessManager
   - Events: process:started, process:stopped, process:failed, process:state_changed, process:log_added
   - Automatic broadcasting to WebSocket clients
   - Throttled log broadcasting to prevent overwhelming clients

3. **WebSocket Message Handlers**
   - list_processes - Query processes with filters and pagination
   - get_process_status - Get detailed process information
   - start_process - Start new processes with title, script, args
   - stop_process - Graceful/forced process termination
   - get_process_logs - Retrieve process logs with filtering

4. **Browser Interface**
   - Clean, responsive HTML interface
   - Real-time WebSocket connection status
   - Process creation with title and arguments
   - Live process list with status indicators
   - Log viewer with color-coded output (stdout/stderr/system)
   - Process control (stop running processes)

### Running the Web Interface

```bash
# Start the WebSocket server
deno task web

# Or with watch mode for development
deno task web-dev

# Server runs on http://localhost:8080
# WebSocket endpoint: ws://localhost:8080/ws
# Health check: http://localhost:8080/health
```

Open `src/web/client.html` in a browser to use the interface.

### Architecture Notes

- Created `SimpleWebSocketServer` as a streamlined implementation
- Process events are automatically broadcast to all connected clients
- Connection management is simplified but functional
- Handlers validate all incoming messages for security

### Testing Results

- 140+ tests passing (with --no-check due to some type complexity)
- WebSocket functionality verified with test scripts
- Browser interface tested and working
- Real-time updates confirmed

## Next Steps for Phase 3

1. **Enhanced Web Dashboard**
   - Better UI with a proper framework (React/Vue/Svelte)
   - Process filtering and search
   - Historical data visualization
   - Multi-process log tailing

2. **Process Templates**
   - Pre-configured templates for common tasks
   - User-defined templates
   - Template management UI

3. **Advanced Monitoring**
   - CPU and memory usage tracking
   - Process health checks
   - Alert configurations
   - Metrics dashboard

4. **Security Enhancements**
   - WebSocket authentication
   - Rate limiting
   - Input sanitization
   - CORS configuration

The foundation is now solid with both MCP and WebSocket interfaces working together seamlessly!

## Phase 3 Status: COMPLETE ✅

Phase 3 has been successfully completed with comprehensive knowledge management, process queuing, and advanced integrations!

### Completed Features

#### Part 1: Knowledge Management Foundation
1. **Knowledge Types and Registry**
   - Question/Answer/Note types with full type safety
   - In-memory registry with indexing by tags and status
   - Persistence to JSON files with atomic writes
   - Search capabilities and tag filtering

2. **Knowledge Manager**
   - CRUD operations for all knowledge types
   - Question-Answer linking and voting
   - Answer verification system
   - Related knowledge discovery

3. **Knowledge Statistics**
   - Tag popularity tracking
   - Category breakdowns
   - User engagement metrics
   - Trending topics analysis

#### Part 2: Process Queuing System
1. **Queue Types and Manager**
   - Priority-based queue (High/Normal/Low/Background)
   - Batch processing support
   - Retry logic with exponential backoff
   - Queue persistence and recovery

2. **Queue Integration**
   - Seamless integration with ProcessManager
   - Automatic process lifecycle management
   - Queue monitoring and statistics
   - Event-based status updates

3. **Batch Operations**
   - Create and manage process batches
   - Track batch completion status
   - Parallel execution with concurrency limits
   - Batch-level error handling

#### Part 3: MCP Integration
1. **Knowledge MCP Tools**
   - create_knowledge_entry - Add questions, answers, notes
   - search_knowledge - Full-text and tag-based search
   - update_knowledge - Edit and manage entries
   - link_answer - Connect answers to questions
   - get_knowledge_stats - Analytics and insights

2. **Queue MCP Tools**
   - queue_process - Add processes to queue
   - list_queue - View queue status
   - pause_queue/resume_queue - Queue control
   - create_batch - Batch operations
   - get_queue_stats - Queue analytics

#### Part 4: Enhanced Web UI
1. **Knowledge Interface**
   - Browse questions and answers
   - Create new knowledge entries
   - Search and filter by tags
   - Vote on answers
   - Real-time updates via WebSocket

2. **Queue Dashboard**
   - Visual queue status
   - Drag-and-drop priority changes
   - Batch creation interface
   - Queue statistics display
   - Pause/resume controls

#### Part 5: Integration & Polish
1. **Cross-Domain Event System**
   - Intelligent process failure analysis
   - Auto-suggest questions from errors
   - Related knowledge discovery
   - Event-driven integrations

2. **Performance Optimization**
   - Memory indexing for fast lookups
   - Multi-field indexes for complex queries
   - LRU caching for frequent access
   - Pagination for large datasets
   - Batch processing utilities

3. **Export/Import Utilities**
   - Export to JSON, Markdown, CSV
   - Import with validation and transformation
   - Complete system backups
   - Filtered exports by date/tag/status

4. **Migration and Version Management**
   - Version compatibility checking
   - Data migration framework
   - Pre-flight system checks
   - Backward compatibility support

### Running the Complete System

```bash
# Start the MCP server with all features
deno run --allow-all src/main.ts

# Start the web interface
deno task web

# Run all tests
deno test --allow-all

# Create a backup
deno run --allow-all scripts/backup.ts

# Export knowledge to markdown
deno run --allow-all scripts/export-knowledge.ts --format=markdown
```

### Architecture Highlights

1. **Modular Design**
   - Each domain (process, queue, knowledge) is independent
   - Cross-domain communication via event system
   - Shared utilities for common functionality

2. **Type Safety**
   - Full TypeScript coverage
   - Runtime validation with type guards
   - Exhaustive type checking

3. **Performance**
   - Handles 1000+ entries smoothly
   - Efficient indexing and caching
   - Optimized for common operations

4. **Data Portability**
   - Multiple export formats
   - Import with transformations
   - Version migration support

### Testing Summary

- 200+ tests across all modules
- Unit tests for core functionality
- Integration tests for cross-module features
- Performance tests for large datasets
- All tests passing with proper permissions

## Production Readiness

The system is now production-ready with:

1. **Reliability**
   - Atomic file operations
   - Graceful error handling
   - Process cleanup on shutdown
   - Data backup capabilities

2. **Performance**
   - Optimized for 1000+ entries
   - Efficient memory usage
   - Fast search and indexing
   - Throttled event broadcasting

3. **Maintainability**
   - Comprehensive documentation
   - Clean module boundaries
   - Extensive test coverage
   - Migration framework

4. **Extensibility**
   - Plugin-ready architecture
   - Event-driven integrations
   - Export/import for data exchange
   - Version compatibility

## Future Enhancements

While the core system is complete, potential future enhancements include:

1. **Advanced Analytics**
   - Machine learning for knowledge suggestions
   - Process performance predictions
   - Anomaly detection

2. **External Integrations**
   - GitHub issue creation from failures
   - Slack notifications
   - Database backends
   - Cloud storage

3. **Enhanced UI**
   - Mobile-responsive design
   - Dark mode
   - Keyboard shortcuts
   - Advanced visualizations

This developer guide documents the complete Phase 3 implementation. The system provides a robust foundation for process management, knowledge capture, and intelligent automation workflows.

## Phase 4: File-Based Knowledge Management

### Overview

The file-based knowledge management system provides persistent issue tracking and knowledge capture that survives between sessions and enables multi-agent collaboration. This system replaces the ephemeral TodoWrite() tool with a durable, file-based approach.

### MCP Tools for Issue Management

#### 1. record_issue
Creates a new issue for tracking actionable tasks and problems.

**Parameters:**
- `title` (required): The issue title/summary
- `content` (required): The detailed issue description
- `priority`: Priority level - "low", "medium", "high" (default: "medium")
- `tags`: Array of tags for categorization

**Example:**
```json
{
  "title": "Fix WebSocket memory leak",
  "content": "WebSocket connections are not being properly cleaned up when clients disconnect abruptly. This causes memory usage to grow over time.",
  "priority": "high",
  "tags": ["bug", "websocket", "memory"]
}
```

#### 2. list_issues
List issues with optional filtering by status, tags, or limit.

**Parameters:**
- `status`: Filter by issue status - "open", "in-progress", "completed", "archived"
- `tags`: Filter by tags (issues must have all specified tags)
- `limit`: Maximum number of issues to return (default: 20, max: 100)

**Example:**
```json
{
  "status": "open",
  "tags": ["bug"],
  "limit": 10
}
```

#### 3. update_issue
Update an existing issue's title, content, status, tags, or priority.

**Parameters:**
- `issue_id` (required): The ID of the issue to update
- `title`: New title for the issue
- `content`: New content for the issue
- `status`: New status - "open", "in-progress", "completed", "archived"
- `priority`: New priority - "low", "medium", "high"
- `tags`: New tags (replaces existing tags)

**Example:**
```json
{
  "issue_id": "ISSUE_123",
  "status": "in-progress",
  "priority": "high"
}
```

#### 4. delete_issue
Delete an issue from the knowledge base.

**Parameters:**
- `issue_id` (required): The ID of the issue to delete

**Example:**
```json
{
  "issue_id": "ISSUE_123"
}
```

### File Structure

Issues are stored as markdown files organized by status:

```
.knowledge/
├── open/
│   ├── ISSUE_1.md
│   ├── ISSUE_2.md
│   └── ...
├── in-progress/
│   ├── ISSUE_3.md
│   └── ...
├── completed/
│   ├── ISSUE_4.md
│   └── ...
└── archived/
    ├── ISSUE_5.md
    └── ...
```

Each issue file contains:
- YAML frontmatter with metadata (id, title, priority, tags, timestamps)
- Markdown content body
- Cross-references to related issues

### Issue File Format

```markdown
---
id: ISSUE_123
title: Fix WebSocket memory leak
priority: high
status: open
tags:
  - bug
  - websocket
  - memory
timestamp: 2025-07-31T06:00:00.000Z
lastUpdated: 2025-07-31T06:30:00.000Z
---

# Fix WebSocket memory leak

WebSocket connections are not being properly cleaned up when clients disconnect abruptly. This causes memory usage to grow over time.

## Investigation

- Checked connection manager cleanup logic
- Found missing removeEventListener calls
- Related to [[ISSUE_122]] - general memory optimization

## Solution

Add proper cleanup in the connection close handler...
```

### Cross-Referencing

Issues can reference each other using the `[[ISSUE_ID]]` syntax:
- `[[ISSUE_123]]` - Creates a link to another issue
- Cross-references are bidirectional (both issues know about each other)
- Useful for tracking related problems, dependencies, or follow-up tasks

### Usage Examples

#### Creating a New Issue
```typescript
// Using MCP tool
await mcp.record_issue({
  title: "Add authentication to WebSocket server",
  content: "Currently the WebSocket server accepts all connections. We need to add JWT-based authentication.",
  priority: "medium",
  tags: ["enhancement", "security", "websocket"]
});
```

#### Tracking Work Progress
```typescript
// Move issue to in-progress
await mcp.update_issue({
  issue_id: "ISSUE_123",
  status: "in-progress"
});

// Complete the issue
await mcp.update_issue({
  issue_id: "ISSUE_123",
  status: "completed"
});
```

#### Finding Related Issues
```typescript
// Find all open security issues
const securityIssues = await mcp.list_issues({
  status: "open",
  tags: ["security"]
});

// Find high-priority bugs
const urgentBugs = await mcp.list_issues({
  status: "open",
  tags: ["bug", "high-priority"]
});
```

### Integration with Agents

This file-based system replaces the TodoWrite() tool for persistent task tracking:

1. **Persistence**: Issues survive between Claude sessions
2. **Collaboration**: Multiple agents can work on the same issue backlog
3. **History**: Complete audit trail of changes
4. **Organization**: Clear status-based file structure
5. **Searchability**: Easy to grep/search through markdown files
6. **Portability**: Standard markdown format works with any editor

When using Claude Code or other agents:
- Use `record_issue` instead of TodoWrite() for persistent tasks
- Issues created will be available in future sessions
- The file-based approach enables better collaboration between agents
- Status transitions (open → in-progress → completed) provide clear workflow

### Best Practices

1. **Use Clear Titles**: Make issue titles descriptive and searchable
2. **Tag Consistently**: Use standard tags like "bug", "enhancement", "documentation"
3. **Cross-Reference**: Link related issues using [[ISSUE_ID]] syntax
4. **Update Status**: Move issues through the workflow as you work on them
5. **Archive Old Issues**: Use "archived" status for completed work you want to keep for reference

This file-based knowledge system provides a robust foundation for long-term project management and knowledge capture that integrates seamlessly with the MCP server architecture.