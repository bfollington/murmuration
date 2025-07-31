/**
 * Cross-reference resolution utilities for knowledge entries
 * 
 * This module provides utilities to find, validate, and manage cross-references
 * between knowledge entries using the [[ENTRY_ID]] syntax.
 */

import { 
  KnowledgeEntry, 
  KnowledgeType 
} from './types.ts';
import { 
  CROSS_REFERENCE_PATTERN 
} from './file-format.ts';
import { 
  CrossReference,
  parseCrossReferences 
} from './file-io.ts';
import { 
  findEntriesById,
  getAllFilePaths,
  SearchResult 
} from './file-search.ts';

/**
 * Cross-reference validation result
 */
export interface CrossReferenceValidation {
  reference: CrossReference;
  exists: boolean;
  entry?: KnowledgeEntry;
  filePath?: string;
}

/**
 * Related entries result
 */
export interface RelatedEntriesResult {
  referencedBy: SearchResult[]; // Entries that reference this one
  references: SearchResult[];   // Entries that this one references
  bidirectional: SearchResult[]; // Entries with mutual references
}

/**
 * Reference update operation
 */
export interface ReferenceUpdate {
  filePath: string;
  originalContent: string;
  updatedContent: string;
  changesCount: number;
}

/**
 * Resolve cross-references in content and validate they exist
 * 
 * @param content - Markdown content to analyze
 * @returns Array of cross-reference validations
 */
export async function resolveCrossReferences(content: string): Promise<CrossReferenceValidation[]> {
  // Parse all cross-references from content
  const references = parseCrossReferences(content);
  
  if (references.length === 0) {
    return [];
  }

  // Get unique IDs to look up
  const uniqueIds = [...new Set(references.map(ref => ref.id))];
  
  // Find all referenced entries
  const foundEntries = await findEntriesById(uniqueIds);
  
  // Build validation results
  const validations: CrossReferenceValidation[] = [];
  
  for (const reference of references) {
    const found = foundEntries.get(reference.id);
    
    validations.push({
      reference,
      exists: !!found,
      entry: found?.entry,
      filePath: found?.filePath
    });
  }

  return validations;
}

/**
 * Find all entries that reference or are referenced by a given entry
 * 
 * @param entryId - ID of the entry to find related entries for
 * @returns Object containing arrays of related entries
 */
export async function findRelatedEntries(entryId: string): Promise<RelatedEntriesResult> {
  const result: RelatedEntriesResult = {
    referencedBy: [],
    references: [],
    bidirectional: []
  };

  // Get all knowledge files
  const allFilePaths = await getAllFilePaths();
  
  // First, find what the target entry references
  const targetEntry = await findEntriesById([entryId]);
  const targetResult = targetEntry.get(entryId);
  
  if (targetResult) {
    const targetReferences = parseCrossReferences(targetResult.entry.content);
    const targetReferencedIds = targetReferences.map(ref => ref.id);
    
    if (targetReferencedIds.length > 0) {
      const referencedEntries = await findEntriesById(targetReferencedIds);
      result.references = Array.from(referencedEntries.values());
    }
  }

  // Now scan all files to find entries that reference our target
  const referencedByResults: SearchResult[] = [];
  const crossReferencePattern = new RegExp(`\\[\\[${escapeRegExp(entryId)}\\]\\]`, 'g');
  
  for (const filePath of allFilePaths) {
    try {
      const content = await Deno.readTextFile(filePath);
      
      // Quick check: does this file reference our entry?
      if (crossReferencePattern.test(content)) {
        // Parse the full file to get the entry
        const { parseMarkdownFile, convertFrontmatterDates, validateParsedEntry } = await import('./file-io.ts');
        
        try {
          const parsed = await parseMarkdownFile(filePath);
          const frontmatter = convertFrontmatterDates(parsed.frontmatter);
          
          if (!validateParsedEntry(frontmatter, parsed.content)) {
            continue;
          }

          // Construct the entry (similar to loadEntryFromFile but inline)
          const entry: KnowledgeEntry = {
            id: frontmatter.id as string,
            type: frontmatter.type as KnowledgeType,
            content: parsed.content,
            timestamp: frontmatter.timestamp as Date,
            lastUpdated: frontmatter.lastUpdated as Date,
            tags: (frontmatter.tags as string[]) || [],
            status: frontmatter.status as any,
            processId: frontmatter.processId as string | undefined,
            metadata: (frontmatter.metadata as Record<string, unknown>) || {}
          };

          // Add type-specific fields (abbreviated version)
          if (entry.type === KnowledgeType.QUESTION) {
            (entry as any).answered = frontmatter.answered as boolean;
            (entry as any).answerIds = (frontmatter.answerIds as string[]) || [];
            (entry as any).priority = frontmatter.priority as string | undefined;
          } else if (entry.type === KnowledgeType.ANSWER) {
            (entry as any).questionId = frontmatter.questionId as string;
            (entry as any).accepted = frontmatter.accepted as boolean;
            (entry as any).votes = frontmatter.votes as number | undefined;
          } else if (entry.type === KnowledgeType.NOTE) {
            (entry as any).category = frontmatter.category as string | undefined;
            (entry as any).relatedIds = (frontmatter.relatedIds as string[]) || [];
          } else if (entry.type === KnowledgeType.ISSUE) {
            (entry as any).priority = frontmatter.priority as string;
            (entry as any).assignee = frontmatter.assignee as string | undefined;
            (entry as any).dueDate = frontmatter.dueDate as Date | undefined;
            (entry as any).relatedIds = (frontmatter.relatedIds as string[]) || [];
          }

          // Skip self-references
          if (entry.id !== entryId) {
            referencedByResults.push({
              entry,
              filePath
            });
          }
        } catch (error) {
          console.warn(`Failed to parse entry from ${filePath}:`, error);
          continue;
        }
      }
    } catch (error) {
      console.warn(`Failed to read file ${filePath}:`, error);
      continue;
    }
  }

  result.referencedBy = referencedByResults;

  // Find bidirectional references (entries that reference each other)
  if (targetResult) {
    const targetReferencedIds = new Set(parseCrossReferences(targetResult.entry.content).map(ref => ref.id));
    
    result.bidirectional = result.referencedBy.filter(referencingResult => {
      return targetReferencedIds.has(referencingResult.entry.id);
    });
  }

  return result;
}

/**
 * Validate all cross-references in a knowledge entry
 * 
 * @param entry - Knowledge entry to validate
 * @returns Array of validation results
 */
export async function validateReferences(entry: KnowledgeEntry): Promise<CrossReferenceValidation[]> {
  return await resolveCrossReferences(entry.content);
}

/**
 * Update all references to an entry when its ID changes
 * 
 * @param oldId - The old entry ID
 * @param newId - The new entry ID
 * @param dryRun - If true, don't actually update files, just return what would be updated
 * @returns Array of update operations performed or that would be performed
 */
export async function updateReferences(
  oldId: string, 
  newId: string, 
  dryRun = false
): Promise<ReferenceUpdate[]> {
  if (oldId === newId) {
    return [];
  }

  const updates: ReferenceUpdate[] = [];
  const allFilePaths = await getAllFilePaths();
  
  // Create regex patterns for finding references
  const oldReferencePattern = new RegExp(`\\[\\[${escapeRegExp(oldId)}\\]\\]`, 'g');
  const newReference = `[[${newId}]]`;

  for (const filePath of allFilePaths) {
    try {
      const originalContent = await Deno.readTextFile(filePath);
      
      // Check if this file contains references to the old ID
      if (oldReferencePattern.test(originalContent)) {
        // Reset regex state and count matches
        oldReferencePattern.lastIndex = 0;
        const matches = [...originalContent.matchAll(oldReferencePattern)];
        
        if (matches.length > 0) {
          // Replace all occurrences
          const updatedContent = originalContent.replace(oldReferencePattern, newReference);
          
          updates.push({
            filePath,
            originalContent,
            updatedContent,
            changesCount: matches.length
          });

          // Actually perform the update if not dry run
          if (!dryRun) {
            await Deno.writeTextFile(filePath, updatedContent);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to process file ${filePath} for reference update:`, error);
      continue;
    }
  }

  return updates;
}

/**
 * Find all broken cross-references across all knowledge entries
 * 
 * @returns Array of broken references with their locations
 */
export async function findBrokenReferences(): Promise<{
  filePath: string;
  entryId: string;
  brokenReferences: CrossReferenceValidation[];
}[]> {
  const results: {
    filePath: string;
    entryId: string;
    brokenReferences: CrossReferenceValidation[];
  }[] = [];

  const allFilePaths = await getAllFilePaths();

  for (const filePath of allFilePaths) {
    try {
      const content = await Deno.readTextFile(filePath);
      const references = parseCrossReferences(content);
      
      if (references.length > 0) {
        const validations = await resolveCrossReferences(content);
        const brokenReferences = validations.filter(v => !v.exists);
        
        if (brokenReferences.length > 0) {
          // Extract entry ID from file path
          const filename = filePath.split('/').pop() || '';
          const entryId = filename.slice(0, filename.lastIndexOf('.'));
          
          results.push({
            filePath,
            entryId,
            brokenReferences
          });
        }
      }
    } catch (error) {
      console.warn(`Failed to check references in ${filePath}:`, error);
      continue;
    }
  }

  return results;
}

/**
 * Get reference statistics for the knowledge base
 * 
 * @returns Statistics about cross-references
 */
export async function getReferenceStatistics(): Promise<{
  totalReferences: number;
  uniqueReferencedEntries: number;
  brokenReferences: number;
  mostReferencedEntries: { id: string; count: number }[];
  entriesWithMostReferences: { id: string; count: number }[];
}> {
  const allFilePaths = await getAllFilePaths();
  const referenceMap = new Map<string, number>(); // entryId -> count of times referenced
  const outgoingReferences = new Map<string, number>(); // entryId -> count of references it makes
  const allReferences: CrossReference[] = [];
  let brokenCount = 0;

  // Collect all references
  for (const filePath of allFilePaths) {
    try {
      const content = await Deno.readTextFile(filePath);
      const references = parseCrossReferences(content);
      
      if (references.length > 0) {
        const filename = filePath.split('/').pop() || '';
        const sourceEntryId = filename.slice(0, filename.lastIndexOf('.'));
        
        // Count outgoing references
        outgoingReferences.set(sourceEntryId, references.length);
        
        // Count incoming references and collect all references
        for (const ref of references) {
          allReferences.push(ref);
          referenceMap.set(ref.id, (referenceMap.get(ref.id) || 0) + 1);
        }
      }
    } catch (error) {
      console.warn(`Failed to analyze references in ${filePath}:`, error);
      continue;
    }
  }

  // Check for broken references
  if (allReferences.length > 0) {
    const uniqueIds = [...new Set(allReferences.map(ref => ref.id))];
    const existingEntries = await findEntriesById(uniqueIds);
    
    brokenCount = allReferences.filter(ref => !existingEntries.has(ref.id)).length;
  }

  // Sort for most referenced entries
  const mostReferenced = Array.from(referenceMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ id, count }));

  // Sort for entries with most outgoing references
  const mostOutgoing = Array.from(outgoingReferences.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ id, count }));

  return {
    totalReferences: allReferences.length,
    uniqueReferencedEntries: referenceMap.size,
    brokenReferences: brokenCount,
    mostReferencedEntries: mostReferenced,
    entriesWithMostReferences: mostOutgoing
  };
}

/**
 * Extract all cross-reference IDs from content
 * 
 * @param content - Content to extract references from
 * @returns Array of unique referenced entry IDs
 */
export function extractReferenceIds(content: string): string[] {
  const references = parseCrossReferences(content);
  return [...new Set(references.map(ref => ref.id))];
}

/**
 * Replace cross-references in content with new format or IDs
 * 
 * @param content - Original content
 * @param replacements - Map of old ID to new ID
 * @returns Updated content with replaced references
 */
export function replaceReferences(
  content: string, 
  replacements: Map<string, string>
): string {
  let updatedContent = content;
  
  for (const [oldId, newId] of replacements) {
    const pattern = new RegExp(`\\[\\[${escapeRegExp(oldId)}\\]\\]`, 'g');
    updatedContent = updatedContent.replace(pattern, `[[${newId}]]`);
  }
  
  return updatedContent;
}

/**
 * Validate that cross-reference syntax is correct
 * 
 * @param content - Content to validate
 * @returns Array of validation issues
 */
export function validateCrossReferenceSyntax(content: string): {
  position: number;
  length: number;
  issue: string;
  suggestion?: string;
}[] {
  const issues: {
    position: number;
    length: number;
    issue: string;
    suggestion?: string;
  }[] = [];

  const flaggedPositions = new Set<number>();

  // First, exclude valid references to avoid false positives
  const validPattern = /\[\[([A-Z]+_\d+)\]\]/g;
  let validMatch: RegExpExecArray | null;
  while ((validMatch = validPattern.exec(content)) !== null) {
    // Mark this range as valid
    for (let i = validMatch.index; i < validMatch.index + validMatch[0].length; i++) {
      flaggedPositions.add(i);
    }
  }

  // Find potential malformed references
  // Note: Order matters - more specific patterns first
  const malformedPatterns = [
    { pattern: /\[\[([a-z]+_\d+)\]\]/g, issue: 'Lowercase type prefix (should be uppercase)' },
    { pattern: /\[\[([A-Z]+\d+)\]\]/g, issue: 'Missing underscore between type and number' },
    { pattern: /\[\[([A-Z]+_\d+)\](?!\])/g, issue: 'Missing closing bracket' },
    { pattern: /\[(?!\[)([A-Z]+_\d+)\]\]/g, issue: 'Missing opening bracket' },
    { pattern: /\[(?!\[)([A-Z]+_\d+)\](?!\])/g, issue: 'Single brackets used instead of double' }
  ];

  for (const { pattern, issue } of malformedPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    
    while ((match = pattern.exec(content)) !== null) {
      // Skip if this position is already flagged as valid or as an issue
      if (flaggedPositions.has(match.index)) {
        continue;
      }

      const suggestion = issue.includes('Single brackets') ? `[[${match[1]}]]` :
                        issue.includes('Missing closing') ? `[[${match[1]}]]` :
                        issue.includes('Missing opening') ? `[[${match[1]}]]` :
                        issue.includes('Lowercase') ? `[[${match[1].toUpperCase()}]]` :
                        issue.includes('Missing underscore') ? `[[${match[1].replace(/([A-Z]+)(\d+)/, '$1_$2')}]]` :
                        undefined;
      
      issues.push({
        position: match.index,
        length: match[0].length,
        issue,
        suggestion
      });

      // Mark this range as flagged to avoid overlaps
      for (let i = match.index; i < match.index + match[0].length; i++) {
        flaggedPositions.add(i);
      }
    }
  }

  return issues;
}

/**
 * Escape special regex characters in a string
 * 
 * @param string - String to escape
 * @returns Escaped string safe for regex
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}