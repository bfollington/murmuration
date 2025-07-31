/**
 * Logger utility that respects MCP mode
 * 
 * When running as an MCP server, all console output must be suppressed
 * to avoid interfering with JSON-RPC communication over stdio.
 */

export class Logger {
  private static _instance: Logger;
  private debugMode: boolean;

  private constructor() {
    // Only output logs if DEBUG is explicitly set to 'true'
    // This ensures no output interferes with MCP/JSON-RPC communication
    this.debugMode = Deno.env.get('DEBUG') === 'true';
  }

  static getInstance(): Logger {
    if (!Logger._instance) {
      Logger._instance = new Logger();
    }
    return Logger._instance;
  }

  log(component: string, message: string): void {
    if (this.debugMode) {
      console.error(`[${component}] ${message}`);
    }
  }

  error(component: string, message: string, error?: unknown): void {
    if (this.debugMode) {
      if (error) {
        console.error(`[${component}] ERROR: ${message}`, error);
      } else {
        console.error(`[${component}] ERROR: ${message}`);
      }
    }
  }

  debug(component: string, message: string): void {
    if (this.debugMode) {
      console.error(`[${component}] DEBUG: ${message}`);
    }
  }

  warn(component: string, message: string, error?: unknown): void {
    if (this.debugMode) {
      if (error) {
        console.error(`[${component}] WARNING: ${message}`, error);
      } else {
        console.error(`[${component}] WARNING: ${message}`);
      }
    }
  }

  info(component: string, message: string): void {
    if (this.debugMode) {
      console.error(`[${component}] INFO: ${message}`);
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();