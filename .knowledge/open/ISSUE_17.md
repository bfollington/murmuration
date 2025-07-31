---
id: ISSUE_17
type: issue
status: open
timestamp: '2025-07-31T10:02:47.306Z'
lastUpdated: '2025-07-31T10:02:47.306Z'
tags:
  - enhancement
  - web-server
  - multi-instance
  - ports
title: Implement automatic port discovery for web server
priority: high
---

# Implement automatic port discovery for web server

# Implement automatic port discovery for web server

## Problem
When multiple Claude instances try to run the web server, they conflict on port 8080 and fail with "Address already in use" error. Users must manually specify different ports via environment variables.

## Solution
Implement automatic port discovery to find available ports when the default is in use.

## Implementation Plan

1. **Extract `findAvailablePort()` from tests:**
   - Move function from `src/web/server.test.ts:9-23` to a shared utility
   - Place in `src/shared/utils/port.ts` or similar location

2. **Update web server startup:**
   - Modify `src/web/main.ts` to use automatic port discovery
   - Try default port (8080) first
   - If occupied, find next available port
   - Log the actual port being used clearly

3. **Update WebSocket server:**
   - Apply same logic to WebSocket port configuration
   - Ensure WS_PORT and WEB_UI_PORT stay in sync when auto-discovered

4. **Environment variable precedence:**
   ```typescript
   // Priority order:
   // 1. Explicit env var (WS_PORT/WEB_UI_PORT)
   // 2. Default port if available
   // 3. Auto-discovered available port
   ```

5. **Update startup messages:**
   - Clear indication when using non-default port
   - Include full URL in startup message
   - Consider returning URL in MCP tool responses

## Code References
- Current port config: `src/web/main.ts:12-13`
- Test implementation: `src/web/server.test.ts:9-23`
- WebSocket server: `src/web/server.ts:159-172`

## Success Criteria
- Multiple instances can start without manual port configuration
- Each instance finds its own unique port automatically
- Clear logging of which port each instance is using
- Backward compatible with explicit port configuration

Related to [[ISSUE_16]] - HUD should display its actual port in the UI