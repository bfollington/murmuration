import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { 
  getProcessUrl, 
  getIssueUrl, 
  getNoteUrl, 
  getDashboardUrl 
} from '../shared/url-utils.ts';

/**
 * Integration tests for URL generation in MCP tool responses
 * 
 * These tests verify that the URL generation utilities work correctly
 * and that the MCP server helper function integrates them properly.
 */

Deno.test("URL Integration - process URLs should be correctly formatted", () => {
  const processId = "proc-123-abc";
  const url = getProcessUrl(processId);
  
  assertEquals(url, `http://localhost:8080/#processes?id=${processId}`);
  
  // Verify URL components
  const urlObj = new URL(url);
  assertEquals(urlObj.protocol, 'http:');
  assertEquals(urlObj.hostname, 'localhost');
  assertEquals(urlObj.port, '8080');
  assertEquals(urlObj.hash, `#processes?id=${processId}`);
});

Deno.test("URL Integration - issue URLs should be correctly formatted", () => {
  const issueId = "ISSUE_123";
  const url = getIssueUrl(issueId);
  
  assertEquals(url, `http://localhost:8080/#knowledge?type=issue&id=${issueId}`);
  
  // Verify URL components
  const urlObj = new URL(url);
  assertEquals(urlObj.protocol, 'http:');
  assertEquals(urlObj.hostname, 'localhost');
  assertEquals(urlObj.port, '8080');
  assertEquals(urlObj.hash, `#knowledge?type=issue&id=${issueId}`);
});

Deno.test("URL Integration - note URLs should be correctly formatted", () => {
  const noteId = "note-456-def";
  const url = getNoteUrl(noteId);
  
  assertEquals(url, `http://localhost:8080/#knowledge?type=note&id=${noteId}`);
  
  // Verify URL components
  const urlObj = new URL(url);
  assertEquals(urlObj.protocol, 'http:');
  assertEquals(urlObj.hostname, 'localhost');
  assertEquals(urlObj.port, '8080');
  assertEquals(urlObj.hash, `#knowledge?type=note&id=${noteId}`);
});

Deno.test("URL Integration - dashboard URL should be correctly formatted", () => {
  const url = getDashboardUrl();
  
  assertEquals(url, 'http://localhost:8080/#overview');
  
  // Verify URL components
  const urlObj = new URL(url);
  assertEquals(urlObj.protocol, 'http:');
  assertEquals(urlObj.hostname, 'localhost');
  assertEquals(urlObj.port, '8080');
  assertEquals(urlObj.hash, '#overview');
});

Deno.test("URL Integration - custom port should be respected", () => {
  const originalPort = Deno.env.get('WEB_UI_PORT');
  
  try {
    // Set custom port
    Deno.env.set('WEB_UI_PORT', '9000');
    
    // Test various URL types with custom port
    assertEquals(getProcessUrl('test'), 'http://localhost:9000/#processes?id=test');
    assertEquals(getIssueUrl('ISSUE_1'), 'http://localhost:9000/#knowledge?type=issue&id=ISSUE_1');
    assertEquals(getNoteUrl('note-1'), 'http://localhost:9000/#knowledge?type=note&id=note-1');
    assertEquals(getDashboardUrl(), 'http://localhost:9000/#overview');
    
  } finally {
    // Restore original environment
    if (originalPort === undefined) {
      Deno.env.delete('WEB_UI_PORT');
    } else {
      Deno.env.set('WEB_UI_PORT', originalPort);
    }
  }
});

Deno.test("URL Integration - URL patterns should be web UI compatible", () => {
  // Test that URLs match expected patterns for web UI routing
  
  // Process URLs should navigate to processes section with ID parameter
  const processUrl = getProcessUrl('proc-123');
  assertEquals(processUrl.includes('#processes?id='), true);
  
  // Issue URLs should navigate to knowledge section with type and ID
  const issueUrl = getIssueUrl('ISSUE_456');
  assertEquals(issueUrl.includes('#knowledge?type=issue&id='), true);
  
  // Note URLs should navigate to knowledge section with type and ID
  const noteUrl = getNoteUrl('note-789');
  assertEquals(noteUrl.includes('#knowledge?type=note&id='), true);
  
  // Dashboard URL should navigate to overview section
  const dashboardUrl = getDashboardUrl();
  assertEquals(dashboardUrl.includes('#overview'), true);
});