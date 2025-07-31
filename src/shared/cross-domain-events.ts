/**
 * Cross-Domain Event System
 * 
 * Provides intelligent interaction between process, queue, and knowledge domains
 * by broadcasting events and enabling smart suggestions and auto-creation of entries.
 */

import { EventEmitter } from './event-emitter.ts';
import { ProcessStatus } from './types.ts';
import { KnowledgeType } from '../knowledge/types.ts';
import { QueueStatus, QueuePriority } from '../queue/types.ts';

/**
 * Cross-domain event types
 */
export interface CrossDomainEvents extends Record<string, unknown> {
  // Process domain events
  'process:started': {
    processId: string;
    title: string;
    command: string[];
    metadata?: Record<string, unknown>;
  };
  
  'process:completed': {
    processId: string;
    title: string;
    exitCode: number;
    duration: number;
    metadata?: Record<string, unknown>;
  };
  
  'process:failed': {
    processId: string;
    title: string;
    error: string;
    exitCode?: number;
    logs?: string[];
    metadata?: Record<string, unknown>;
  };
  
  // Queue domain events
  'queue:entry:added': {
    entryId: string;
    title: string;
    priority: QueuePriority;
    batchId?: string;
  };
  
  'queue:entry:started': {
    entryId: string;
    processId: string;
    title: string;
  };
  
  'queue:entry:completed': {
    entryId: string;
    processId: string;
    title: string;
    success: boolean;
  };
  
  'queue:batch:completed': {
    batchId: string;
    successful: number;
    failed: number;
    total: number;
  };
  
  // Knowledge domain events
  'knowledge:question:added': {
    questionId: string;
    title: string;
    description: string;
    tags: string[];
    context?: string;
  };
  
  'knowledge:answer:added': {
    answerId: string;
    questionId: string;
    content: string;
    votes?: number;
  };
  
  'knowledge:note:added': {
    noteId: string;
    title: string;
    content: string;
    tags: string[];
    relatedIds?: string[];
  };
  
  // Cross-domain interaction events
  'suggestion:process-failure': {
    processId: string;
    suggestedQuestion: {
      title: string;
      description: string;
      tags: string[];
      context: string;
    };
  };
  
  'suggestion:related-knowledge': {
    context: 'process' | 'queue' | 'knowledge';
    entityId: string;
    suggestions: Array<{
      id: string;
      type: KnowledgeType;
      title: string;
      relevance: number;
    }>;
  };
}

/**
 * Cross-Domain Event Manager
 * 
 * Singleton that manages cross-domain events and intelligent interactions
 */
export class CrossDomainEventManager {
  private static instance: CrossDomainEventManager;
  private readonly emitter = new EventEmitter<CrossDomainEvents>();
  private readonly listeners = new Map<string, (() => void)[]>();
  
  private constructor() {}
  
  static getInstance(): CrossDomainEventManager {
    if (!CrossDomainEventManager.instance) {
      CrossDomainEventManager.instance = new CrossDomainEventManager();
    }
    return CrossDomainEventManager.instance;
  }
  
  /**
   * Subscribe to an event
   */
  on<K extends keyof CrossDomainEvents>(
    event: K,
    listener: (data: CrossDomainEvents[K]) => void
  ): () => void {
    return this.emitter.on(event, listener);
  }
  
  /**
   * Emit an event
   */
  emit<K extends keyof CrossDomainEvents>(
    event: K,
    data: CrossDomainEvents[K]
  ): void {
    this.emitter.emit(event, data);
    
    // Trigger intelligent interactions based on event type
    this.handleIntelligentInteractions(event, data);
  }
  
  /**
   * Handle intelligent interactions between domains
   */
  private handleIntelligentInteractions<K extends keyof CrossDomainEvents>(
    event: K,
    data: CrossDomainEvents[K]
  ): void {
    switch (event) {
      case 'process:failed':
        this.handleProcessFailure(data as CrossDomainEvents['process:failed']);
        break;
        
      case 'queue:batch:completed':
        this.handleBatchCompletion(data as CrossDomainEvents['queue:batch:completed']);
        break;
        
      case 'knowledge:question:added':
        this.handleNewQuestion(data as CrossDomainEvents['knowledge:question:added']);
        break;
    }
  }
  
  /**
   * Handle process failure by suggesting knowledge creation
   */
  private handleProcessFailure(data: CrossDomainEvents['process:failed']): void {
    // Extract meaningful error patterns
    const errorPatterns = this.extractErrorPatterns(data.error, data.logs);
    
    // Generate suggested question
    const suggestedQuestion = {
      title: `Why did "${data.title}" fail with ${errorPatterns.type}?`,
      description: this.generateQuestionDescription(data, errorPatterns),
      tags: this.generateTags(data, errorPatterns),
      context: this.generateContext(data, errorPatterns)
    };
    
    // Emit suggestion event
    this.emit('suggestion:process-failure', {
      processId: data.processId,
      suggestedQuestion
    });
  }
  
  /**
   * Handle batch completion with analytics
   */
  private handleBatchCompletion(data: CrossDomainEvents['queue:batch:completed']): void {
    if (data.failed > 0) {
      // Suggest creating a note about batch issues
      const failureRate = (data.failed / data.total) * 100;
      
      if (failureRate > 50) {
        console.warn(`High failure rate in batch ${data.batchId}: ${failureRate.toFixed(1)}%`);
      }
    }
  }
  
  /**
   * Handle new question by finding related knowledge
   */
  private handleNewQuestion(data: CrossDomainEvents['knowledge:question:added']): void {
    // This would integrate with a search/indexing system in a real implementation
    // For now, we'll emit a placeholder event
    setTimeout(() => {
      this.emit('suggestion:related-knowledge', {
        context: 'knowledge',
        entityId: data.questionId,
        suggestions: []
      });
    }, 100);
  }
  
  /**
   * Extract error patterns from process failure
   */
  private extractErrorPatterns(error: string, logs?: string[]): {
    type: string;
    keywords: string[];
    patterns: string[];
  } {
    const allText = [error, ...(logs || [])].join('\n').toLowerCase();
    
    // Common error patterns - order matters for overlapping patterns
    const patterns: Record<string, RegExp> = {
      'dependency error': /module not found|cannot find module|cannot resolve|import error/i,
      'permission denied': /permission denied|access denied|unauthorized/i,
      'file not found': /file not found|no such file|enoent/i,
      'connection error': /connection refused|timeout|unreachable/i,
      'memory error': /out of memory|heap|allocation failed/i,
      'syntax error': /syntax error|unexpected token|parse error/i,
    };
    
    let errorType = 'unknown error';
    const keywords: string[] = [];
    const matchedPatterns: string[] = [];
    
    for (const [type, regex] of Object.entries(patterns)) {
      if (regex.test(allText)) {
        errorType = type;
        matchedPatterns.push(type);
        
        // Extract keywords around matches
        const matches = allText.match(regex);
        if (matches) {
          keywords.push(...matches);
        }
      }
    }
    
    // Extract additional keywords (file paths, module names, etc.)
    const pathMatches = allText.match(/[\/\w\-\.]+\.(ts|js|json|txt|md)/g);
    if (pathMatches) {
      keywords.push(...pathMatches);
    }
    
    return {
      type: errorType,
      keywords: [...new Set(keywords)],
      patterns: matchedPatterns
    };
  }
  
  /**
   * Generate question description from failure data
   */
  private generateQuestionDescription(
    data: CrossDomainEvents['process:failed'],
    patterns: ReturnType<typeof this.extractErrorPatterns>
  ): string {
    const parts = [
      `Process "${data.title}" failed with exit code ${data.exitCode ?? 'unknown'}.`,
      '',
      `Error: ${data.error}`,
      '',
      `Error Type: ${patterns.type}`,
    ];
    
    if (patterns.keywords.length > 0) {
      parts.push('', `Related: ${patterns.keywords.slice(0, 5).join(', ')}`);
    }
    
    if (data.logs && data.logs.length > 0) {
      parts.push('', 'Recent logs:', ...data.logs.slice(-5).map(log => `  ${log}`));
    }
    
    return parts.join('\n');
  }
  
  /**
   * Generate tags from failure data
   */
  private generateTags(
    data: CrossDomainEvents['process:failed'],
    patterns: ReturnType<typeof this.extractErrorPatterns>
  ): string[] {
    const tags = new Set<string>();
    
    // Add error type
    tags.add(patterns.type.replace(/\s+/g, '-'));
    
    // Add process-related tags
    const command = data.metadata?.command || data.title;
    if (typeof command === 'string') {
      const mainCommand = command.split(/\s+/)[0].split('/').pop();
      if (mainCommand) {
        tags.add(mainCommand);
      }
    }
    
    // Add pattern-based tags
    patterns.patterns.forEach(p => tags.add(p.replace(/\s+/g, '-')));
    
    // Add generic tags
    tags.add('process-failure');
    tags.add('troubleshooting');
    
    return Array.from(tags).slice(0, 10); // Limit to 10 tags
  }
  
  /**
   * Generate context from failure data
   */
  private generateContext(
    data: CrossDomainEvents['process:failed'],
    patterns: ReturnType<typeof this.extractErrorPatterns>
  ): string {
    const context = {
      processId: data.processId,
      title: data.title,
      exitCode: data.exitCode,
      errorType: patterns.type,
      timestamp: new Date().toISOString(),
      metadata: data.metadata
    };
    
    return JSON.stringify(context, null, 2);
  }
  
  /**
   * Clear all listeners
   */
  clear(): void {
    this.emitter.removeAllListeners();
    this.listeners.clear();
  }
}

// Export singleton instance
export const crossDomainEvents = CrossDomainEventManager.getInstance();