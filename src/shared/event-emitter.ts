/**
 * Simple event emitter for process events
 * 
 * Provides a lightweight pub/sub mechanism for process state changes
 * and other events that need to be broadcast to multiple listeners.
 */
export class EventEmitter<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<(data: unknown) => void>>();

  /**
   * Subscribe to an event
   * @param event Event name
   * @param listener Callback function
   * @returns Unsubscribe function
   */
  on<K extends keyof T>(event: K, listener: (data: T[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    const listeners = this.listeners.get(event)!;
    listeners.add(listener as (data: unknown) => void);
    
    // Return unsubscribe function
    return () => {
      listeners.delete(listener as (data: unknown) => void);
      if (listeners.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Emit an event to all listeners
   * @param event Event name
   * @param data Event data
   */
  emit<K extends keyof T>(event: K, data: T[K]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          // Error in event listener, ignore to prevent crashes
        }
      }
    }
  }

  /**
   * Remove all listeners for an event
   * @param event Event name
   */
  removeAllListeners<K extends keyof T>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get listener count for an event
   * @param event Event name
   * @returns Number of listeners
   */
  listenerCount<K extends keyof T>(event: K): number {
    const listeners = this.listeners.get(event);
    return listeners ? listeners.size : 0;
  }
}