---
id: ISSUE_19
type: issue
status: open
timestamp: '2025-07-31T10:03:32.968Z'
lastUpdated: '2025-07-31T10:03:32.968Z'
tags:
  - enhancement
  - mcp-tools
  - web-ui
  - urls
  - milestone
title: Return web UI URLs in MCP tool responses
priority: medium
---

# Return web UI URLs in MCP tool responses

# Return web UI URLs in MCP tool responses

## Problem
MCP tools don't return URLs to the web UI, making it difficult for users to know where to access the interface, especially when running on non-default ports.

## Solution
Enhance MCP tool responses to include relevant web UI URLs where appropriate.

## Implementation Plan

1. **Add URL generation utility:**
   ```typescript
   // In src/shared/utils/url.ts
   export function getWebUIUrl(port: number, path?: string): string {
     const base = `http://localhost:${port}`;
     return path ? `${base}/${path}` : base;
   }
   ```

2. **Update tool responses to include URLs:**

   **Process management tools:**
   ```typescript
   // start_process response
   {
     id: "process-123",
     status: "running",
     webUrl: "http://localhost:8080/processes/process-123"
   }
   ```

   **Issue tracking tools:**
   ```typescript
   // record_issue response
   {
     id: "ISSUE_19",
     title: "New feature",
     webUrl: "http://localhost:8080/issues/ISSUE_19"
   }
   ```

   **Queue status tool:**
   ```typescript
   // get_queue_status response
   {
     statistics: { ... },
     webUrl: "http://localhost:8080/queue"
   }
   ```

3. **Share port information between components:**
   - Pass actual web server port to MCP server
   - Store in shared configuration or environment
   - Update after automatic port discovery

4. **Tool-specific URLs:**
   - `/processes/{id}` - Direct link to process details
   - `/issues/{id}` - Direct link to issue in kanban
   - `/queue` - Queue management view
   - `/knowledge/notes/{id}` - Specific note
   - `/` - General dashboard

5. **Format in tool descriptions:**
   ```typescript
   return {
     content: [{
       type: "text",
       text: `Process started successfully\n\nView in web UI: ${webUrl}`
     }]
   };
   ```

## Code References
- MCP tool handlers: `src/mcp/tools/`
- Tool response formatting: Various handler functions
- Web server port config: `src/web/main.ts`

## Benefits
- Users immediately know where to view results
- Works seamlessly with automatic port discovery
- Better integration between CLI and web UI
- Supports the HUD milestone goal

## Success Criteria
- All relevant MCP tools return web UI URLs
- URLs use the correct port (including auto-discovered)
- URLs deep-link to specific resources when applicable
- Clean formatting in tool responses

Related to [[ISSUE_17]] - Must use discovered port in URLs
Related to [[ISSUE_16]] - Supports HUD navigation from CLI