/**
 * Migration Script
 * 
 * Converts existing knowledge data (questions, answers, notes) to the new fragment system.
 * This script reads from knowledge-state.json and creates corresponding fragments in LanceDB.
 */

import { logger } from '../../shared/logger.ts';
import { FragmentStore, getFragmentStore } from './fragment-store.ts';
import { CreateFragmentRequest, FragmentType } from './fragment-types.ts';

/**
 * Legacy knowledge data structures
 */
interface LegacyKnowledgeEntry {
  id: string;
  type: 'question' | 'answer' | 'note';
  content: string;
  category?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  timestamp: string;
  priority?: 'low' | 'medium' | 'high';
  processId?: string;
  questionId?: string; // For answers
  relatedIds?: string[];
}

interface LegacyKnowledgeState {
  entries: LegacyKnowledgeEntry[];
  lastId: number;
}

/**
 * Migration service
 */
export class KnowledgeMigrationService {
  private readonly fragmentStore: FragmentStore;
  
  constructor(fragmentStore?: FragmentStore) {
    this.fragmentStore = fragmentStore || getFragmentStore();
  }
  
  /**
   * Run the migration from legacy knowledge data to fragments
   */
  async migrate(legacyDataPath = 'knowledge-state.json'): Promise<void> {
    logger.info('KnowledgeMigration', 'Starting migration from legacy knowledge data to fragments');
    
    try {
      // Initialize fragment store
      await this.fragmentStore.initialize();
      
      // Check if legacy data file exists
      let legacyData: LegacyKnowledgeState;
      try {
        const data = await Deno.readTextFile(legacyDataPath);
        legacyData = JSON.parse(data);
      } catch (error) {
        logger.info('KnowledgeMigration', `No legacy data found at ${legacyDataPath}, skipping migration`);
        return;
      }
      
      if (!legacyData.entries || legacyData.entries.length === 0) {
        logger.info('KnowledgeMigration', 'No legacy entries to migrate');
        return;
      }
      
      logger.info('KnowledgeMigration', `Found ${legacyData.entries.length} legacy entries to migrate`);
      
      // Migrate each entry
      let migratedCount = 0;
      let skippedCount = 0;
      
      for (const entry of legacyData.entries) {
        try {
          await this.migrateEntry(entry);
          migratedCount++;
        } catch (error) {
          logger.warn('KnowledgeMigration', `Failed to migrate entry ${entry.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          skippedCount++;
        }
      }
      
      logger.info('KnowledgeMigration', `Migration completed: ${migratedCount} migrated, ${skippedCount} skipped`);
      
      // Create backup of legacy data
      const backupPath = `${legacyDataPath}.backup.${Date.now()}`;
      await Deno.copyFile(legacyDataPath, backupPath);
      logger.info('KnowledgeMigration', `Legacy data backed up to ${backupPath}`);
      
    } catch (error) {
      logger.error('KnowledgeMigration', `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }
  
  /**
   * Migrate a single legacy entry to a fragment
   */
  private async migrateEntry(entry: LegacyKnowledgeEntry): Promise<void> {
    // Create fragment request from legacy entry
    const fragmentRequest: CreateFragmentRequest = {
      title: this.generateTitleFromContent(entry.content, entry.type),
      body: entry.content,
      type: this.mapLegacyTypeToFragmentType(entry.type),
      tags: entry.tags || [],
      metadata: {
        ...entry.metadata,
        migratedFrom: 'legacy-knowledge',
        legacyId: entry.id,
        legacyType: entry.type,
        processId: entry.processId,
        questionId: entry.questionId,
        category: entry.category
      },
      relatedIds: entry.relatedIds,
      priority: entry.priority || 'medium',
      status: 'active'
    };
    
    // Create the fragment
    const fragment = await this.fragmentStore.createFragment(fragmentRequest);
    logger.info('KnowledgeMigration', `Migrated ${entry.type} ${entry.id} -> fragment ${fragment.id}`);
  }
  
  /**
   * Generate a title from content based on type
   */
  private generateTitleFromContent(content: string, type: string): string {
    // Take first 60 characters and clean up
    const title = content.substring(0, 60).trim();
    
    // Remove newlines and extra whitespace
    const cleanTitle = title.replace(/\\s+/g, ' ').trim();
    
    // Add ellipsis if truncated
    const finalTitle = content.length > 60 ? `${cleanTitle}...` : cleanTitle;
    
    // Add type prefix if title doesn't make the type obvious
    switch (type) {
      case 'question':
        return finalTitle.endsWith('?') ? finalTitle : `Question: ${finalTitle}`;
      case 'answer':
        return `Answer: ${finalTitle}`;
      case 'note':
        return `Note: ${finalTitle}`;
      default:
        return finalTitle;
    }
  }
  
  /**
   * Map legacy types to fragment types
   */
  private mapLegacyTypeToFragmentType(legacyType: string): FragmentType {
    switch (legacyType) {
      case 'question':
        return 'question';
      case 'answer':
        return 'answer';
      case 'note':
        return 'note';
      default:
        return 'note'; // Default fallback
    }
  }
  
  /**
   * Get migration statistics
   */
  async getMigrationStats(): Promise<{
    legacyEntries: number;
    migratedFragments: number;
    hasMigrated: boolean;
  }> {
    // Check for legacy data
    let legacyEntries = 0;
    try {
      const data = await Deno.readTextFile('knowledge-state.json');
      const legacyData: LegacyKnowledgeState = JSON.parse(data);
      legacyEntries = legacyData.entries?.length || 0;
    } catch {
      // File doesn't exist or is invalid
    }
    
    // Count migrated fragments
    await this.fragmentStore.initialize();
    const fragments = await this.fragmentStore.getAllFragments();
    const migratedFragments = fragments.filter(f => 
      f.metadata?.migratedFrom === 'legacy-knowledge'
    ).length;
    
    return {
      legacyEntries,
      migratedFragments,
      hasMigrated: migratedFragments > 0
    };
  }
}

/**
 * CLI script for running migration
 */
if (import.meta.main) {
  const migrationService = new KnowledgeMigrationService();
  
  try {
    await migrationService.migrate();
    
    const stats = await migrationService.getMigrationStats();
    console.log('Migration Statistics:');
    console.log(`- Legacy entries: ${stats.legacyEntries}`);
    console.log(`- Migrated fragments: ${stats.migratedFragments}`);
    console.log(`- Has migrated: ${stats.hasMigrated}`);
    
  } catch (error) {
    console.error('Migration failed:', error);
    Deno.exit(1);
  }
}