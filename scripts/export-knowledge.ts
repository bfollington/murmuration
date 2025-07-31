#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env

/**
 * Knowledge Export Script
 * 
 * Exports knowledge base entries to various formats:
 * - JSON (default)
 * - Markdown
 * - CSV
 */

import { dataExporter, ExportFormat } from '../src/shared/export-import.ts';
import { KnowledgeRegistry } from '../src/knowledge/registry.ts';
import { knowledgePersistence } from '../src/knowledge/persistence.ts';
import { parseArgs } from "https://deno.land/std@0.208.0/cli/parse_args.ts";

async function exportKnowledge() {
  // Parse command line arguments
  const args = parseArgs(Deno.args, {
    string: ['format', 'output', 'tag'],
    boolean: ['help', 'pretty'],
    default: {
      format: 'json',
      output: `./exports/knowledge-${new Date().toISOString().split('T')[0]}`,
      pretty: true
    }
  });
  
  if (args.help) {
    printHelp();
    return;
  }
  
  console.log('📚 Knowledge Export Tool\n');
  
  try {
    // Load knowledge data
    console.log('📥 Loading knowledge base...');
    const registry = new KnowledgeRegistry();
    await knowledgePersistence.loadIntoRegistry(registry);
    const entries = registry.getAllEntries();
    console.log(`✓ Loaded ${entries.length} entries`);
    
    // Determine format and file extension
    let format: ExportFormat;
    let extension: string;
    
    switch (args.format.toLowerCase()) {
      case 'markdown':
      case 'md':
        format = ExportFormat.MARKDOWN;
        extension = '.md';
        break;
      case 'csv':
        format = ExportFormat.CSV;
        extension = '.csv';
        break;
      case 'json':
      default:
        format = ExportFormat.JSON;
        extension = '.json';
        break;
    }
    
    // Build export options
    const exportOptions = {
      format,
      pretty: args.pretty,
      includeMetadata: true,
      filters: args.tag ? { tags: [args.tag] } : undefined
    };
    
    // Export
    const outputPath = args.output.endsWith(extension) ? args.output : `${args.output}${extension}`;
    console.log(`\n📤 Exporting to ${format.toUpperCase()} format...`);
    
    await dataExporter.exportKnowledge(entries, outputPath, exportOptions);
    
    console.log(`\n✅ Export completed successfully!`);
    console.log(`📁 Output: ${outputPath}`);
    
    // Show summary
    if (args.tag) {
      const filtered = entries.filter(e => e.tags.includes(args.tag));
      console.log(`\n📊 Exported ${filtered.length} entries with tag "${args.tag}"`);
    } else {
      const questions = entries.filter(e => e.type === 'question').length;
      const answers = entries.filter(e => e.type === 'answer').length;
      const notes = entries.filter(e => e.type === 'note').length;
      
      console.log('\n📊 Export Summary:');
      console.log(`- Questions: ${questions}`);
      console.log(`- Answers: ${answers}`);
      console.log(`- Notes: ${notes}`);
      console.log(`- Total: ${entries.length}`);
    }
    
  } catch (error) {
    console.error('❌ Export failed:', error.message);
    Deno.exit(1);
  }
}

function printHelp() {
  console.log(`
Knowledge Export Tool

Usage:
  deno run --allow-read --allow-write scripts/export-knowledge.ts [options]

Options:
  --format <format>   Export format: json, markdown, csv (default: json)
  --output <path>     Output file path (default: ./exports/knowledge-YYYY-MM-DD)
  --tag <tag>         Filter by tag (optional)
  --pretty            Pretty print JSON output (default: true)
  --help              Show this help message

Examples:
  # Export to JSON
  deno run --allow-read --allow-write scripts/export-knowledge.ts

  # Export to Markdown
  deno run --allow-read --allow-write scripts/export-knowledge.ts --format=markdown

  # Export only entries with "troubleshooting" tag
  deno run --allow-read --allow-write scripts/export-knowledge.ts --tag=troubleshooting

  # Export to specific file
  deno run --allow-read --allow-write scripts/export-knowledge.ts --output=./my-knowledge.json
`);
}

// Run export
if (import.meta.main) {
  await exportKnowledge();
}