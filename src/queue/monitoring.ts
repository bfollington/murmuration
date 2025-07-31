/**
 * Queue monitoring module for tracking queue performance and metrics
 */

import { QueueManager } from "./manager.ts";
import { QueueStatistics, QueuePriority, QueueEntry, QueueStatus } from "./types.ts";
import { EventEmitter } from "../shared/event-emitter.ts";

/**
 * Queue monitoring metrics
 */
export interface QueueMetrics {
  // Current state
  currentStats: QueueStatistics;
  
  // Time-based metrics
  entriesAddedPerMinute: number;
  entriesCompletedPerMinute: number;
  entriesFailedPerMinute: number;
  
  // Performance metrics
  averageWaitTimeByPriority: Map<QueuePriority, number>;
  averageProcessingTimeByPriority: Map<QueuePriority, number>;
  successRateByPriority: Map<QueuePriority, number>;
  
  // Queue health
  queueUtilization: number; // Percentage of max queue size used
  concurrencyUtilization: number; // Percentage of max concurrent processes used
  backlogGrowthRate: number; // Entries/minute growth of queue
  
  // Historical data
  historicalSamples: MetricsSample[];
  
  // Alerts
  activeAlerts: QueueAlert[];
}

/**
 * Point-in-time metrics sample
 */
export interface MetricsSample {
  timestamp: Date;
  totalQueued: number;
  processing: number;
  completed: number;
  failed: number;
  throughput: number;
}

/**
 * Queue alert types
 */
export type QueueAlertType = 
  | 'queue_full'
  | 'high_failure_rate'
  | 'long_wait_time'
  | 'backlog_growing'
  | 'low_throughput'
  | 'concurrency_saturated';

/**
 * Queue alert
 */
export interface QueueAlert {
  id: string;
  type: QueueAlertType;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  sampleInterval: number; // How often to collect samples (ms)
  maxHistoricalSamples: number; // Max samples to keep in memory
  alertThresholds: {
    queueUtilization: number; // Alert when queue is X% full
    failureRate: number; // Alert when failure rate exceeds X%
    maxWaitTime: number; // Alert when avg wait time exceeds X ms
    backlogGrowthRate: number; // Alert when backlog grows by X entries/min
    minThroughput: number; // Alert when throughput drops below X/min
  };
}

/**
 * Default monitoring configuration
 */
export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  sampleInterval: 10000, // 10 seconds
  maxHistoricalSamples: 360, // 1 hour at 10s intervals
  alertThresholds: {
    queueUtilization: 0.8, // 80%
    failureRate: 0.2, // 20%
    maxWaitTime: 300000, // 5 minutes
    backlogGrowthRate: 10, // 10 entries/minute
    minThroughput: 1, // 1 process/minute
  },
};

/**
 * Monitoring events
 */
export interface MonitoringEventMap {
  metrics_updated: QueueMetrics;
  alert_raised: QueueAlert;
  alert_cleared: { alertId: string };
  [key: string]: unknown;  // Index signature for EventEmitter constraint
}

/**
 * Queue monitoring class
 */
export class QueueMonitor extends EventEmitter<MonitoringEventMap> {
  private readonly config: MonitoringConfig;
  private readonly queueManager: QueueManager;
  private readonly historicalSamples: MetricsSample[] = [];
  private readonly activeAlerts = new Map<string, QueueAlert>();
  private sampleTimer?: number;
  
  // Tracking for rate calculations
  private lastSampleTime = Date.now();
  private lastCompletedCount = 0;
  private lastFailedCount = 0;
  private lastAddedCount = 0;
  
  constructor(
    queueManager: QueueManager,
    config: Partial<MonitoringConfig> = {}
  ) {
    super();
    this.queueManager = queueManager;
    this.config = { ...DEFAULT_MONITORING_CONFIG, ...config };
  }
  
  /**
   * Start monitoring
   */
  start(): void {
    if (!this.sampleTimer) {
      // Take initial sample
      this.collectSample();
      
      // Start periodic sampling
      this.sampleTimer = setInterval(() => {
        this.collectSample();
      }, this.config.sampleInterval);
    }
  }
  
  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = undefined;
    }
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): QueueMetrics {
    const stats = this.queueManager.getStatistics();
    const config = this.queueManager.getConfig();
    const entries = this.queueManager.getAllEntries();
    
    // Calculate time-based metrics
    const now = Date.now();
    const timeDelta = (now - this.lastSampleTime) / 60000; // minutes
    
    const currentCompletedCount = stats.completed;
    const currentFailedCount = stats.failed;
    const currentAddedCount = entries.length;
    
    const entriesCompletedPerMinute = timeDelta > 0 
      ? (currentCompletedCount - this.lastCompletedCount) / timeDelta
      : 0;
    
    const entriesFailedPerMinute = timeDelta > 0
      ? (currentFailedCount - this.lastFailedCount) / timeDelta
      : 0;
    
    const entriesAddedPerMinute = timeDelta > 0
      ? Math.max(0, (currentAddedCount - this.lastAddedCount) / timeDelta)
      : 0;
    
    // Calculate metrics by priority
    const averageWaitTimeByPriority = new Map<QueuePriority, number>();
    const averageProcessingTimeByPriority = new Map<QueuePriority, number>();
    const successRateByPriority = new Map<QueuePriority, number>();
    
    for (let priority = 1; priority <= 10; priority++) {
      const priorityEntries = entries.filter(e => e.priority === priority);
      
      if (priorityEntries.length > 0) {
        // Calculate average wait time (only if some entries have been started)
        const waitTimes = priorityEntries
          .filter(e => e.startedAt)
          .map(e => e.startedAt!.getTime() - e.queuedAt.getTime());
        
        if (waitTimes.length > 0) {
          const avgWaitTime = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
          averageWaitTimeByPriority.set(priority as QueuePriority, avgWaitTime);
        }
        
        // Calculate average processing time (only if some entries have been completed)
        const processingTimes = priorityEntries
          .filter(e => e.startedAt && e.completedAt)
          .map(e => e.completedAt!.getTime() - e.startedAt!.getTime());
        
        if (processingTimes.length > 0) {
          const avgProcessingTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
          averageProcessingTimeByPriority.set(priority as QueuePriority, avgProcessingTime);
        }
        
        // Calculate success rate (only if some entries have finished)
        const completed = priorityEntries.filter(e => e.status === QueueStatus.completed).length;
        const failed = priorityEntries.filter(e => e.status === QueueStatus.failed).length;
        const total = completed + failed;
        
        if (total > 0) {
          const successRate = completed / total;
          successRateByPriority.set(priority as QueuePriority, successRate);
        }
      }
    }
    
    // Calculate utilization
    const queueUtilization = config.maxQueueSize > 0
      ? stats.totalQueued / config.maxQueueSize
      : 0;
    
    const concurrencyUtilization = config.maxConcurrentProcesses > 0
      ? stats.processing / config.maxConcurrentProcesses
      : 0;
    
    // Calculate backlog growth rate
    const backlogGrowthRate = entriesAddedPerMinute - entriesCompletedPerMinute;
    
    // Check for alerts
    this.checkAlerts({
      stats,
      queueUtilization,
      concurrencyUtilization,
      backlogGrowthRate,
      entriesFailedPerMinute,
      entriesCompletedPerMinute,
      averageWaitTime: stats.averageWaitTime,
    });
    
    const metrics: QueueMetrics = {
      currentStats: stats,
      entriesAddedPerMinute,
      entriesCompletedPerMinute,
      entriesFailedPerMinute,
      averageWaitTimeByPriority,
      averageProcessingTimeByPriority,
      successRateByPriority,
      queueUtilization,
      concurrencyUtilization,
      backlogGrowthRate,
      historicalSamples: [...this.historicalSamples],
      activeAlerts: Array.from(this.activeAlerts.values()),
    };
    
    this.emit('metrics_updated', metrics);
    
    return metrics;
  }
  
  /**
   * Collect a metrics sample
   */
  private collectSample(): void {
    const stats = this.queueManager.getStatistics();
    
    const sample: MetricsSample = {
      timestamp: new Date(),
      totalQueued: stats.totalQueued,
      processing: stats.processing,
      completed: stats.completed,
      failed: stats.failed,
      throughput: stats.throughput,
    };
    
    // Add to historical samples
    this.historicalSamples.push(sample);
    
    // Trim to max samples
    if (this.historicalSamples.length > this.config.maxHistoricalSamples) {
      this.historicalSamples.shift();
    }
    
    // Update tracking counters
    this.lastSampleTime = Date.now();
    this.lastCompletedCount = stats.completed;
    this.lastFailedCount = stats.failed;
    this.lastAddedCount = stats.totalQueued + stats.processing + stats.completed + stats.failed + stats.cancelled;
    
    // Get updated metrics
    this.getMetrics();
  }
  
  /**
   * Check for alert conditions
   */
  private checkAlerts(data: {
    stats: QueueStatistics;
    queueUtilization: number;
    concurrencyUtilization: number;
    backlogGrowthRate: number;
    entriesFailedPerMinute: number;
    entriesCompletedPerMinute: number;
    averageWaitTime: number;
  }): void {
    const thresholds = this.config.alertThresholds;
    
    // Queue full alert
    this.checkAlert(
      'queue_full',
      data.queueUtilization >= thresholds.queueUtilization,
      'warning',
      `Queue is ${Math.round(data.queueUtilization * 100)}% full`,
      { utilization: data.queueUtilization }
    );
    
    // High failure rate alert
    const failureRate = data.stats.completed + data.stats.failed > 0
      ? data.stats.failed / (data.stats.completed + data.stats.failed)
      : 0;
    
    this.checkAlert(
      'high_failure_rate',
      failureRate > thresholds.failureRate,
      'critical',
      `Failure rate is ${Math.round(failureRate * 100)}%`,
      { failureRate }
    );
    
    // Long wait time alert
    this.checkAlert(
      'long_wait_time',
      data.averageWaitTime > thresholds.maxWaitTime,
      'warning',
      `Average wait time is ${Math.round(data.averageWaitTime / 1000)}s`,
      { averageWaitTime: data.averageWaitTime }
    );
    
    // Backlog growing alert
    this.checkAlert(
      'backlog_growing',
      data.backlogGrowthRate > thresholds.backlogGrowthRate,
      'warning',
      `Queue backlog growing at ${data.backlogGrowthRate.toFixed(1)} entries/min`,
      { backlogGrowthRate: data.backlogGrowthRate }
    );
    
    // Low throughput alert
    this.checkAlert(
      'low_throughput',
      data.entriesCompletedPerMinute < thresholds.minThroughput && data.stats.totalQueued > 0,
      'warning',
      `Throughput is only ${data.entriesCompletedPerMinute.toFixed(1)} processes/min`,
      { throughput: data.entriesCompletedPerMinute }
    );
    
    // Concurrency saturated alert
    this.checkAlert(
      'concurrency_saturated',
      data.concurrencyUtilization >= 1 && data.stats.totalQueued > 0,
      'info',
      'All concurrent process slots are in use',
      { utilization: data.concurrencyUtilization }
    );
  }
  
  /**
   * Check and manage a specific alert
   */
  private checkAlert(
    type: QueueAlertType,
    condition: boolean,
    severity: QueueAlert['severity'],
    message: string,
    data?: Record<string, unknown>
  ): void {
    const alertKey = type;
    
    if (condition) {
      // Raise alert if not already active
      if (!this.activeAlerts.has(alertKey)) {
        const alert: QueueAlert = {
          id: crypto.randomUUID(),
          type,
          severity,
          message,
          timestamp: new Date(),
          data,
        };
        
        this.activeAlerts.set(alertKey, alert);
        this.emit('alert_raised', alert);
      }
    } else {
      // Clear alert if active
      const existingAlert = this.activeAlerts.get(alertKey);
      if (existingAlert) {
        this.activeAlerts.delete(alertKey);
        this.emit('alert_cleared', { alertId: existingAlert.id });
      }
    }
  }
  
  /**
   * Get alert by ID
   */
  getAlert(id: string): QueueAlert | undefined {
    return Array.from(this.activeAlerts.values()).find(a => a.id === id);
  }
  
  /**
   * Clear all alerts
   */
  clearAllAlerts(): void {
    const alerts = Array.from(this.activeAlerts.values());
    this.activeAlerts.clear();
    
    for (const alert of alerts) {
      this.emit('alert_cleared', { alertId: alert.id });
    }
  }
}