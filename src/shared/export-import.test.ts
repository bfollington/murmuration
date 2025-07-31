import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  DataExporter,
  DataImporter,
  ExportFormat,
  dataExporter,
  dataImporter
} from './export-import.ts';
import { ProcessStatus } from './types.ts';
import { KnowledgeType } from '../knowledge/types.ts';
import { QueueStatus, type QueuePriority } from '../queue/types.ts';

// Test data factories
function createTestProcess(id: string) {
  return {
    id,
    title: `Process ${id}`,
    name: `process-${id}`,
    command: ['echo', `hello ${id}`],
    status: ProcessStatus.running,
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: undefined,
    pid: 12345,
    child: undefined,
    logs: [{
      timestamp: new Date('2024-01-01T10:00:01Z'),
      type: 'stdout' as const,
      content: `Output from ${id}`
    }],
    metadata: { test: true },
    exitCode: undefined,
    exitSignal: undefined
  };
}

function createTestQuestion(id: string) {
  return {
    id,
    type: KnowledgeType.QUESTION,
    title: `Question ${id}`,
    description: `Description for question ${id}`,
    tags: ['test', 'question'],
    timestamp: new Date('2024-01-01T10:00:00Z'),
    lastUpdated: new Date('2024-01-01T10:00:00Z'),
    metadata: {},
    answerIds: []
  };
}

function createTestQueueEntry(id: string) {
  return {
    id,
    process: {
      script_name: `script-${id}.sh`,
      title: `Queue Entry ${id}`,
      args: ['--test'],
      env_vars: { TEST: 'true' },
      priority: 5 as QueuePriority, // Normal priority
      metadata: {}
    },
    status: QueueStatus.PENDING,
    priority: 5 as QueuePriority, // Normal priority
    queuedAt: new Date('2024-01-01T10:00:00Z'),
    startedAt: undefined,
    completedAt: undefined,
    processId: undefined,
    error: undefined,
    retryCount: 0,
    maxRetries: 3
  };
}

// Temp directory for test files
const testDir = await Deno.makeTempDir();

Deno.test("DataExporter - export processes as JSON", async () => {
  const processes = [
    createTestProcess('p1'),
    createTestProcess('p2')
  ];
  
  const filePath = `${testDir}/processes.json`;
  
  await dataExporter.exportProcesses(processes, filePath, {
    format: ExportFormat.JSON,
    pretty: true,
    includeMetadata: true
  });
  
  const content = await Deno.readTextFile(filePath);
  const data = JSON.parse(content);
  
  assertEquals(data.version, '1.0');
  assertEquals(data.count, 2);
  assertEquals(data.processes.length, 2);
  assertEquals(data.processes[0].id, 'p1');
  assertEquals(data.processes[0].metadata.test, true);
});

Deno.test("DataExporter - export processes as Markdown", async () => {
  const processes = [
    createTestProcess('p1'),
    createTestProcess('p2')
  ];
  
  const filePath = `${testDir}/processes.md`;
  
  await dataExporter.exportProcesses(processes, filePath, {
    format: ExportFormat.MARKDOWN,
    includeMetadata: true
  });
  
  const content = await Deno.readTextFile(filePath);
  
  assertEquals(content.includes('# Process Export'), true);
  assertEquals(content.includes('Total Processes: 2'), true);
  assertEquals(content.includes('### Process p1'), true);
  assertEquals(content.includes('- **Status**: running'), true);
  assertEquals(content.includes('#### Recent Logs'), true);
});

Deno.test("DataExporter - export processes as CSV", async () => {
  const processes = [
    createTestProcess('p1'),
    createTestProcess('p2')
  ];
  
  const filePath = `${testDir}/processes.csv`;
  
  await dataExporter.exportProcesses(processes, filePath, {
    format: ExportFormat.CSV
  });
  
  const content = await Deno.readTextFile(filePath);
  const lines = content.split('\n');
  
  assertEquals(lines.length, 3); // Header + 2 rows
  assertEquals(lines[0].startsWith('ID,Title,Name'), true);
  assertEquals(lines[1].includes('p1,Process p1'), true);
  assertEquals(lines[2].includes('p2,Process p2'), true);
});

Deno.test("DataExporter - export with filters", async () => {
  const processes = [
    { ...createTestProcess('p1'), startTime: new Date('2024-01-01') },
    { ...createTestProcess('p2'), startTime: new Date('2024-02-01') },
    { ...createTestProcess('p3'), startTime: new Date('2024-03-01') }
  ];
  
  const filePath = `${testDir}/filtered-processes.json`;
  
  await dataExporter.exportProcesses(processes, filePath, {
    format: ExportFormat.JSON,
    filters: {
      dateRange: {
        start: new Date('2024-01-15'),
        end: new Date('2024-02-15')
      }
    }
  });
  
  const content = await Deno.readTextFile(filePath);
  const data = JSON.parse(content);
  
  assertEquals(data.count, 1);
  assertEquals(data.processes[0].id, 'p2');
});

Deno.test("DataExporter - export knowledge as JSON", async () => {
  const entries = [
    createTestQuestion('q1'),
    createTestQuestion('q2')
  ];
  
  const filePath = `${testDir}/knowledge.json`;
  
  await dataExporter.exportKnowledge(entries, filePath, {
    format: ExportFormat.JSON,
    pretty: true
  });
  
  const content = await Deno.readTextFile(filePath);
  const data = JSON.parse(content);
  
  assertEquals(data.count, 2);
  assertEquals(data.entries[0].type, KnowledgeType.QUESTION);
  assertEquals(data.entries[0].title, 'Question q1');
});

Deno.test("DataExporter - create system backup", async () => {
  const data = {
    processes: [createTestProcess('p1')],
    knowledge: [createTestQuestion('q1')],
    queue: [createTestQueueEntry('e1')]
  };
  
  const backupPath = await dataExporter.createSystemBackup(data, testDir);
  
  assertExists(backupPath);
  
  // Check backup files exist
  const metadataExists = await Deno.stat(`${backupPath}/metadata.json`)
    .then(() => true)
    .catch(() => false);
  const backupExists = await Deno.stat(`${backupPath}/backup.json`)
    .then(() => true)
    .catch(() => false);
  const processesExists = await Deno.stat(`${backupPath}/processes.json`)
    .then(() => true)
    .catch(() => false);
  
  assertEquals(metadataExists, true);
  assertEquals(backupExists, true);
  assertEquals(processesExists, true);
  
  // Check metadata content
  const metadata = JSON.parse(
    await Deno.readTextFile(`${backupPath}/metadata.json`)
  );
  
  assertEquals(metadata.version, '1.0.0');
  assertEquals(metadata.source, 'murmuration');
  assertEquals(metadata.counts.processes, 1);
  assertEquals(metadata.counts.knowledge, 1);
  assertEquals(metadata.counts.queue, 1);
});

Deno.test("DataImporter - import processes", async () => {
  // First export some data
  const originalProcesses = [
    createTestProcess('p1'),
    createTestProcess('p2')
  ];
  
  const exportPath = `${testDir}/import-test-processes.json`;
  await dataExporter.exportProcesses(originalProcesses, exportPath, {
    format: ExportFormat.JSON
  });
  
  // Now import it
  const imported = await dataImporter.importProcesses(exportPath, {
    validateSchema: true
  });
  
  assertEquals(imported.length, 2);
  assertEquals(imported[0].id, 'p1');
  assertEquals(imported[1].id, 'p2');
});

Deno.test("DataImporter - import with transformers", async () => {
  const processes = [createTestProcess('p1')];
  const exportPath = `${testDir}/transform-test.json`;
  
  await dataExporter.exportProcesses(processes, exportPath, {
    format: ExportFormat.JSON
  });
  
  // Import with transformer
  const imported = await dataImporter.importProcesses(exportPath, {
    transformers: [
      (data) => data.map((p: any) => ({
        ...p,
        title: `Imported: ${p.title}`
      }))
    ]
  });
  
  assertEquals(imported[0].title, 'Imported: Process p1');
});

Deno.test("DataImporter - restore from backup", async () => {
  // Create a backup
  const data = {
    processes: [createTestProcess('p1')],
    knowledge: [createTestQuestion('q1')],
    queue: [createTestQueueEntry('e1')]
  };
  
  const backupPath = await dataExporter.createSystemBackup(data, testDir);
  
  // Restore from backup
  const restored = await dataImporter.restoreFromBackup(backupPath, {
    validateSchema: true
  });
  
  assertExists(restored.metadata);
  assertEquals(restored.metadata.version, '1.0.0');
  
  assertExists(restored.processes);
  assertEquals(restored.processes.length, 1);
  assertEquals(restored.processes[0].id, 'p1');
  
  assertExists(restored.knowledge);
  assertEquals(restored.knowledge.length, 1);
  assertEquals(restored.knowledge[0].id, 'q1');
  
  assertExists(restored.queue);
  assertEquals(restored.queue.length, 1);
  assertEquals(restored.queue[0].id, 'e1');
});

Deno.test("DataExporter - CSV escaping", async () => {
  const processes = [{
    ...createTestProcess('p1'),
    title: 'Process with, comma',
    name: 'Process with "quotes"',
    command: ['echo', 'line1\nline2']
  }];
  
  const filePath = `${testDir}/escaped.csv`;
  
  await dataExporter.exportProcesses(processes, filePath, {
    format: ExportFormat.CSV
  });
  
  const content = await Deno.readTextFile(filePath);
  
  // Check proper CSV escaping
  assertEquals(content.includes('"Process with, comma"'), true);
  assertEquals(content.includes('"Process with ""quotes"""'), true);
});

// Cleanup
Deno.test("Cleanup test directory", async () => {
  await Deno.remove(testDir, { recursive: true });
});