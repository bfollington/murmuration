import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { QueueMonitor, MonitoringConfig } from "./monitoring.ts";
import { QueueManager } from "./manager.ts";
import { createQueueEntry, QueuedProcess, QueueStatus } from "./types.ts";

// Helper to create test process
function createTestProcess(overrides: Partial<QueuedProcess> = {}): QueuedProcess {
  return {
    script_name: "test.sh",
    title: "Test Process",
    priority: 5,
    ...overrides,
  };
}

// Helper to wait
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.test("QueueMonitor - basic metrics collection", () => {
  const queueManager = new QueueManager();
  const monitor = new QueueMonitor(queueManager, {
    sampleInterval: 100,
  });
  
  try {
    // Add some processes
    queueManager.addToQueue(createTestProcess({ priority: 10 }));
    queueManager.addToQueue(createTestProcess({ priority: 5 }));
    queueManager.addToQueue(createTestProcess({ priority: 1 }));
    
    // Get metrics
    const metrics = monitor.getMetrics();
    
    assertExists(metrics);
    assertEquals(metrics.currentStats.totalQueued, 3);
    assertEquals(metrics.queueUtilization, 3 / 1000); // 3 out of default 1000
    assertEquals(metrics.concurrencyUtilization, 0); // None processing
    
    // Check priority maps
    assertEquals(metrics.averageWaitTimeByPriority.size, 0); // No processes started yet
    assertEquals(metrics.averageProcessingTimeByPriority.size, 0);
    assertEquals(metrics.successRateByPriority.size, 0);
  } finally {
    monitor.stop();
  }
});

Deno.test("QueueMonitor - throughput calculation", async () => {
  const queueManager = new QueueManager();
  const monitor = new QueueMonitor(queueManager, {
    sampleInterval: 100,
  });
  
  try {
    monitor.start();
    
    // Add and complete some processes
    const id1 = queueManager.addToQueue(createTestProcess());
    const id2 = queueManager.addToQueue(createTestProcess());
    
    const entry1 = queueManager.getNext();
    const entry2 = queueManager.getNext();
    
    assertExists(entry1);
    assertExists(entry2);
    
    queueManager.markCompleted(entry1.id, "proc-1");
    queueManager.markCompleted(entry2.id, "proc-2");
    
    // Wait for a sample
    await delay(150);
    
    const metrics = monitor.getMetrics();
    
    // Should show completed processes
    assertEquals(metrics.currentStats.completed, 2);
    assertEquals(metrics.entriesCompletedPerMinute > 0, true);
  } finally {
    monitor.stop();
  }
});

Deno.test("QueueMonitor - priority-based metrics", () => {
  const queueManager = new QueueManager({ retryFailedProcesses: false });
  const monitor = new QueueMonitor(queueManager);
  
  try {
    // Add processes with different priorities
    queueManager.addToQueue(createTestProcess({ priority: 10 }));
    queueManager.addToQueue(createTestProcess({ priority: 10 }));
    queueManager.addToQueue(createTestProcess({ priority: 5 }));
    
    // Process some
    const entry1 = queueManager.getNext();
    const entry2 = queueManager.getNext();
    assertExists(entry1);
    assertExists(entry2);
    
    // Complete one, fail one
    queueManager.markCompleted(entry1.id, "proc-1");
    queueManager.markFailed(entry2.id, "Error");
    
    const metrics = monitor.getMetrics();
    
    // Check success rate for priority 10
    const successRate = metrics.successRateByPriority.get(10);
    assertExists(successRate);
    assertEquals(successRate, 0.5); // 1 success, 1 failure
  } finally {
    monitor.stop();
  }
});

Deno.test("QueueMonitor - alert generation", async () => {
  const config: Partial<MonitoringConfig> = {
    sampleInterval: 100,
    alertThresholds: {
      queueUtilization: 0.5, // Alert at 50%
      failureRate: 0.3,
      maxWaitTime: 1000,
      backlogGrowthRate: 5,
      minThroughput: 10,
    },
  };
  
  const queueManager = new QueueManager({ maxQueueSize: 10 });
  const monitor = new QueueMonitor(queueManager, config);
  
  try {
    let alertRaised = false;
    monitor.on('alert_raised', (alert) => {
      if (alert.type === 'queue_full') {
        alertRaised = true;
      }
    });
    
    // Add enough processes to trigger queue full alert
    for (let i = 0; i < 6; i++) {
      queueManager.addToQueue(createTestProcess());
    }
    
    monitor.start();
    await delay(150);
    
    const metrics = monitor.getMetrics();
    
    assertEquals(alertRaised, true);
    assertEquals(metrics.activeAlerts.length > 0, true);
    assertEquals(metrics.activeAlerts.some(a => a.type === 'queue_full'), true);
  } finally {
    monitor.stop();
  }
});

Deno.test("QueueMonitor - historical samples", async () => {
  const queueManager = new QueueManager();
  const monitor = new QueueMonitor(queueManager, {
    sampleInterval: 50,
    maxHistoricalSamples: 3,
  });
  
  try {
    monitor.start();
    
    // Wait for multiple samples
    await delay(200);
    
    const metrics = monitor.getMetrics();
    
    assertEquals(metrics.historicalSamples.length <= 3, true);
    assertEquals(metrics.historicalSamples.length > 0, true);
    
    // Check samples are ordered by time
    for (let i = 1; i < metrics.historicalSamples.length; i++) {
      const prev = metrics.historicalSamples[i - 1];
      const curr = metrics.historicalSamples[i];
      assertEquals(
        curr.timestamp.getTime() > prev.timestamp.getTime(),
        true
      );
    }
  } finally {
    monitor.stop();
  }
});

Deno.test("QueueMonitor - concurrency saturation alert", () => {
  const queueManager = new QueueManager({ maxConcurrentProcesses: 2 });
  const monitor = new QueueMonitor(queueManager);
  
  try {
    // Add processes
    for (let i = 0; i < 4; i++) {
      queueManager.addToQueue(createTestProcess());
    }
    
    // Process up to limit
    queueManager.getNext();
    queueManager.getNext();
    
    const metrics = monitor.getMetrics();
    
    // Should have concurrency alert
    assertEquals(
      metrics.activeAlerts.some(a => a.type === 'concurrency_saturated'),
      true
    );
    assertEquals(metrics.concurrencyUtilization, 1); // 100%
  } finally {
    monitor.stop();
  }
});

Deno.test("QueueMonitor - alert clearing", () => {
  const queueManager = new QueueManager();
  const monitor = new QueueMonitor(queueManager);
  
  try {
    // Generate an alert
    monitor.getMetrics(); // Initial metrics
    
    // Clear all alerts
    monitor.clearAllAlerts();
    
    const metrics = monitor.getMetrics();
    assertEquals(metrics.activeAlerts.length, 0);
  } finally {
    monitor.stop();
  }
});