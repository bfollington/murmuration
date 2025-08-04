---
id: ISSUE_21
type: issue
status: completed
timestamp: '2025-08-04T08:45:29.913Z'
lastUpdated: '2025-08-04T09:25:18.158Z'
tags:
  - enhancement
  - knowledge
  - lancedb
  - embeddings
title: Replace knowledge tools with LanceDB fragment system
priority: high
---

# Replace knowledge tools with LanceDB fragment system

## Overview
Replace existing question+answer and note tools with a unified fragment system using LanceDB for vector storage and search.

## Current State
- Using separate tools: record_question, record_answer, record_note, list_notes, list_questions_and_answers
- JSON-based storage in knowledge-state.json
- No embedding/vector search capabilities

## Target State
New tools:
- record_fragment - store title + body with automatic embedding
- list_fragments - list all by metadata
- search_fragments_by_title - exact title search
- search_fragments_similar - vector similarity search

## Requirements
- LanceDB for vector storage in `.knowledge` directory
- LM Studio with Qwen3-Embedding-0.6B-Q8_0.gguf for embeddings
- Preserve existing knowledge data through migration

## Known subtasks
- [x] Add LanceDB dependency to deno.json
- [x] Create fragment types and interfaces
- [x] Implement embedding service for LM Studio
- [x] Create FragmentStore class with LanceDB integration
- [x] Implement new MCP tool handlers
- [x] Remove old knowledge tools and functions
- [x] Migrate existing knowledge data to fragments
- [x] Update tests for new fragment system
- [x] Update documentation

## Implementation Complete

Successfully replaced the knowledge system with LanceDB-based fragments:

### New MCP Tools:
- `record_fragment` - Create fragments with automatic embeddings
- `list_fragments` - List with metadata filtering
- `search_fragments_by_title` - Exact title search
- `search_fragments_similar` - Vector similarity search
- `get_fragment` - Retrieve by ID
- `update_fragment` - Modify fragments
- `delete_fragment` - Remove fragments
- `get_fragment_stats` - System statistics

### Key Features:
- Vector embeddings via LM Studio (Qwen3-Embedding-0.6B-Q8_0.gguf)
- LanceDB storage in `.knowledge/lance_fragments`
- Full TypeScript type safety
- Migration script for existing data
- Comprehensive tests
- Backward compatible

### Files Created:
- src/knowledge/fragments/ (entire module)
- src/mcp/tools/fragment.ts
- Full documentation in README.md

The old knowledge tools have been removed and the system is ready for use.

## Post-Implementation Fix

Fixed duplicate tools issue where old knowledge tools were still appearing alongside new fragment tools:
- Removed all old tool definitions from src/mcp/server.ts
- Removed all old tool handlers and case statements
- Verified fragment tools are properly integrated
- No more duplicates in the MCP tools list