/**
 * Logger utility that respects MCP mode
 * 
 * When running as an MCP server, all console output must be suppressed
 * to avoid interfering with JSON-RPC communication over stdio.
 */

export class Logger {
  private static _instance: Logger;
  private isMCPMode: boolean;

  private constructor() {
    // Detect MCP mode: no DEBUG env and stdout is not a TTY (piped)
    this.isMCPMode = !Deno.env.get('DEBUG') && !Deno.stdout.isTerminal();
  }

  static getInstance(): Logger {
    if (!Logger._instance) {
      Logger._instance = new Logger();
    }
    return Logger._instance;
  }

  log(component: string, message: string): void {
    if (!this.isMCPMode) {
      console.log(`[${component}] ${message}`);
    }
  }

  error(component: string, message: string, error?: unknown): void {
    if (!this.isMCPMode) {
      if (error) {
        console.error(`[${component}] ERROR: ${message}`, error);
      } else {
        console.error(`[${component}] ERROR: ${message}`);
      }
    }
  }

  debug(component: string, message: string): void {
    if (Deno.env.get('DEBUG') === 'true') {
      console.log(`[${component}] DEBUG: ${message}`);
    }
  }
}

// Export singleton instance
export const logger = Logger.getInstance();