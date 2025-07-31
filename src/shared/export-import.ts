/**
 * Export/Import Utilities
 * 
 * Provides comprehensive data export and import functionality
 * supporting JSON, Markdown, and CSV formats with backup/restore capabilities.
 */

import { ProcessEntry, ProcessStatus } from './types.ts';
import { KnowledgeEntry, Question, Answer, Note, KnowledgeType } from '../knowledge/types.ts';
import { QueueEntry, QueueStatus } from '../queue/types.ts';
import { ensureDir } from "https://deno.land/std@0.208.0/fs/mod.ts";

/**
 * Supported export formats
 */
export enum ExportFormat {
  JSON = 'json',
  MARKDOWN = 'markdown',
  CSV = 'csv'
}

/**
 * Export options
 */
export interface ExportOptions {
  format: ExportFormat;
  includeMetadata?: boolean;
  pretty?: boolean;
  filters?: {
    dateRange?: { start: Date; end: Date };
    tags?: string[];
    status?: string[];
  };
}

/**
 * Import options
 */
export interface ImportOptions {
  merge?: boolean; // Merge with existing data vs replace
  validateSchema?: boolean;
  transformers?: Array<(data: any) => any>;
}

/**
 * Backup metadata
 */
export interface BackupMetadata {
  version: string;
  timestamp: Date;
  source: string;
  counts: {
    processes?: number;
    knowledge?: number;
    queue?: number;
  };
}

/**
 * Complete system backup
 */
export interface SystemBackup {
  metadata: BackupMetadata;
  processes?: ProcessEntry[];
  knowledge?: KnowledgeEntry[];
  queue?: QueueEntry[];
}

/**
 * Data exporter class
 */
export class DataExporter {
  /**
   * Export processes to various formats
   */
  async exportProcesses(
    processes: ProcessEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const filtered = this.filterProcesses(processes, options.filters);
    
    switch (options.format) {
      case ExportFormat.JSON:
        await this.exportProcessesAsJSON(filtered, filePath, options);
        break;
      case ExportFormat.MARKDOWN:
        await this.exportProcessesAsMarkdown(filtered, filePath, options);
        break;
      case ExportFormat.CSV:
        await this.exportProcessesAsCSV(filtered, filePath);
        break;
    }
  }
  
  /**
   * Export knowledge entries
   */
  async exportKnowledge(
    entries: KnowledgeEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const filtered = this.filterKnowledge(entries, options.filters);
    
    switch (options.format) {
      case ExportFormat.JSON:
        await this.exportKnowledgeAsJSON(filtered, filePath, options);
        break;
      case ExportFormat.MARKDOWN:
        await this.exportKnowledgeAsMarkdown(filtered, filePath, options);
        break;
      case ExportFormat.CSV:
        await this.exportKnowledgeAsCSV(filtered, filePath);
        break;
    }
  }
  
  /**
   * Export queue entries
   */
  async exportQueue(
    entries: QueueEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const filtered = this.filterQueue(entries, options.filters);
    
    switch (options.format) {
      case ExportFormat.JSON:
        await this.exportQueueAsJSON(filtered, filePath, options);
        break;
      case ExportFormat.MARKDOWN:
        await this.exportQueueAsMarkdown(filtered, filePath, options);
        break;
      case ExportFormat.CSV:
        await this.exportQueueAsCSV(filtered, filePath);
        break;
    }
  }
  
  /**
   * Create complete system backup
   */
  async createSystemBackup(
    data: {
      processes?: ProcessEntry[];
      knowledge?: KnowledgeEntry[];
      queue?: QueueEntry[];
    },
    backupDir: string
  ): Promise<string> {
    await ensureDir(backupDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${backupDir}/backup-${timestamp}`;
    await ensureDir(backupPath);
    
    const backup: SystemBackup = {
      metadata: {
        version: '1.0.0',
        timestamp: new Date(),
        source: 'murmuration',
        counts: {
          processes: data.processes?.length || 0,
          knowledge: data.knowledge?.length || 0,
          queue: data.queue?.length || 0
        }
      },
      processes: data.processes,
      knowledge: data.knowledge,
      queue: data.queue
    };
    
    // Write main backup file
    const mainFile = `${backupPath}/backup.json`;
    await Deno.writeTextFile(
      mainFile,
      JSON.stringify(backup, null, 2)
    );
    
    // Write individual files for easier access
    if (data.processes) {
      await Deno.writeTextFile(
        `${backupPath}/processes.json`,
        JSON.stringify(data.processes, null, 2)
      );
    }
    
    if (data.knowledge) {
      await Deno.writeTextFile(
        `${backupPath}/knowledge.json`,
        JSON.stringify(data.knowledge, null, 2)
      );
    }
    
    if (data.queue) {
      await Deno.writeTextFile(
        `${backupPath}/queue.json`,
        JSON.stringify(data.queue, null, 2)
      );
    }
    
    // Write metadata file
    await Deno.writeTextFile(
      `${backupPath}/metadata.json`,
      JSON.stringify(backup.metadata, null, 2)
    );
    
    return backupPath;
  }
  
  // Process export methods
  private async exportProcessesAsJSON(
    processes: ProcessEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const data = {
      exportDate: new Date().toISOString(),
      version: '1.0',
      count: processes.length,
      processes: options.includeMetadata ? processes : processes.map(p => ({
        id: p.id,
        title: p.title,
        name: p.name,
        command: p.command,
        status: p.status,
        startTime: p.startTime,
        endTime: p.endTime,
        exitCode: p.exitCode
      }))
    };
    
    const json = options.pretty ? 
      JSON.stringify(data, null, 2) : 
      JSON.stringify(data);
    
    await Deno.writeTextFile(filePath, json);
  }
  
  private async exportProcessesAsMarkdown(
    processes: ProcessEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const lines: string[] = [
      '# Process Export',
      '',
      `Export Date: ${new Date().toISOString()}`,
      `Total Processes: ${processes.length}`,
      '',
      '## Processes',
      ''
    ];
    
    for (const process of processes) {
      lines.push(
        `### ${process.title}`,
        '',
        `- **ID**: ${process.id}`,
        `- **Status**: ${process.status}`,
        `- **Command**: \`${process.command.join(' ')}\``,
        `- **Start Time**: ${process.startTime.toISOString()}`,
        process.endTime ? `- **End Time**: ${process.endTime.toISOString()}` : '',
        process.exitCode !== undefined ? `- **Exit Code**: ${process.exitCode}` : '',
        ''
      );
      
      if (options.includeMetadata && process.logs.length > 0) {
        lines.push('#### Recent Logs', '');
        const recentLogs = process.logs.slice(-10);
        for (const log of recentLogs) {
          lines.push(`- [${log.type}] ${log.content}`);
        }
        lines.push('');
      }
    }
    
    await Deno.writeTextFile(filePath, lines.filter(l => l !== '').join('\n'));
  }
  
  private async exportProcessesAsCSV(
    processes: ProcessEntry[],
    filePath: string
  ): Promise<void> {
    const headers = [
      'ID', 'Title', 'Name', 'Command', 'Status', 
      'Start Time', 'End Time', 'Exit Code', 'PID'
    ];
    
    const rows = [headers.join(',')];
    
    for (const process of processes) {
      const row = [
        process.id,
        this.escapeCSV(process.title),
        this.escapeCSV(process.name),
        this.escapeCSV(process.command.join(' ')),
        process.status,
        process.startTime.toISOString(),
        process.endTime?.toISOString() || '',
        process.exitCode?.toString() || '',
        process.pid?.toString() || ''
      ];
      rows.push(row.join(','));
    }
    
    await Deno.writeTextFile(filePath, rows.join('\n'));
  }
  
  // Knowledge export methods
  private async exportKnowledgeAsJSON(
    entries: KnowledgeEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const data = {
      exportDate: new Date().toISOString(),
      version: '1.0',
      count: entries.length,
      entries: entries
    };
    
    const json = options.pretty ? 
      JSON.stringify(data, null, 2) : 
      JSON.stringify(data);
    
    await Deno.writeTextFile(filePath, json);
  }
  
  private async exportKnowledgeAsMarkdown(
    entries: KnowledgeEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const lines: string[] = [
      '# Knowledge Base Export',
      '',
      `Export Date: ${new Date().toISOString()}`,
      `Total Entries: ${entries.length}`,
      ''
    ];
    
    // Group by type
    const questions = entries.filter(e => e.type === KnowledgeType.QUESTION) as Question[];
    const answers = entries.filter(e => e.type === KnowledgeType.ANSWER) as Answer[];
    const notes = entries.filter(e => e.type === KnowledgeType.NOTE) as Note[];
    
    if (questions.length > 0) {
      lines.push('## Questions', '');
      for (const q of questions) {
        lines.push(
          `### ${q.title}`,
          '',
          q.description,
          '',
          `Tags: ${q.tags.map(t => `\`${t}\``).join(', ')}`,
          ''
        );
        
        // Include linked answers
        const linkedAnswers = answers.filter(a => a.questionId === q.id);
        if (linkedAnswers.length > 0) {
          lines.push('#### Answers', '');
          for (const a of linkedAnswers) {
            lines.push(
              a.content,
              '',
              `Votes: ${a.votes || 0} | ${a.verified ? '✓ Verified' : ''}`,
              ''
            );
          }
        }
      }
    }
    
    if (notes.length > 0) {
      lines.push('## Notes', '');
      for (const n of notes) {
        lines.push(
          `### ${n.title}`,
          '',
          n.content,
          '',
          `Tags: ${n.tags.map(t => `\`${t}\``).join(', ')}`,
          ''
        );
      }
    }
    
    await Deno.writeTextFile(filePath, lines.join('\n'));
  }
  
  private async exportKnowledgeAsCSV(
    entries: KnowledgeEntry[],
    filePath: string
  ): Promise<void> {
    const headers = [
      'ID', 'Type', 'Title', 'Content', 'Tags', 'Created', 'Updated'
    ];
    
    const rows = [headers.join(',')];
    
    for (const entry of entries) {
      const content = entry.type === KnowledgeType.QUESTION ?
        (entry as Question).description :
        entry.type === KnowledgeType.ANSWER ?
          (entry as Answer).content :
          (entry as Note).content;
      
      const row = [
        entry.id,
        entry.type,
        this.escapeCSV(entry.title),
        this.escapeCSV(content),
        this.escapeCSV(entry.tags.join('; ')),
        entry.timestamp.toISOString(),
        entry.lastUpdated.toISOString()
      ];
      rows.push(row.join(','));
    }
    
    await Deno.writeTextFile(filePath, rows.join('\n'));
  }
  
  // Queue export methods
  private async exportQueueAsJSON(
    entries: QueueEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const data = {
      exportDate: new Date().toISOString(),
      version: '1.0',
      count: entries.length,
      entries: entries
    };
    
    const json = options.pretty ? 
      JSON.stringify(data, null, 2) : 
      JSON.stringify(data);
    
    await Deno.writeTextFile(filePath, json);
  }
  
  private async exportQueueAsMarkdown(
    entries: QueueEntry[],
    filePath: string,
    options: ExportOptions
  ): Promise<void> {
    const lines: string[] = [
      '# Queue Export',
      '',
      `Export Date: ${new Date().toISOString()}`,
      `Total Entries: ${entries.length}`,
      ''
    ];
    
    // Group by status
    const statusGroups = new Map<QueueStatus, QueueEntry[]>();
    for (const entry of entries) {
      if (!statusGroups.has(entry.status)) {
        statusGroups.set(entry.status, []);
      }
      statusGroups.get(entry.status)!.push(entry);
    }
    
    for (const [status, group] of statusGroups) {
      lines.push(`## ${status.toUpperCase()}`, '');
      
      for (const entry of group) {
        lines.push(
          `### ${entry.process.title}`,
          '',
          `- **ID**: ${entry.id}`,
          `- **Priority**: ${entry.priority}`,
          `- **Script**: \`${entry.process.script_name}\``,
          `- **Queued**: ${entry.queuedAt.toISOString()}`,
          ''
        );
        
        if (entry.error) {
          lines.push(`- **Error**: ${entry.error}`, '');
        }
      }
    }
    
    await Deno.writeTextFile(filePath, lines.join('\n'));
  }
  
  private async exportQueueAsCSV(
    entries: QueueEntry[],
    filePath: string
  ): Promise<void> {
    const headers = [
      'ID', 'Title', 'Script', 'Status', 'Priority', 
      'Queued At', 'Started At', 'Completed At', 'Error'
    ];
    
    const rows = [headers.join(',')];
    
    for (const entry of entries) {
      const row = [
        entry.id,
        this.escapeCSV(entry.process.title),
        this.escapeCSV(entry.process.script_name),
        entry.status,
        entry.priority.toString(),
        entry.queuedAt.toISOString(),
        entry.startedAt?.toISOString() || '',
        entry.completedAt?.toISOString() || '',
        this.escapeCSV(entry.error || '')
      ];
      rows.push(row.join(','));
    }
    
    await Deno.writeTextFile(filePath, rows.join('\n'));
  }
  
  // Filter methods
  private filterProcesses(
    processes: ProcessEntry[],
    filters?: ExportOptions['filters']
  ): ProcessEntry[] {
    if (!filters) return processes;
    
    return processes.filter(p => {
      if (filters.dateRange) {
        const inRange = p.startTime >= filters.dateRange.start &&
                       p.startTime <= filters.dateRange.end;
        if (!inRange) return false;
      }
      
      if (filters.status && filters.status.length > 0) {
        if (!filters.status.includes(p.status)) return false;
      }
      
      return true;
    });
  }
  
  private filterKnowledge(
    entries: KnowledgeEntry[],
    filters?: ExportOptions['filters']
  ): KnowledgeEntry[] {
    if (!filters) return entries;
    
    return entries.filter(e => {
      if (filters.dateRange) {
        const inRange = e.timestamp >= filters.dateRange.start &&
                       e.timestamp <= filters.dateRange.end;
        if (!inRange) return false;
      }
      
      if (filters.tags && filters.tags.length > 0) {
        const hasTag = filters.tags.some(tag => e.tags.includes(tag));
        if (!hasTag) return false;
      }
      
      return true;
    });
  }
  
  private filterQueue(
    entries: QueueEntry[],
    filters?: ExportOptions['filters']
  ): QueueEntry[] {
    if (!filters) return entries;
    
    return entries.filter(e => {
      if (filters.dateRange) {
        const inRange = e.queuedAt >= filters.dateRange.start &&
                       e.queuedAt <= filters.dateRange.end;
        if (!inRange) return false;
      }
      
      if (filters.status && filters.status.length > 0) {
        if (!filters.status.includes(e.status)) return false;
      }
      
      return true;
    });
  }
  
  // Utility methods
  private escapeCSV(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}

/**
 * Data importer class
 */
export class DataImporter {
  /**
   * Import processes from file
   */
  async importProcesses(
    filePath: string,
    options: ImportOptions = {}
  ): Promise<ProcessEntry[]> {
    const content = await Deno.readTextFile(filePath);
    const data = JSON.parse(content);
    
    if (options.validateSchema) {
      this.validateProcessData(data);
    }
    
    let processes = data.processes || data;
    
    if (options.transformers) {
      for (const transformer of options.transformers) {
        processes = transformer(processes);
      }
    }
    
    return processes;
  }
  
  /**
   * Import knowledge entries
   */
  async importKnowledge(
    filePath: string,
    options: ImportOptions = {}
  ): Promise<KnowledgeEntry[]> {
    const content = await Deno.readTextFile(filePath);
    const data = JSON.parse(content);
    
    if (options.validateSchema) {
      this.validateKnowledgeData(data);
    }
    
    let entries = data.entries || data;
    
    if (options.transformers) {
      for (const transformer of options.transformers) {
        entries = transformer(entries);
      }
    }
    
    // Convert date strings back to Date objects
    return entries.map((e: any) => ({
      ...e,
      timestamp: new Date(e.timestamp),
      lastUpdated: new Date(e.lastUpdated)
    }));
  }
  
  /**
   * Import queue entries
   */
  async importQueue(
    filePath: string,
    options: ImportOptions = {}
  ): Promise<QueueEntry[]> {
    const content = await Deno.readTextFile(filePath);
    const data = JSON.parse(content);
    
    if (options.validateSchema) {
      this.validateQueueData(data);
    }
    
    let entries = data.entries || data;
    
    if (options.transformers) {
      for (const transformer of options.transformers) {
        entries = transformer(entries);
      }
    }
    
    // Convert date strings back to Date objects
    return entries.map((e: any) => ({
      ...e,
      queuedAt: new Date(e.queuedAt),
      startedAt: e.startedAt ? new Date(e.startedAt) : undefined,
      completedAt: e.completedAt ? new Date(e.completedAt) : undefined
    }));
  }
  
  /**
   * Restore from system backup
   */
  async restoreFromBackup(
    backupPath: string,
    options: ImportOptions = {}
  ): Promise<SystemBackup> {
    const mainFile = `${backupPath}/backup.json`;
    const content = await Deno.readTextFile(mainFile);
    const backup = JSON.parse(content);
    
    if (options.validateSchema) {
      this.validateBackup(backup);
    }
    
    // Convert dates
    backup.metadata.timestamp = new Date(backup.metadata.timestamp);
    
    if (backup.processes) {
      backup.processes = backup.processes.map((p: any) => ({
        ...p,
        startTime: new Date(p.startTime),
        endTime: p.endTime ? new Date(p.endTime) : undefined,
        logs: p.logs.map((l: any) => ({
          ...l,
          timestamp: new Date(l.timestamp)
        }))
      }));
    }
    
    if (backup.knowledge) {
      backup.knowledge = backup.knowledge.map((e: any) => ({
        ...e,
        timestamp: new Date(e.timestamp),
        lastUpdated: new Date(e.lastUpdated)
      }));
    }
    
    if (backup.queue) {
      backup.queue = backup.queue.map((e: any) => ({
        ...e,
        queuedAt: new Date(e.queuedAt),
        startedAt: e.startedAt ? new Date(e.startedAt) : undefined,
        completedAt: e.completedAt ? new Date(e.completedAt) : undefined
      }));
    }
    
    return backup;
  }
  
  // Validation methods
  private validateProcessData(data: any): void {
    if (!Array.isArray(data.processes) && !Array.isArray(data)) {
      throw new Error('Invalid process data format');
    }
  }
  
  private validateKnowledgeData(data: any): void {
    if (!Array.isArray(data.entries) && !Array.isArray(data)) {
      throw new Error('Invalid knowledge data format');
    }
  }
  
  private validateQueueData(data: any): void {
    if (!Array.isArray(data.entries) && !Array.isArray(data)) {
      throw new Error('Invalid queue data format');
    }
  }
  
  private validateBackup(backup: any): void {
    if (!backup.metadata || !backup.metadata.version) {
      throw new Error('Invalid backup format: missing metadata');
    }
    
    if (backup.metadata.version !== '1.0.0') {
      throw new Error(`Unsupported backup version: ${backup.metadata.version}`);
    }
  }
}

// Export singleton instances
export const dataExporter = new DataExporter();
export const dataImporter = new DataImporter();