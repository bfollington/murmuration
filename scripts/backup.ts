#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

/**
 * System Backup Script
 * 
 * Creates a complete backup of all system data including:
 * - Processes
 * - Knowledge base
 * - Queue entries
 */

import { dataExporter } from '../src/shared/export-import.ts';
import { ProcessRegistry } from '../src/process/registry.ts';
import { KnowledgeRegistry } from '../src/knowledge/registry.ts';
import { knowledgePersistence } from '../src/knowledge/persistence.ts';
import { QueueManager } from '../src/queue/manager.ts';
import { queuePersistence } from '../src/queue/persistence.ts';

async function createBackup() {
  console.log('🔄 Starting system backup...\n');
  
  try {
    // Load data from persistence
    console.log('📥 Loading data from persistence...');
    
    // Load knowledge data
    const knowledgeRegistry = new KnowledgeRegistry();
    await knowledgePersistence.loadIntoRegistry(knowledgeRegistry);
    const knowledgeEntries = knowledgeRegistry.getAllEntries();
    console.log(`✓ Loaded ${knowledgeEntries.length} knowledge entries`);
    
    // Load queue data
    const queueEntries = await queuePersistence.load();
    console.log(`✓ Loaded ${queueEntries.length} queue entries`);
    
    // Process data (in-memory only for this example)
    const processRegistry = ProcessRegistry.getDefaultInstance();
    const processes = processRegistry.getAllProcesses();
    console.log(`✓ Found ${processes.length} active processes`);
    
    // Create backup
    console.log('\n📦 Creating backup...');
    const backupDir = './backups';
    const backupPath = await dataExporter.createSystemBackup(
      {
        processes: processes.length > 0 ? processes : undefined,
        knowledge: knowledgeEntries.length > 0 ? knowledgeEntries : undefined,
        queue: queueEntries.length > 0 ? queueEntries : undefined
      },
      backupDir
    );
    
    console.log(`\n✅ Backup created successfully!`);
    console.log(`📁 Location: ${backupPath}`);
    
    // Show backup contents
    const metadata = JSON.parse(
      await Deno.readTextFile(`${backupPath}/metadata.json`)
    );
    
    console.log('\n📊 Backup Summary:');
    console.log(`- Version: ${metadata.version}`);
    console.log(`- Timestamp: ${metadata.timestamp}`);
    console.log(`- Processes: ${metadata.counts.processes}`);
    console.log(`- Knowledge entries: ${metadata.counts.knowledge}`);
    console.log(`- Queue entries: ${metadata.counts.queue}`);
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    Deno.exit(1);
  }
}

// Run backup
if (import.meta.main) {
  await createBackup();
}