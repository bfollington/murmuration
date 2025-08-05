/**
 * Fragment Link Tools Tests
 * 
 * Integration tests for fragment link MCP tools.
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { fragmentLinkToolHandlers } from './fragment-links.ts';
import { getFragmentStore } from '../../knowledge/fragments/fragment-store.ts';
import { getFragmentLinkStore } from '../../knowledge/fragments/link-store.ts';
import { FragmentLinkType } from '../../knowledge/fragments/link-types.ts';

Deno.test('FragmentLinkTools - create link with valid fragments', async () => {
  const fragmentStore = getFragmentStore();
  const linkStore = getFragmentLinkStore();
  
  // Initialize stores
  await fragmentStore.initialize();
  await linkStore.initialize();
  
  try {
    // Create test fragments
    const fragment1 = await fragmentStore.createFragment({
      title: 'Test Question',
      body: 'What is the answer?',
      type: 'question'
    });
    
    const fragment2 = await fragmentStore.createFragment({
      title: 'Test Answer',
      body: 'This is the answer.',
      type: 'answer'
    });
    
    // Test creating a link
    const result = await fragmentLinkToolHandlers.handleCreateFragmentLink({
      sourceId: fragment2.id,
      targetId: fragment1.id,
      linkType: 'answers'
    });
    
    // Verify response structure
    assertEquals(typeof result.content, 'object');
    assertEquals(Array.isArray(result.content), true);
    assertEquals(result.content.length, 1);
    assertEquals(result.content[0].type, 'text');
    
    // Verify link creation
    const links = await linkStore.getLinksForFragment(fragment1.id);
    assertEquals(links.length, 1);
    assertEquals(links[0].linkType, 'answers');
    assertEquals(links[0].sourceId, fragment2.id);
    assertEquals(links[0].targetId, fragment1.id);
    
    // Clean up
    await linkStore.deleteLink(links[0].id);
    await fragmentStore.deleteFragment(fragment1.id);
    await fragmentStore.deleteFragment(fragment2.id);
    
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  }
});

Deno.test('FragmentLinkTools - get links for fragment', async () => {
  const fragmentStore = getFragmentStore();
  const linkStore = getFragmentLinkStore();
  
  // Initialize stores
  await fragmentStore.initialize();
  await linkStore.initialize();
  
  try {
    // Create test fragments
    const fragment1 = await fragmentStore.createFragment({
      title: 'Central Fragment',
      body: 'This fragment has links.',
      type: 'note'
    });
    
    const fragment2 = await fragmentStore.createFragment({
      title: 'Related Fragment',
      body: 'This is related.',
      type: 'note'
    });
    
    // Create a link
    const link = await linkStore.createLink(
      fragment1.id,
      fragment2.id,
      'related' as FragmentLinkType
    );
    
    // Test getting links
    const result = await fragmentLinkToolHandlers.handleGetFragmentLinks({
      fragmentId: fragment1.id
    });
    
    // Verify response
    assertEquals(typeof result.content, 'object');
    assertEquals(Array.isArray(result.content), true);
    assertEquals(result.content.length, 1);
    assertEquals(result.content[0].type, 'text');
    
    const responseText = result.content[0].text as string;
    assertEquals(responseText.includes('Found 1 links'), true);
    assertEquals(responseText.includes('1 outgoing links'), true);
    assertEquals(responseText.includes('0 incoming links'), true);
    
    // Clean up
    await linkStore.deleteLink(link.id);
    await fragmentStore.deleteFragment(fragment1.id);
    await fragmentStore.deleteFragment(fragment2.id);
    
  } catch (error) {
    console.error('Test failed:', error);
    throw error;
  }
});

Deno.test('FragmentLinkTools - error handling for non-existent fragments', async () => {
  // Test creating link with non-existent source fragment
  await assertRejects(
    async () => {
      await fragmentLinkToolHandlers.handleCreateFragmentLink({
        sourceId: 'non-existent-id',
        targetId: 'another-non-existent-id',
        linkType: 'related'
      });
    },
    Error,
    'Source fragment not found'
  );
});

Deno.test('FragmentLinkTools - validation of invalid parameters', async () => {
  // Test invalid link type
  await assertRejects(
    async () => {
      await fragmentLinkToolHandlers.handleCreateFragmentLink({
        sourceId: 'some-id',
        targetId: 'another-id',
        linkType: 'invalid-type'
      });
    },
    Error,
    'Invalid linkType'
  );
  
  // Test missing required parameters
  await assertRejects(
    async () => {
      await fragmentLinkToolHandlers.handleCreateFragmentLink({
        sourceId: 'some-id'
        // missing targetId and linkType
      });
    },
    Error,
    'targetId is required'
  );
});