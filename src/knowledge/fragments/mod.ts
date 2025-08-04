/**
 * Fragment System Module
 * 
 * This module provides a unified knowledge management system using LanceDB
 * for vector similarity search. It replaces the old question/answer/note
 * system with a more flexible fragment-based approach.
 */

// Core types and interfaces
export * from './fragment-types.ts';

// Embedding service for vector generation
export * from './embedding-service.ts';

// LanceDB-based storage and retrieval
export * from './fragment-store.ts';

// High-level operations and tools
export * from './fragment-tools.ts';

// Migration from legacy knowledge system
export * from './migrate.ts';

// MCP tool handlers
export * from '../../../mcp/tools/fragment.ts';

/**
 * Quick setup function for the fragment system
 */
export async function setupFragmentSystem() {
  const { getFragmentStore } = await import('./fragment-store.ts');
  const store = getFragmentStore();
  await store.initialize();
  return store;
}