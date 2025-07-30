# MCP Process Management Server - Developer Guide

This document provides comprehensive development guidance for the MCP Process Management Server project. It covers the current implementation patterns, testing approaches, and future development steps.

## Project Architecture

The project follows a layered, domain-driven design approach:

```
src/
├── shared/
│   └── types.ts          # Core domain types (ProcessStatus, ProcessEntry, LogEntry)
├── process/
│   ├── types.ts          # Process-specific types and validation
│   └── registry.ts       # ProcessRegistry data layer
└── [future modules]
    ├── manager/          # ProcessManager business logic layer
    ├── mcp/              # MCP integration layer
    └── web/              # Optional web interface
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

## Future Development Steps

### Layer 1: ProcessManager (Next Priority)

```typescript
// src/process/manager.ts
class ProcessManager {
  constructor(private registry: ProcessRegistry) {}
  
  async startProcess(request: StartProcessRequest): Promise<ProcessCreationResult>
  async stopProcess(id: string, options?: ProcessTerminationOptions): Promise<boolean>
  async restartProcess(id: string): Promise<boolean>
  getProcessLogs(id: string, limit?: number): LogEntry[]
  
  // Event system integration
  addEventListener(type: ProcessEventType, handler: (event: ProcessEvent) => void): void
}
```

### Layer 2: MCP Integration

```typescript
// src/mcp/server.ts  
class MCPProcessServer {
  constructor(private manager: ProcessManager) {}
  
  // MCP tool implementations
  async handleStartProcess(args: unknown): Promise<MCPToolResult>
  async handleStopProcess(args: unknown): Promise<MCPToolResult>
  async handleListProcesses(args: unknown): Promise<MCPToolResult>
  async handleGetProcessLogs(args: unknown): Promise<MCPToolResult>
}
```

### Layer 3: Web Interface (Optional)

- Real-time process monitoring dashboard
- WebSocket integration for live updates
- Process log streaming
- Interactive process management

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
      args: { type: "array", items: { type: "string" }, description: "Arguments" },
      env_vars: { type: "object", description: "Environment variables" },
      name: { type: "string", description: "Display name" }
    },
    required: ["script_name"]
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

## Next Implementation Steps

1. **ProcessManager Implementation**
   - Implement process spawning using `Deno.Command`
   - Add log capture and streaming
   - Implement state transition logic
   - Add event system for process lifecycle

2. **MCP Server Integration**
   - Implement MCP tool handlers
   - Add input validation and error handling
   - Create tool registration system
   - Add proper MCP response formatting

3. **Enhanced Testing**
   - Add integration tests for ProcessManager
   - Test MCP tool implementations
   - Add performance and stress tests
   - Test error conditions and edge cases

4. **Production Readiness**
   - Add configuration management
   - Implement proper logging system
   - Add metrics and monitoring
   - Create deployment documentation

This developer guide should be updated as new patterns emerge and the implementation progresses. The focus remains on maintaining clean architecture, comprehensive testing, and clear documentation throughout the development process.