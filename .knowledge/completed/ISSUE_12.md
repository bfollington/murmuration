---
id: ISSUE_12
type: issue
status: completed
timestamp: '2025-07-31T08:28:21.749Z'
lastUpdated: '2025-07-31T09:13:04.113Z'
tags:
  - enhancement
  - mcp-tools
  - web-ui
  - milestone
priority: high
---

# Add URL generation to MCP tool responses

# Add URL generation to MCP tool responses

## Description
MCP tools currently return only JSON text responses without any web UI URLs. To achieve our milestone goal, tools need to return clickable URLs that open the web UI.

## Requirements
1. Create a URL generation service that constructs proper web UI URLs
2. Integrate URL generation into MCP tool response handlers
3. Include context-aware URLs (e.g., `/issues/{id}` when creating an issue)
4. Ensure URLs work in different environments (localhost, custom ports)

## Implementation Approach
1. Add `getWebUIUrl()` utility function in `src/mcp/utils/`
2. Modify tool response formatters to include URL field
3. Update all relevant MCP tools to return URLs:
   - `record_issue` → `/issues/{id}`
   - `start_process` → `/processes/{id}`
   - `record_note` → `/notes/{id}`
   - Default tools → `/dashboard`

## Example Response Format
```json
{
  "success": true,
  "message": "Issue ISSUE_123 created successfully",
  "webUrl": "http://localhost:8080/issues/ISSUE_123"
}
```

Related to milestone: Web UI HUD with URL returns from MCP tools