import { KnowledgeRegistry } from './registry.ts';
import {
  KnowledgeEntry,
  KnowledgeType,
  KnowledgeStats,
  Question,
  Answer,
  Note,
  isQuestion,
  isAnswer,
  isNote
} from './types.ts';

/**
 * Advanced statistics for knowledge entries
 */
export interface AdvancedKnowledgeStats extends KnowledgeStats {
  averages: {
    answersPerQuestion: number;
    tagsPerEntry: number;
    timeToAnswer: number; // milliseconds
    acceptanceRate: number; // percentage
  };
  trends: {
    dailyActivity: Record<string, number>; // ISO date -> count
    hourlyActivity: Record<number, number>; // hour (0-23) -> count
    topContributors: Array<{ processId: string; count: number }>;
    popularTags: Array<{ tag: string; count: number; growth: number }>;
  };
  quality: {
    unansweredHighPriority: number;
    staleQuestions: number; // unanswered for > 7 days
    orphanedAnswers: number; // answers to deleted questions
    duplicateTags: Array<{ tag: string; variations: string[] }>;
  };
  search: {
    commonSearchTerms: Array<{ term: string; frequency: number }>;
    relatedEntries: Map<string, string[]>; // entry ID -> related IDs
  };
}

/**
 * Knowledge Statistics Calculator
 * 
 * Provides advanced analytics and insights for the knowledge base
 */
export class KnowledgeStatistics {
  private registry: KnowledgeRegistry;
  private searchHistory: Map<string, number> = new Map();

  constructor(registry: KnowledgeRegistry) {
    this.registry = registry;
  }

  /**
   * Calculate advanced statistics
   */
  calculateAdvancedStats(): AdvancedKnowledgeStats {
    const basicStats = this.registry.getStatistics();
    const entries = this.registry.getAllEntries();
    
    return {
      ...basicStats,
      averages: this.calculateAverages(entries),
      trends: this.calculateTrends(entries),
      quality: this.calculateQualityMetrics(entries),
      search: this.calculateSearchMetrics(entries)
    };
  }

  /**
   * Calculate average metrics
   */
  private calculateAverages(entries: KnowledgeEntry[]): AdvancedKnowledgeStats['averages'] {
    const questions = entries.filter(isQuestion);
    const answers = entries.filter(isAnswer);
    
    // Average answers per question
    const totalAnswers = questions.reduce((sum, q) => sum + q.answerIds.length, 0);
    const answersPerQuestion = questions.length > 0 ? totalAnswers / questions.length : 0;
    
    // Average tags per entry
    const totalTags = entries.reduce((sum, e) => sum + e.tags.length, 0);
    const tagsPerEntry = entries.length > 0 ? totalTags / entries.length : 0;
    
    // Average time to answer
    let totalAnswerTime = 0;
    let answeredCount = 0;
    
    for (const question of questions) {
      if (question.answered && question.answerIds.length > 0) {
        const firstAnswer = answers.find(a => 
          question.answerIds.includes(a.id)
        );
        if (firstAnswer) {
          totalAnswerTime += firstAnswer.timestamp.getTime() - question.timestamp.getTime();
          answeredCount++;
        }
      }
    }
    
    const timeToAnswer = answeredCount > 0 ? totalAnswerTime / answeredCount : 0;
    
    // Acceptance rate
    const acceptedAnswers = answers.filter(a => a.accepted).length;
    const acceptanceRate = answers.length > 0 ? (acceptedAnswers / answers.length) * 100 : 0;
    
    return {
      answersPerQuestion: Math.round(answersPerQuestion * 100) / 100,
      tagsPerEntry: Math.round(tagsPerEntry * 100) / 100,
      timeToAnswer: Math.round(timeToAnswer),
      acceptanceRate: Math.round(acceptanceRate * 100) / 100
    };
  }

  /**
   * Calculate trend metrics
   */
  private calculateTrends(entries: KnowledgeEntry[]): AdvancedKnowledgeStats['trends'] {
    const dailyActivity: Record<string, number> = {};
    const hourlyActivity: Record<number, number> = {};
    const contributorCount: Map<string, number> = new Map();
    
    // Activity trends
    for (const entry of entries) {
      // Daily activity
      const dateKey = entry.timestamp.toISOString().split('T')[0];
      dailyActivity[dateKey] = (dailyActivity[dateKey] || 0) + 1;
      
      // Hourly activity
      const hour = entry.timestamp.getHours();
      hourlyActivity[hour] = (hourlyActivity[hour] || 0) + 1;
      
      // Contributor activity
      if (entry.processId) {
        contributorCount.set(
          entry.processId,
          (contributorCount.get(entry.processId) || 0) + 1
        );
      }
    }
    
    // Top contributors
    const topContributors = Array.from(contributorCount.entries())
      .map(([processId, count]) => ({ processId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // Popular tags with growth calculation
    const tagsByDate = new Map<string, Map<string, number>>();
    
    for (const entry of entries) {
      const dateKey = entry.timestamp.toISOString().split('T')[0];
      
      for (const tag of entry.tags) {
        if (!tagsByDate.has(tag)) {
          tagsByDate.set(tag, new Map());
        }
        const tagDates = tagsByDate.get(tag)!;
        tagDates.set(dateKey, (tagDates.get(dateKey) || 0) + 1);
      }
    }
    
    // Calculate tag growth (last 7 days vs previous 7 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    
    const popularTags = Array.from(tagsByDate.entries()).map(([tag, dates]) => {
      let recent = 0;
      let previous = 0;
      
      for (const [dateStr, count] of dates.entries()) {
        const date = new Date(dateStr);
        if (date >= sevenDaysAgo) {
          recent += count;
        } else if (date >= fourteenDaysAgo) {
          previous += count;
        }
      }
      
      const growth = previous > 0 ? ((recent - previous) / previous) * 100 : 0;
      const totalCount = Array.from(dates.values()).reduce((sum, c) => sum + c, 0);
      
      return { tag, count: totalCount, growth: Math.round(growth) };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
    
    return {
      dailyActivity,
      hourlyActivity,
      topContributors,
      popularTags
    };
  }

  /**
   * Calculate quality metrics
   */
  private calculateQualityMetrics(entries: KnowledgeEntry[]): AdvancedKnowledgeStats['quality'] {
    const questions = entries.filter(isQuestion);
    const answers = entries.filter(isAnswer);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Unanswered high priority questions
    const unansweredHighPriority = questions.filter(q => 
      !q.answered && q.priority === 'high'
    ).length;
    
    // Stale questions (unanswered for > 7 days)
    const staleQuestions = questions.filter(q => 
      !q.answered && q.timestamp < sevenDaysAgo
    ).length;
    
    // Orphaned answers (answers to non-existent questions)
    const questionIds = new Set(questions.map(q => q.id));
    const orphanedAnswers = answers.filter(a => 
      !questionIds.has(a.questionId)
    ).length;
    
    // Find duplicate/similar tags
    const duplicateTags = this.findDuplicateTags(entries);
    
    return {
      unansweredHighPriority,
      staleQuestions,
      orphanedAnswers,
      duplicateTags
    };
  }

  /**
   * Calculate search-related metrics
   */
  private calculateSearchMetrics(entries: KnowledgeEntry[]): AdvancedKnowledgeStats['search'] {
    // Common search terms (from search history)
    const commonSearchTerms = Array.from(this.searchHistory.entries())
      .map(([term, frequency]) => ({ term, frequency }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);
    
    // Related entries based on shared tags
    const relatedEntries = new Map<string, string[]>();
    
    for (const entry of entries) {
      const related: string[] = [];
      
      // Find entries with overlapping tags
      for (const other of entries) {
        if (other.id !== entry.id) {
          const sharedTags = entry.tags.filter(tag => other.tags.includes(tag));
          if (sharedTags.length >= 2) { // At least 2 shared tags
            related.push(other.id);
          }
        }
      }
      
      if (related.length > 0) {
        relatedEntries.set(entry.id, related.slice(0, 5)); // Max 5 related
      }
    }
    
    return {
      commonSearchTerms,
      relatedEntries
    };
  }

  /**
   * Find duplicate or similar tags
   */
  private findDuplicateTags(entries: KnowledgeEntry[]): Array<{ tag: string; variations: string[] }> {
    const allTags = new Set<string>();
    
    for (const entry of entries) {
      entry.tags.forEach(tag => allTags.add(tag));
    }
    
    const tagArray = Array.from(allTags);
    const duplicates: Array<{ tag: string; variations: string[] }> = [];
    const processed = new Set<string>();
    
    for (const tag of tagArray) {
      if (processed.has(tag)) continue;
      
      const variations: string[] = [];
      const tagLower = tag.toLowerCase();
      
      for (const other of tagArray) {
        if (tag !== other && !processed.has(other)) {
          const otherLower = other.toLowerCase();
          
          // Check for case variations
          if (tagLower === otherLower) {
            variations.push(other);
            processed.add(other);
          }
          // Check for plurals
          else if (tagLower === otherLower + 's' || tagLower + 's' === otherLower) {
            variations.push(other);
          }
          // Check for hyphen/underscore variations
          else if (tagLower.replace(/-/g, '_') === otherLower.replace(/-/g, '_')) {
            variations.push(other);
          }
        }
      }
      
      if (variations.length > 0) {
        duplicates.push({ tag, variations });
      }
      processed.add(tag);
    }
    
    return duplicates;
  }

  /**
   * Record a search term for analytics
   */
  recordSearch(term: string): void {
    this.searchHistory.set(term, (this.searchHistory.get(term) || 0) + 1);
  }

  /**
   * Get knowledge health score (0-100)
   */
  calculateHealthScore(): number {
    const stats = this.calculateAdvancedStats();
    let score = 100;
    
    // Deduct points for quality issues
    score -= Math.min(stats.quality.unansweredHighPriority * 5, 20);
    score -= Math.min(stats.quality.staleQuestions * 2, 15);
    score -= Math.min(stats.quality.orphanedAnswers * 10, 20);
    score -= Math.min(stats.quality.duplicateTags.length * 2, 10);
    
    // Deduct for low engagement
    if (stats.averages.answersPerQuestion < 1) {
      score -= 10;
    }
    if (stats.averages.acceptanceRate < 50) {
      score -= 10;
    }
    
    // Bonus for good metrics
    if (stats.averages.timeToAnswer < 24 * 60 * 60 * 1000) { // < 24 hours
      score += 5;
    }
    if (stats.averages.tagsPerEntry >= 2) {
      score += 5;
    }
    
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Generate a summary report
   */
  generateSummaryReport(): string {
    const stats = this.calculateAdvancedStats();
    const healthScore = this.calculateHealthScore();
    
    const report = [
      `# Knowledge Base Summary Report`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `## Overview`,
      `- Total Entries: ${stats.totalEntries}`,
      `- Questions: ${stats.byType.questions} (${stats.byStatus.answeredQuestions} answered)`,
      `- Answers: ${stats.byType.answers} (${stats.byStatus.acceptedAnswers} accepted)`,
      `- Notes: ${stats.byType.notes}`,
      `- Health Score: ${healthScore}/100`,
      ``,
      `## Averages`,
      `- Answers per Question: ${stats.averages.answersPerQuestion}`,
      `- Tags per Entry: ${stats.averages.tagsPerEntry}`,
      `- Time to Answer: ${this.formatDuration(stats.averages.timeToAnswer)}`,
      `- Acceptance Rate: ${stats.averages.acceptanceRate}%`,
      ``,
      `## Quality Issues`,
      `- Unanswered High Priority: ${stats.quality.unansweredHighPriority}`,
      `- Stale Questions: ${stats.quality.staleQuestions}`,
      `- Orphaned Answers: ${stats.quality.orphanedAnswers}`,
      `- Duplicate Tags: ${stats.quality.duplicateTags.length}`,
      ``,
      `## Top Tags`,
      ...stats.trends.popularTags.slice(0, 5).map(t => 
        `- ${t.tag}: ${t.count} uses (${t.growth >= 0 ? '+' : ''}${t.growth}% growth)`
      ),
      ``,
      `## Top Contributors`,
      ...stats.trends.topContributors.slice(0, 5).map(c => 
        `- Process ${c.processId}: ${c.count} entries`
      )
    ];
    
    return report.join('\n');
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
    return `${Math.round(ms / 86400000)}d`;
  }
}