---
id: ISSUE_23
type: issue
status: open
timestamp: '2025-08-05T07:00:19.044Z'
lastUpdated: '2025-08-05T07:00:19.044Z'
tags:
  - enhancement
  - configuration
  - embeddings
  - knowledge
  - lmstudio
title: Make LMStudio embedding configuration flexible via .knowledge/config.json
priority: medium
---

# Make LMStudio embedding configuration flexible via .knowledge/config.json

## Current State
- LMStudio embedding settings hardcoded in `src/knowledge/fragments/embedding-service.ts:33-39`
- Cannot change model, URL, or timeouts without modifying code
- Default values:
  - baseUrl: `http://localhost:1234/v1`
  - model: `text-embedding-ada-002`
  - timeout: 30000ms
  - maxRetries: 3
  - retryDelay: 1000ms

## Implementation Details
- Current embedding service at `src/knowledge/fragments/embedding-service.ts`
- Singleton pattern with `getEmbeddingService()` at line 259
- Configuration interface already exists: `EmbeddingConfig` (lines 13-28)
- Service accepts partial config in constructor (line 64)

## Proposed Configuration
Create `.knowledge/embedding-config.json`:
```json
{
  "baseUrl": "http://localhost:1234/v1",
  "model": "text-embedding-ada-002",
  "timeout": 30000,
  "maxRetries": 3,
  "retryDelay": 1000
}
```

## Known subtasks
- [ ] Create config loader function in `src/knowledge/fragments/config.ts`
- [ ] Load config file if exists, fallback to defaults
- [ ] Update `getEmbeddingService()` to use loaded config (line 259-264)
- [ ] Add config validation with clear error messages
- [ ] Create example config file at `.knowledge/embedding-config.example.json`
- [ ] Update README with configuration instructions
- [ ] Add config reload capability without restart

## Technical Notes
- Keep existing `DEFAULT_EMBEDDING_CONFIG` as fallback
- Use Deno's `JSON.parse(await Deno.readTextFile())` for config loading
- Handle missing file gracefully (use defaults)
- Log which config is being used on startup
- No breaking changes - existing deployments continue working