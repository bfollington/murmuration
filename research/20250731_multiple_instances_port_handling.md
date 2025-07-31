# Multiple Instance Port Handling Analysis

**Date:** July 31, 2025  
**Researcher:** Claude Code Research Agent  
**Subject:** Understanding port conflict behavior and concurrent instance support when multiple Claude instances run multiple instances of Murmuration server

## Executive Summary

The current Murmuration implementation does **NOT** automatically find unique ports when multiple instances are started. **Multiple instances will indeed fight for the same port** and fail to start, preventing concurrent operation. However, the system can be configured to run multiple instances using environment variables for port configuration.

**Key Findings:**
- ❌ **No Automatic Port Discovery**: Servers use hardcoded default ports (8080 for web)  
- ❌ **Port Conflicts Cause Failures**: Second instance fails to start when default port is in use
- ✅ **Manual Port Configuration**: Environment variables (`WS_PORT`, `WEB_UI_PORT`) allow different ports
- ✅ **Proper Test Infrastructure**: Tests already use `findAvailablePort()` for concurrent testing
- ⚠️ **Shared State Issues**: Multiple instances would share the same file system state (`.knowledge/`, `queue-state.json`)

## Current Implementation Analysis

### 1. MCP Server (src/main.ts)

The main MCP server does **NOT** bind to any network ports - it uses stdio for communication with Claude instances.

**Key Characteristics:**
- **Transport**: stdio (no network ports)
- **Concurrent Safe**: Multiple MCP server instances can run simultaneously without port conflicts
- **Communication**: Each Claude instance gets its own stdio pipe to its MCP server process

```typescript
// src/main.ts - No port binding for MCP server
await mcpServer.start(); // Uses stdio, not network ports
```

### 2. Web Server Port Configuration

The web server **DOES** bind to a network port and will conflict when multiple instances use the same port.

**File:** `src/web/main.ts` (lines 206-207)
```typescript
const port = parseInt(Deno.env.get('WS_PORT') || '8080');
const server = new WebSocketServer({
  port,
  hostname: '0.0.0.0',
  path: '/ws',
});
```

**File:** `src/web/server.ts` (lines 28-34)
```typescript
const DEFAULT_CONFIG: Required<WebSocketServerConfig> = {
  port: 8080,
  hostname: '0.0.0.0',
  path: '/ws',
  maxConnections: 100,
  heartbeatInterval: 30000,
  connectionTimeout: 60000,
};
```

**File:** `src/shared/url-utils.ts` (lines 11-34)
```typescript
const WEB_UI_PORT_ENV = 'WEB_UI_PORT';
const DEFAULT_WEB_UI_PORT = 8080;

export function getWebUIUrl(path?: string): string {
  const portEnv = Deno.env.get(WEB_UI_PORT_ENV);
  const port = portEnv ? parseInt(portEnv, 10) : DEFAULT_WEB_UI_PORT;
  
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${portEnv}. Port must be between 1 and 65535.`);
  }
  
  const baseUrl = `http://${DEFAULT_WEB_UI_HOSTNAME}:${port}`;
  // ...
}
```

## Port Conflict Behavior

### What Happens When Default Port Is In Use

When attempting to start a web server on a port that's already in use, Deno's `Deno.serve()` will throw an error:

**Expected Error Pattern:**
```
Error: Failed to start server
  Caused by: Address already in use (os error 48) // macOS
  Caused by: Address already in use (os error 98) // Linux  
```

**File:** `src/web/server.ts` (lines 92-104)
```typescript
try {
  this.server = Deno.serve({
    port: this.config.port,
    hostname: this.config.hostname,
    signal: this.abortController.signal,
    handler: async (req) => await this.handleRequest(req),
    onListen: ({ hostname, port }) => {
      logger.log('WebSocketServer', `Server listening on ${hostname}:${port}`);
    },
  });
} catch (error) {
  logger.error('WebSocketServer', 'Failed to start server', error);
  throw error; // This will prevent the second instance from starting
}
```

### Concurrent Instance Test Infrastructure

The test suite already demonstrates the proper approach for running multiple concurrent instances:

**File:** `src/web/server.test.ts` (lines 42-55)
```typescript
async function findAvailablePort(startPort = 8080): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      const server = Deno.listen({ port });
      server.close();
      return port;
    } catch {
      // Port in use, try next
      continue;
    }
  }
  throw new Error('No available ports found');
}
```

**Usage in Tests:**
```typescript
Deno.test('WebSocketServer - should handle multiple concurrent connections', async () => {
  const port = await findAvailablePort();
  const server = new WebSocketServer({ port });
  // Test runs without port conflicts
});
```

## Multiple Instance Considerations

### 1. Shared File System State

Multiple instances would share the same file system state, leading to potential conflicts:

**Shared Files:**
- `.knowledge/` directory (issues, notes, questions)
- `queue-state.json` (process queue persistence)  
- Log files and temporary files

**Potential Issues:**
- **File Locking Conflicts**: Both instances trying to write to the same files
- **Data Corruption**: Concurrent writes without proper coordination
- **State Inconsistency**: Each instance maintaining separate in-memory state

**File:** `src/knowledge/persistence.ts` already has file locking:
```typescript
// File locking exists but may not prevent all conflicts between instances
private async acquireFileLock(path: string): Promise<void> {
  // Implementation of file locking for concurrent access safety
}
```

**File:** `src/queue/integrated-manager.ts` (lines 62, 203)
```typescript
// Queue state is persisted to shared file
persistPath: './queue-state.json'

// Both instances would try to restore from and persist to the same file
```

### 2. Process Management Conflicts

**Process Registry:** Each instance maintains its own in-memory process registry, leading to:
- **Lost Visibility**: Instance A cannot see processes started by Instance B
- **PID Conflicts**: Both instances might try to manage the same process IDs
- **Resource Leaks**: Orphaned processes when instances shut down independently

### 3. WebSocket Client Confusion

**Client Connection Issues:**
- Web UI clients can only connect to one WebSocket server at a time
- No load balancing or service discovery for multiple web servers
- Hardcoded URLs in client HTML point to single instance

**File:** `src/web/client.html` and `public/index.html`
```javascript
const url = 'ws://localhost:8080/ws'; // Hardcoded - only connects to one instance
```

## Environment Variable Configuration

The system supports manual port configuration through environment variables:

**Available Configuration:**
- `WS_PORT`: Web server port (default: 8080)
- `WEB_UI_PORT`: Web UI port for URL generation (default: 8080)

**Manual Concurrent Setup:**
```bash
# Terminal 1 - First Claude instance
WS_PORT=8080 WEB_UI_PORT=8080 deno task web

# Terminal 2 - Second Claude instance  
WS_PORT=8081 WEB_UI_PORT=8081 deno task web

# Terminal 3 - Third Claude instance
WS_PORT=8082 WEB_UI_PORT=8082 deno task web
```

## Recommendations

### Phase 1: Immediate Improvements (High Priority)

#### 1. Add Automatic Port Discovery
```typescript
// src/web/port-discovery.ts (NEW FILE)
export async function findAvailablePort(startPort = 8080, maxAttempts = 100): Promise<number> {
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    try {
      const server = Deno.listen({ port });
      server.close();
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`No available ports found in range ${startPort}-${startPort + maxAttempts}`);
}
```

#### 2. Modify Web Server Startup
```typescript
// src/web/main.ts - Modified startup logic
async function main() {
  const configuredPort = parseInt(Deno.env.get('WS_PORT') || '8080');
  let port: number;
  
  if (Deno.env.get('AUTO_PORT') === 'true') {
    port = await findAvailablePort(configuredPort);
    logger.log('Main', `Auto-discovered port: ${port}`);
  } else {
    port = configuredPort;
  }
  
  const server = new WebSocketServer({ port });
  // Set environment variable for URL generation
  Deno.env.set('WEB_UI_PORT', port.toString());
  
  try {
    await server.start();
  } catch (error) {
    if (error.message.includes('Address already in use')) {
      logger.error('Main', `Port ${port} is in use. Try setting AUTO_PORT=true or use a different WS_PORT.`);
    }
    throw error;
  }
}
```

#### 3. Add Port Discovery Configuration
```typescript
// deno.json - Add new task
{
  "tasks": {
    "web": "deno run --allow-all src/web/main.ts",
    "web-auto": "AUTO_PORT=true deno run --allow-all src/web/main.ts"
  }
}
```

### Phase 2: Instance Isolation (Medium Priority)

#### 1. Instance-Specific State Directories
```typescript
// Generate unique instance ID
const instanceId = Deno.env.get('INSTANCE_ID') || `instance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Use instance-specific directories
const knowledgeDir = `.knowledge-${instanceId}`;
const queueStateFile = `queue-state-${instanceId}.json`;
```

#### 2. Process Namespace Isolation
```typescript
// Add instance prefix to process IDs
const processId = `${instanceId}-${uuid.generate()}`;
```

#### 3. Shared State Coordination
```typescript
// Optional: Implement inter-instance communication
// - Shared SQLite database for cross-instance visibility
// - Redis for distributed state management
// - File-based IPC for coordination
```

### Phase 3: Production Multi-Instance Support (Low Priority)

#### 1. Load Balancer Integration
- Nginx or HAProxy configuration for multiple web servers
- Health check endpoints for load balancer
- Session affinity for WebSocket connections

#### 2. Service Discovery
- Register instances with discovery service
- Dynamic client configuration
- Automatic failover support

#### 3. Distributed Architecture
- Message queue for inter-instance communication
- Shared database for persistent state
- Distributed locking mechanisms

## Implementation Sequence

### Week 1: Basic Auto-Port Discovery
1. Implement `findAvailablePort()` utility
2. Modify web server startup to use auto-discovery
3. Add `AUTO_PORT` environment variable support
4. Update documentation with new configuration options

### Week 2: Enhanced Error Handling
1. Improve error messages for port conflicts
2. Add retry mechanisms with exponential backoff
3. Implement graceful degradation when ports unavailable
4. Add port availability checking before startup

### Week 3: Instance Isolation
1. Implement instance-specific state directories
2. Add instance ID generation and management
3. Update file paths to be instance-aware
4. Test multiple concurrent instances

### Week 4: Documentation and Testing
1. Update CLAUDE.md with multi-instance instructions
2. Add integration tests for concurrent instances
3. Create deployment guides for different scenarios
4. Add monitoring and health check improvements

## Code References

**Port Configuration:**
- `/Users/ben/code/murmuration/src/web/main.ts:206` - WS_PORT environment variable
- `/Users/ben/code/murmuration/src/web/server.ts:28-34` - Default port configuration
- `/Users/ben/code/murmuration/src/shared/url-utils.ts:11-34` - WEB_UI_PORT handling

**Port Discovery Pattern:**
- `/Users/ben/code/murmuration/src/web/server.test.ts:42-55` - findAvailablePort() implementation

**Shared State Files:**
- `/Users/ben/code/murmuration/src/queue/integrated-manager.ts:62` - queue-state.json persistence
- `/Users/ben/code/murmuration/src/knowledge/` - .knowledge directory usage

**Error Handling:**
- `/Users/ben/code/murmuration/src/web/server.ts:92-104` - Server startup error handling

## Success Metrics

### Functional Requirements
- [ ] Multiple instances can start simultaneously without manual port configuration
- [ ] Each instance discovers and uses a unique available port
- [ ] Port conflicts are detected and handled gracefully
- [ ] Environment variable configuration still works for manual port assignment
- [ ] MCP tools return correct URLs for their respective web UI instances

### Technical Requirements  
- [ ] No data corruption when multiple instances access shared files
- [ ] Each instance maintains independent process registries
- [ ] Web UI clients can discover and connect to the correct instance
- [ ] Resource cleanup works properly when instances shut down independently
- [ ] File locking prevents concurrent write conflicts

### User Experience Requirements
- [ ] Clear error messages when port conflicts occur
- [ ] Simple command to start multiple instances: `deno task web-auto`
- [ ] Automatic port discovery works within reasonable range (8080-8179)
- [ ] Documentation explains multi-instance setup clearly
- [ ] No configuration required for basic concurrent usage

## Risk Assessment

### High Risk
- **Shared State Corruption**: Multiple instances writing to same files could cause data loss
- **Process Management Conflicts**: Instances might interfere with each other's process tracking
- **Port Exhaustion**: Auto-discovery might fail in environments with many running services

### Medium Risk
- **WebSocket Connection Issues**: Clients might connect to wrong instance after restarts
- **Performance Impact**: Port scanning adds startup latency
- **Configuration Complexity**: Too many environment variables confuse users

### Low Risk
- **Test Infrastructure Impact**: Existing tests already handle port discovery properly
- **Backward Compatibility**: Changes are additive and don't break existing usage
- **Resource Usage**: Each instance uses minimal additional resources

## Conclusion

The Murmuration server currently does **not** automatically find unique ports, causing multiple instances to fight for the same port (8080 by default). However, the architecture already supports manual port configuration through environment variables, and the test infrastructure demonstrates the correct approach for automatic port discovery.

**Immediate Action Required:**
1. **Implement automatic port discovery** using the proven `findAvailablePort()` pattern from tests
2. **Add instance isolation** for shared state files to prevent data corruption
3. **Improve error messaging** to clearly indicate port conflicts and solutions

**Long-term Recommendation:**
The system should move toward a more distributed architecture with proper instance coordination, but the immediate priority should be enabling concurrent instances through automatic port discovery and instance isolation.

This would allow multiple Claude instances to each run their own Murmuration server instance without manual port configuration, while maintaining data integrity and providing clear error handling when issues occur.
EOF < /dev/null