/**
 * Fragment Link Store Tests
 * 
 * Comprehensive tests for LanceDB-based fragment link storage.
 */

import { assertEquals, assertRejects, assert } from '@std/assert/mod.ts';
import { FragmentLinkStore } from './link-store.ts';
import { FragmentLink, FragmentLinkType, generateLinkId } from './link-types.ts';

// Test database path
const TEST_DB_PATH = '.test_knowledge/lance_fragments_links';

Deno.test({
  name: 'FragmentLinkStore - initialization',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    // Should initialize successfully
    await store.initialize();
    
    // Should be idempotent
    await store.initialize();
    
    await store.close();
    
    // Clean up
    try {
      await Deno.remove(TEST_DB_PATH, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - create and get link',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Create a link
      const link = await store.createLink('frag1', 'frag2', 'references', { context: 'test' });
      
      // Verify link properties
      assertEquals(link.sourceId, 'frag1');
      assertEquals(link.targetId, 'frag2');
      assertEquals(link.linkType, 'references');
      assertEquals(link.metadata?.context, 'test');
      assert(link.created instanceof Date);
      assertEquals(link.id, generateLinkId('frag1', 'frag2', 'references'));
      
      // Get the link back
      const retrieved = await store.getLink(link.id);
      assert(retrieved !== null);
      assertEquals(retrieved!.sourceId, link.sourceId);
      assertEquals(retrieved!.targetId, link.targetId);
      assertEquals(retrieved!.linkType, link.linkType);
      assertEquals(retrieved!.metadata?.context, 'test');
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - validation and error handling',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Test empty source ID
      await assertRejects(
        () => store.createLink('', 'target', 'related'),
        Error,
        'Source ID is required'
      );
      
      // Test empty target ID
      await assertRejects(
        () => store.createLink('source', '', 'related'),
        Error,
        'Target ID is required'
      );
      
      // Test self-link
      await assertRejects(
        () => store.createLink('same', 'same', 'related'),
        Error,
        'self-links not allowed'
      );
      
      // Test invalid link type
      await assertRejects(
        () => store.createLink('source', 'target', 'invalid' as FragmentLinkType),
        Error,
        'Invalid link type'
      );
      
      // Test duplicate link
      await store.createLink('dup1', 'dup2', 'related');
      await assertRejects(
        () => store.createLink('dup1', 'dup2', 'related'),
        Error,
        'Link already exists'
      );
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - query links by fragment ID',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Create test links
      await store.createLink('A', 'B', 'references');
      await store.createLink('A', 'C', 'related');
      await store.createLink('B', 'A', 'answers');
      await store.createLink('D', 'A', 'supersedes');
      
      // Test outgoing links from A
      const outgoing = await store.queryLinks({ fragmentId: 'A', direction: 'outgoing' });
      assertEquals(outgoing.length, 2);
      assert(outgoing.some(link => link.targetId === 'B' && link.linkType === 'references'));
      assert(outgoing.some(link => link.targetId === 'C' && link.linkType === 'related'));
      
      // Test incoming links to A
      const incoming = await store.queryLinks({ fragmentId: 'A', direction: 'incoming' });
      assertEquals(incoming.length, 2);
      assert(incoming.some(link => link.sourceId === 'B' && link.linkType === 'answers'));
      assert(incoming.some(link => link.sourceId === 'D' && link.linkType === 'supersedes'));
      
      // Test both directions
      const both = await store.queryLinks({ fragmentId: 'A', direction: 'both' });
      assertEquals(both.length, 4);
      
      // Test convenience method
      const convenience = await store.getLinksForFragment('A');
      assertEquals(convenience.length, 4);
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - query by source and target',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Create test links
      await store.createLink('X', 'Y', 'references');
      await store.createLink('X', 'Z', 'related');
      await store.createLink('W', 'Y', 'answers');
      
      // Query by source
      const fromX = await store.queryLinks({ sourceId: 'X' });
      assertEquals(fromX.length, 2);
      assert(fromX.every(link => link.sourceId === 'X'));
      
      // Query by target
      const toY = await store.queryLinks({ targetId: 'Y' });
      assertEquals(toY.length, 2);
      assert(toY.every(link => link.targetId === 'Y'));
      
      // Query by link type
      const references = await store.queryLinks({ linkType: 'references' });
      assertEquals(references.length, 1);
      assertEquals(references[0].linkType, 'references');
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - pagination',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Create multiple links
      for (let i = 0; i < 5; i++) {
        await store.createLink(`source${i}`, `target${i}`, 'related');
      }
      
      // Test limit
      const limited = await store.queryLinks({ limit: 3 });
      assertEquals(limited.length, 3);
      
      // Test offset
      const offset = await store.queryLinks({ limit: 2, offset: 2 });
      assertEquals(offset.length, 2);
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - delete operations',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Create test links
      const link1 = await store.createLink('DEL1', 'DEL2', 'references');
      await store.createLink('DEL1', 'DEL3', 'related');
      await store.createLink('DEL4', 'DEL1', 'answers');
      
      // Delete single link
      const deleted = await store.deleteLink(link1.id);
      assertEquals(deleted, true);
      
      // Verify deletion
      const retrieved = await store.getLink(link1.id);
      assertEquals(retrieved, null);
      
      // Delete non-existent link
      const notDeleted = await store.deleteLink('nonexistent');
      assertEquals(notDeleted, false);
      
      // Delete all links for a fragment
      const deletedCount = await store.deleteLinksForFragment('DEL1');
      assertEquals(deletedCount, 2); // Should delete 2 remaining links
      
      // Verify no links remain for DEL1
      const remaining = await store.getLinksForFragment('DEL1');
      assertEquals(remaining.length, 0);
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - orphaned links detection',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Create test links
      await store.createLink('exists1', 'exists2', 'references');
      await store.createLink('exists1', 'missing1', 'related');
      await store.createLink('missing2', 'exists2', 'answers');
      
      // Mock fragment existence checker
      const fragmentExists = async (id: string): Promise<boolean> => {
        return id.startsWith('exists');
      };
      
      // Find orphaned links
      const orphaned = await store.findOrphanedLinks(fragmentExists);
      assertEquals(orphaned.length, 2);
      
      assert(orphaned.some(link => 
        link.sourceId === 'exists1' && link.targetId === 'missing1'
      ));
      assert(orphaned.some(link => 
        link.sourceId === 'missing2' && link.targetId === 'exists2'
      ));
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - count operations',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Initial count should be 0
      let count = await store.getLinkCount();
      assertEquals(count, 0);
      
      // Create some links
      await store.createLink('COUNT1', 'COUNT2', 'references');
      await store.createLink('COUNT2', 'COUNT3', 'related');
      
      // Count should be 2
      count = await store.getLinkCount();
      assertEquals(count, 2);
      
      // Get all links
      const allLinks = await store.getAllLinks();
      assertEquals(allLinks.length, 2);
      
      // Get all links with limit
      const limitedLinks = await store.getAllLinks(1);
      assertEquals(limitedLinks.length, 1);
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - special characters in IDs',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Test with single quotes in IDs (SQL injection protection)
      const sourceId = "frag'with'quotes";
      const targetId = "other'frag";
      
      const link = await store.createLink(sourceId, targetId, 'related');
      
      // Should be able to retrieve it
      const retrieved = await store.getLink(link.id);
      assert(retrieved !== null);
      assertEquals(retrieved!.sourceId, sourceId);
      assertEquals(retrieved!.targetId, targetId);
      
      // Should be able to query it
      const queried = await store.queryLinks({ sourceId });
      assertEquals(queried.length, 1);
      assertEquals(queried[0].sourceId, sourceId);
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

Deno.test({
  name: 'FragmentLinkStore - multiple link types between same fragments',
  async fn() {
    const store = new FragmentLinkStore({
      dbPath: TEST_DB_PATH,
      tableName: 'test_links'
    });
    
    await store.initialize();
    
    try {
      // Create multiple link types between same fragments
      await store.createLink('MULTI1', 'MULTI2', 'references');
      await store.createLink('MULTI1', 'MULTI2', 'related');
      await store.createLink('MULTI1', 'MULTI2', 'supersedes');
      
      // Should have 3 different links
      const links = await store.queryLinks({ sourceId: 'MULTI1', targetId: 'MULTI2' });
      assertEquals(links.length, 3);
      
      // Verify each link type exists
      const linkTypes = links.map(link => link.linkType).sort();
      assertEquals(linkTypes, ['references', 'related', 'supersedes']);
      
      // Each should have a unique ID
      const linkIds = links.map(link => link.id);
      assertEquals(new Set(linkIds).size, 3); // All unique
      
    } finally {
      await store.close();
      try {
        await Deno.remove(TEST_DB_PATH, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});