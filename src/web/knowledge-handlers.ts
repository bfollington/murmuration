import { WebSocketConnection } from './types.ts';
import { FileKnowledgeManager } from '../knowledge/file-manager.ts';
import { logger } from '../shared/logger.ts';

/**
 * WebSocket message handlers for knowledge management
 * 
 * Handles all knowledge-related operations including questions, answers, notes, and issues.
 */
export class KnowledgeWebSocketHandlers {
  constructor(private knowledgeManager: FileKnowledgeManager) {}

  /**
   * Handle knowledge list request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleListKnowledge(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const query = data as { limit?: number; type?: string; search?: string };
      const allEntries = await this.knowledgeManager.searchEntries({
        type: query.type as any,
        search: query.search,
      });
      
      // Apply limit if specified
      const entries = query.limit ? allEntries.slice(0, query.limit) : allEntries;
      
      // Send response through connection manager
      await connection.socket.send(JSON.stringify({
        type: 'knowledge_list',
        data: { entries },
      }));
      
      logger.debug('KnowledgeWebSocketHandlers', `Sent ${entries.length} knowledge entries to ${connection.sessionId}`);
    } catch (error) {
      logger.error('KnowledgeWebSocketHandlers', 'Error handling list knowledge', error);
      await connection.socket.send(JSON.stringify({
        type: 'error',
        data: {
          code: 'KNOWLEDGE_QUERY_ERROR',
          message: error instanceof Error ? error.message : 'Failed to query knowledge',
        },
      }));
    }
  }

  /**
   * Handle create question request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleCreateQuestion(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const result = await this.knowledgeManager.createQuestion(data as any);
      if (result.success && result.data) {
        await connection.socket.send(JSON.stringify({
          type: 'knowledge_created',
          data: { entry: result.data },
        }));
        logger.debug('KnowledgeWebSocketHandlers', `Created question ${result.data.id}`);
      } else {
        await connection.socket.send(JSON.stringify({
          type: 'error',
          data: {
            code: 'CREATE_QUESTION_ERROR',
            message: result.error || 'Failed to create question',
          },
        }));
      }
    } catch (error) {
      logger.error('KnowledgeWebSocketHandlers', 'Error creating question', error);
      await connection.socket.send(JSON.stringify({
        type: 'error',
        data: {
          code: 'CREATE_QUESTION_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create question',
        },
      }));
    }
  }

  /**
   * Handle create answer request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleCreateAnswer(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const result = await this.knowledgeManager.createAnswer(data as any);
      if (result.success && result.data) {
        await connection.socket.send(JSON.stringify({
          type: 'knowledge_created',
          data: { entry: result.data },
        }));
        logger.debug('KnowledgeWebSocketHandlers', `Created answer ${result.data.id}`);
      } else {
        await connection.socket.send(JSON.stringify({
          type: 'error',
          data: {
            code: 'CREATE_ANSWER_ERROR',
            message: result.error || 'Failed to create answer',
          },
        }));
      }
    } catch (error) {
      logger.error('KnowledgeWebSocketHandlers', 'Error creating answer', error);
      await connection.socket.send(JSON.stringify({
        type: 'error',
        data: {
          code: 'CREATE_ANSWER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create answer',
        },
      }));
    }
  }

  /**
   * Handle create note request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleCreateNote(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const result = await this.knowledgeManager.createNote(data as any);
      if (result.success && result.data) {
        await connection.socket.send(JSON.stringify({
          type: 'knowledge_created',
          data: { entry: result.data },
        }));
        logger.debug('KnowledgeWebSocketHandlers', `Created note ${result.data.id}`);
      } else {
        await connection.socket.send(JSON.stringify({
          type: 'error',
          data: {
            code: 'CREATE_NOTE_ERROR',
            message: result.error || 'Failed to create note',
          },
        }));
      }
    } catch (error) {
      logger.error('KnowledgeWebSocketHandlers', 'Error creating note', error);
      await connection.socket.send(JSON.stringify({
        type: 'error',
        data: {
          code: 'CREATE_NOTE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create note',
        },
      }));
    }
  }

  /**
   * Handle create issue request
   * @param connection WebSocket connection
   * @param data Request data
   */
  async handleCreateIssue(connection: WebSocketConnection, data: unknown): Promise<void> {
    try {
      const result = await this.knowledgeManager.createIssue(data as any);
      if (result.success && result.data) {
        await connection.socket.send(JSON.stringify({
          type: 'knowledge_created',
          data: { entry: result.data },
        }));
        logger.debug('KnowledgeWebSocketHandlers', `Created issue ${result.data.id}`);
      } else {
        await connection.socket.send(JSON.stringify({
          type: 'error',
          data: {
            code: 'CREATE_ISSUE_ERROR',
            message: result.error || 'Failed to create issue',
          },
        }));
      }
    } catch (error) {
      logger.error('KnowledgeWebSocketHandlers', 'Error creating issue', error);
      await connection.socket.send(JSON.stringify({
        type: 'error',
        data: {
          code: 'CREATE_ISSUE_ERROR',
          message: error instanceof Error ? error.message : 'Failed to create issue',
        },
      }));
    }
  }

  /**
   * Handle get knowledge statistics request
   * @param connection WebSocket connection
   */
  async handleGetKnowledgeStats(connection: WebSocketConnection): Promise<void> {
    try {
      const stats = await this.knowledgeManager.getStatistics();
      await connection.socket.send(JSON.stringify({
        type: 'knowledge_stats',
        data: stats,
      }));
      logger.debug('KnowledgeWebSocketHandlers', `Sent knowledge stats to ${connection.sessionId}`);
    } catch (error) {
      logger.error('KnowledgeWebSocketHandlers', 'Error getting knowledge stats', error);
      await connection.socket.send(JSON.stringify({
        type: 'error',
        data: {
          code: 'KNOWLEDGE_STATS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get knowledge statistics',
        },
      }));
    }
  }
}