import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { CrossDomainEventManager, crossDomainEvents } from './cross-domain-events.ts';
import { QueuePriority } from '../queue/types.ts';
import { KnowledgeType } from '../knowledge/types.ts';

Deno.test("CrossDomainEventManager - singleton instance", () => {
  const instance1 = CrossDomainEventManager.getInstance();
  const instance2 = CrossDomainEventManager.getInstance();
  
  assertEquals(instance1, instance2);
  assertEquals(crossDomainEvents, instance1);
});

Deno.test("CrossDomainEventManager - emit and receive process events", () => {
  const manager = CrossDomainEventManager.getInstance();
  let receivedEvent: any = null;
  
  const unsubscribe = manager.on('process:started', (data) => {
    receivedEvent = data;
  });
  
  try {
    manager.emit('process:started', {
      processId: 'test-123',
      title: 'Test Process',
      command: ['echo', 'hello'],
      metadata: { test: true }
    });
    
    assertExists(receivedEvent);
    assertEquals(receivedEvent.processId, 'test-123');
    assertEquals(receivedEvent.title, 'Test Process');
  } finally {
    unsubscribe();
    manager.clear();
  }
});

Deno.test("CrossDomainEventManager - process failure triggers suggestion", async () => {
  const manager = CrossDomainEventManager.getInstance();
  let suggestionReceived: any = null;
  
  const unsubscribe = manager.on('suggestion:process-failure', (data) => {
    suggestionReceived = data;
  });
  
  try {
    manager.emit('process:failed', {
      processId: 'fail-123',
      title: 'Failed Script',
      error: 'Permission denied: cannot access /protected/file.txt',
      exitCode: 1,
      logs: [
        'Starting process...',
        'Error: Permission denied'
      ]
    });
    
    // Give time for async handling
    await new Promise(resolve => setTimeout(resolve, 10));
    
    assertExists(suggestionReceived);
    assertExists(suggestionReceived.suggestedQuestion);
    assertEquals(suggestionReceived.processId, 'fail-123');
    
    const question = suggestionReceived.suggestedQuestion;
    assertEquals(question.title.includes('permission denied'), true);
    assertEquals(question.tags.includes('permission-denied'), true);
    assertEquals(question.tags.includes('process-failure'), true);
  } finally {
    unsubscribe();
    manager.clear();
  }
});

Deno.test("CrossDomainEventManager - queue batch completion event", () => {
  const manager = CrossDomainEventManager.getInstance();
  let eventReceived = false;
  
  const unsubscribe = manager.on('queue:batch:completed', (data) => {
    eventReceived = true;
    assertEquals(data.batchId, 'batch-123');
    assertEquals(data.total, 10);
    assertEquals(data.successful, 7);
    assertEquals(data.failed, 3);
  });
  
  try {
    manager.emit('queue:batch:completed', {
      batchId: 'batch-123',
      successful: 7,
      failed: 3,
      total: 10
    });
    
    assertEquals(eventReceived, true);
  } finally {
    unsubscribe();
    manager.clear();
  }
});

Deno.test("CrossDomainEventManager - knowledge event flow", async () => {
  const manager = CrossDomainEventManager.getInstance();
  const events: string[] = [];
  
  const unsubscribes = [
    manager.on('knowledge:question:added', () => events.push('question')),
    manager.on('knowledge:answer:added', () => events.push('answer')),
    manager.on('knowledge:note:added', () => events.push('note')),
    manager.on('suggestion:related-knowledge', () => events.push('suggestion'))
  ];
  
  try {
    // Add question
    manager.emit('knowledge:question:added', {
      questionId: 'q-123',
      title: 'How to fix permission errors?',
      description: 'Getting permission denied errors',
      tags: ['permissions', 'errors']
    });
    
    // Add answer
    manager.emit('knowledge:answer:added', {
      answerId: 'a-123',
      questionId: 'q-123',
      content: 'Check file permissions with ls -la',
      votes: 5
    });
    
    // Add note
    manager.emit('knowledge:note:added', {
      noteId: 'n-123',
      title: 'Permission troubleshooting guide',
      content: 'Common permission issues and fixes',
      tags: ['guide', 'permissions'],
      relatedIds: ['q-123']
    });
    
    // Wait for async suggestion
    await new Promise(resolve => setTimeout(resolve, 150));
    
    assertEquals(events.includes('question'), true);
    assertEquals(events.includes('answer'), true);
    assertEquals(events.includes('note'), true);
    assertEquals(events.includes('suggestion'), true);
  } finally {
    unsubscribes.forEach(fn => fn());
    manager.clear();
  }
});

Deno.test("CrossDomainEventManager - error pattern extraction", async () => {
  const manager = CrossDomainEventManager.getInstance();
  const suggestions: any[] = [];
  
  const unsubscribe = manager.on('suggestion:process-failure', (data) => {
    suggestions.push(data);
  });
  
  try {
    // Test various error types
    const errorCases = [
      {
        error: 'EACCES: permission denied, open \'/etc/passwd\'',
        expectedType: 'permission denied'
      },
      {
        error: 'Error: Cannot find module \'missing-package\'',
        expectedType: 'dependency error'
      },
      {
        error: 'ENOENT: no such file or directory',
        expectedType: 'file not found'
      },
      {
        error: 'Connection refused at 127.0.0.1:8080',
        expectedType: 'connection error'
      },
      {
        error: 'JavaScript heap out of memory',
        expectedType: 'memory error'
      }
    ];
    
    errorCases.forEach((testCase, index) => {
      manager.emit('process:failed', {
        processId: `test-${index}`,
        title: `Test ${index}`,
        error: testCase.error
      });
    });
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    assertEquals(suggestions.length, errorCases.length);
    
    suggestions.forEach((suggestion, index) => {
      const question = suggestion.suggestedQuestion;
      const expectedType = errorCases[index].expectedType;
      
      assertEquals(
        question.title.toLowerCase().includes(expectedType),
        true,
        `Expected "${expectedType}" in title: ${question.title}`
      );
    });
  } finally {
    unsubscribe();
    manager.clear();
  }
});

Deno.test("CrossDomainEventManager - unsubscribe functionality", () => {
  const manager = CrossDomainEventManager.getInstance();
  let callCount = 0;
  
  const unsubscribe = manager.on('process:started', () => {
    callCount++;
  });
  
  try {
    // First emission
    manager.emit('process:started', {
      processId: 'test-1',
      title: 'Test',
      command: ['echo']
    });
    assertEquals(callCount, 1);
    
    // Unsubscribe
    unsubscribe();
    
    // Second emission (should not be received)
    manager.emit('process:started', {
      processId: 'test-2',
      title: 'Test 2',
      command: ['echo']
    });
    assertEquals(callCount, 1); // Still 1
  } finally {
    manager.clear();
  }
});