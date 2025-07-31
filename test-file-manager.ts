import { FileKnowledgeManager } from './src/knowledge/file-manager.ts';

const manager = new FileKnowledgeManager();

try {
  // Create a question
  const question = await manager.createQuestion({
    content: 'How do I implement file-based storage?',
    tags: ['storage', 'files'],
    priority: 'high'
  });
  console.log('Question created:', question);
  
  if (!question.success) {
    console.error('Failed to create question:', question.error);
    Deno.exit(1);
  }

  // Create an answer
  const answer = await manager.createAnswer({
    content: 'Use markdown files with YAML frontmatter for structured storage.',
    questionId: question.data!.id,
    tags: ['storage', 'markdown']
  });
  console.log('Answer created:', answer);

  // Create a note
  const note = await manager.createNote({
    content: 'File-based storage provides human-readable format and easy versioning.',
    category: 'observation',
    tags: ['storage', 'design']
  });
  console.log('Note created:', note);

  console.log('\nFiles should be created in .knowledge directory structure');
} catch (error) {
  console.error('Error:', error);
}