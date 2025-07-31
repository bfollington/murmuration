---
id: ISSUE_13
type: issue
status: open
timestamp: '2025-07-31T08:29:21.135Z'
lastUpdated: '2025-07-31T08:29:21.135Z'
tags:
  - enhancement
  - web-server
  - milestone
  - infrastructure
title: Add static file serving to web server
priority: high
---

# Add static file serving to web server

# Add static file serving to web server

## Description
The web server currently only handles WebSocket and health check endpoints. It doesn't serve the actual HTML/CSS/JS files, making the web UI inaccessible via a simple URL.

## Current State
- Web server runs on port 8080
- Only handles `/health` and WebSocket upgrade
- HTML files exist in `public/` directory but aren't served

## Requirements
1. Add static file serving middleware to serve `public/` directory
2. Set up proper routing:
   - `/` → `public/index.html`
   - `/js/*` → `public/js/*`
   - `/css/*` → `public/css/*` (if exists)
3. Handle 404s gracefully
4. Ensure WebSocket endpoint still works

## Implementation Details
- Modify `src/web/server.ts` to add static file handling
- Use Deno's built-in file serving capabilities
- Maintain existing WebSocket functionality
- Add proper MIME type handling

## Success Criteria
- Can access web UI by visiting `http://localhost:8080`
- All assets load correctly
- WebSocket connections still work
- MCP tools can return this URL

Related to [[ISSUE_12]] - URLs need a working web server to point to