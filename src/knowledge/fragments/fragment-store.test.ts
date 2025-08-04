/**
 * Fragment Store Tests
 * 
 * Basic tests for the fragment system functionality.
 */

import { assertEquals, assertExists, assert } from '@std/assert';
import { FragmentStore } from './fragment-store.ts';
import { CreateFragmentRequest } from './fragment-types.ts';

/**
 * Mock embedding service for testing
 */
class MockEmbeddingService {
  async embed(text: string): Promise<number[]> {
    // Return a simple mock embedding based on text length
    const dimension = 3; // Small dimension for testing
    const embedding = new Array(dimension).fill(0);
    for (let i = 0; i < Math.min(text.length, dimension); i++) {
      embedding[i] = (text.charCodeAt(i) % 100) / 100;
    }
    return embedding;
  }
  
  async embedFragment(title: string, body: string): Promise<number[]> {
    return this.embed(`${title} ${body}`);
  }
  
  async healthCheck(): Promise<boolean> {
    return true;
  }
  
  async getEmbeddingDimensions(): Promise<number> {
    return 3;
  }
}

Deno.test('FragmentStore - basic operations', async () => {
  // Create test store with mock embedding service
  const store = new FragmentStore({
    dbPath: './test_fragments_db',
    tableName: 'test_fragments',
    embeddingService: new MockEmbeddingService()
  });
  
  try {
    // Initialize store
    await store.initialize();
    
    // Create a test fragment
    const createRequest: CreateFragmentRequest = {
      title: 'Test Fragment',
      body: 'This is a test fragment for unit testing.',
      type: 'note',
      tags: ['test', 'unit'],
      priority: 'medium',
      status: 'active'
    };
    
    const fragment = await store.createFragment(createRequest);
    
    // Verify fragment was created
    assertExists(fragment.id);
    assertEquals(fragment.title, 'Test Fragment');
    assertEquals(fragment.body, 'This is a test fragment for unit testing.');
    assertEquals(fragment.type, 'note');
    assertEquals(fragment.tags, ['test', 'unit']);
    assertEquals(fragment.priority, 'medium');
    assertEquals(fragment.status, 'active');
    
    // Retrieve fragment by ID
    const retrieved = await store.getFragment(fragment.id);
    assertExists(retrieved);
    assertEquals(retrieved.id, fragment.id);
    assertEquals(retrieved.title, fragment.title);
    
    // Search fragments
    const searchResults = await store.searchFragments({
      type: 'note',
      tags: ['test'],
      limit: 10
    });
    
    assert(searchResults.fragments.length > 0);
    const foundFragment = searchResults.fragments.find(f => f.id === fragment.id);
    assertExists(foundFragment);
    
    // Search by title
    const titleResults = await store.searchFragmentsByTitle('Test Fragment');
    assertEquals(titleResults.length, 1);
    assertEquals(titleResults[0].id, fragment.id);
    
    // Test similarity search
    const similarResults = await store.searchFragmentsSimilar({
      query: 'test fragment unit testing',
      limit: 5,
      threshold: 0.1
    });
    
    assert(similarResults.fragments.length > 0);
    const similarFragment = similarResults.fragments.find(f => f.fragment.id === fragment.id);
    assertExists(similarFragment);
    assert(similarFragment.score >= 0.1);
    
    // Update fragment
    const updated = await store.updateFragment({
      id: fragment.id,
      title: 'Updated Test Fragment',
      tags: ['test', 'unit', 'updated']
    });
    
    assertExists(updated);
    assertEquals(updated.title, 'Updated Test Fragment');
    assertEquals(updated.tags, ['test', 'unit', 'updated']);
    
    // Get fragment count
    const count = await store.getFragmentCount();
    assert(count >= 1);
    
    // Delete fragment
    const deleted = await store.deleteFragment(fragment.id);
    assertEquals(deleted, true);
    
    // Verify fragment was deleted
    const deletedFragment = await store.getFragment(fragment.id);
    assertEquals(deletedFragment, null);
    
  } finally {
    // Cleanup
    await store.close();
    try {
      await Deno.remove('./test_fragments_db', { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test('FragmentStore - error handling', async () => {
  const store = new FragmentStore({
    dbPath: './test_error_db',
    tableName: 'test_fragments',
    embeddingService: new MockEmbeddingService()
  });
  
  try {
    await store.initialize();
    
    // Test invalid fragment creation
    const invalidRequest: CreateFragmentRequest = {
      title: '', // Empty title should fail
      body: 'Test body',
      type: 'note',
    };
    
    let errorThrown = false;
    try {
      await store.createFragment(invalidRequest);
    } catch (error) {
      errorThrown = true;
      assert(error instanceof Error);
      assert(error.message.includes('title'));
    }
    assert(errorThrown, 'Expected error for empty title');
    
    // Test getting non-existent fragment
    const nonExistent = await store.getFragment('non-existent-id');
    assertEquals(nonExistent, null);
    
    // Test deleting non-existent fragment
    const notDeleted = await store.deleteFragment('non-existent-id');
    assertEquals(notDeleted, false);
    
  } finally {
    await store.close();
    try {
      await Deno.remove('./test_error_db', { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});