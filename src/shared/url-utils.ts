/**
 * URL generation utilities for MCP tool responses
 * 
 * This module provides utilities for generating consistent URLs that link to
 * the web UI for various resources (processes, issues, notes, etc.).
 */

/**
 * Environment variable name for custom web UI port
 */
const WEB_UI_PORT_ENV = 'WEB_UI_PORT';

/**
 * Default web UI port
 */
const DEFAULT_WEB_UI_PORT = 8080;

/**
 * Default web UI hostname for localhost
 */
const DEFAULT_WEB_UI_HOSTNAME = 'localhost';

/**
 * Get the web UI base URL
 * 
 * Reads the port from environment variables or uses the default port.
 * Handles different environments (localhost, custom ports).
 * 
 * @param path Optional path to append to the base URL
 * @returns Complete web UI URL
 */
export function getWebUIUrl(path?: string): string {
  // Get port from environment or use default
  const portEnv = Deno.env.get(WEB_UI_PORT_ENV);
  const port = portEnv ? parseInt(portEnv, 10) : DEFAULT_WEB_UI_PORT;
  
  // Validate port number
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${portEnv}. Port must be between 1 and 65535.`);
  }
  
  // Build base URL
  const baseUrl = `http://${DEFAULT_WEB_UI_HOSTNAME}:${port}`;
  
  // Return with optional path
  if (path) {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }
  
  return baseUrl;
}

/**
 * Generate URL for process details page
 * 
 * @param processId The process ID
 * @returns URL to process details in web UI
 */
export function getProcessUrl(processId: string): string {
  return getWebUIUrl(`#processes?id=${processId}`);
}

/**
 * Generate URL for issue details page
 * 
 * @param issueId The issue ID
 * @returns URL to issue details in web UI
 */
export function getIssueUrl(issueId: string): string {
  return getWebUIUrl(`#knowledge?type=issue&id=${issueId}`);
}

/**
 * Generate URL for note details page
 * 
 * @param noteId The note ID
 * @returns URL to note details in web UI
 */
export function getNoteUrl(noteId: string): string {
  return getWebUIUrl(`#knowledge?type=note&id=${noteId}`);
}

/**
 * Generate URL for dashboard page
 * 
 * @returns URL to main dashboard in web UI
 */
export function getDashboardUrl(): string {
  return getWebUIUrl('#overview');
}

/**
 * Generate URL for queue page
 * 
 * @returns URL to queue management in web UI
 */
export function getQueueUrl(): string {
  return getWebUIUrl('#queue');
}

/**
 * Generate URL for knowledge base page
 * 
 * @returns URL to knowledge base in web UI
 */
export function getKnowledgeUrl(): string {
  return getWebUIUrl('#knowledge');
}