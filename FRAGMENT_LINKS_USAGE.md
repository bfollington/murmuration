# Fragment Link Management - Usage Guide

This document provides examples of how to use the new fragment link management tools through the MCP interface.

## Overview

The fragment link system allows you to create semantic relationships between knowledge fragments with the following types:

- **answers**: Source fragment answers the target question fragment
- **references**: Source fragment references target for context or supporting information
- **related**: General relationship without specific semantic meaning
- **supersedes**: Source fragment replaces or updates the target fragment

## Available MCP Tools

### 1. create_fragment_link

Create a bidirectional link between two fragments.

**Parameters:**
- `sourceId` (required): ID of the source fragment
- `targetId` (required): ID of the target fragment
- `linkType` (required): One of 'answers', 'references', 'related', 'supersedes'
- `metadata` (optional): Additional metadata for the link

**Example:**
```json
{
  "name": "create_fragment_link",
  "arguments": {
    "sourceId": "fragment_123",
    "targetId": "fragment_456",
    "linkType": "answers",
    "metadata": {
      "confidence": "high",
      "reviewer": "Claude"
    }
  }
}
```

### 2. get_fragment_links

Get all links for a specific fragment with filtering options.

**Parameters:**
- `fragmentId` (required): Fragment ID to get links for
- `direction` (optional): 'outgoing', 'incoming', or 'both' (default: 'both')
- `linkType` (optional): Filter by specific link type
- `limit` (optional): Maximum number of links to return (default: 50, max: 100)

**Example:**
```json
{
  "name": "get_fragment_links",
  "arguments": {
    "fragmentId": "fragment_123",
    "direction": "outgoing",
    "linkType": "references",
    "limit": 20
  }
}
```

### 3. delete_fragment_link

Delete a specific link between fragments.

**Parameters:**
- `linkId` (required): ID of the link to delete

**Example:**
```json
{
  "name": "delete_fragment_link",
  "arguments": {
    "linkId": "link_abc_def_answers"
  }
}
```

### 4. traverse_fragment_links

Traverse fragment relationships up to N levels deep with cycle detection.

**Parameters:**
- `startId` (required): Starting fragment ID
- `maxDepth` (optional): Maximum traversal depth (default: 3, max: 10)
- `linkTypes` (optional): Array of link types to follow
- `direction` (optional): Direction to traverse ('outgoing', 'incoming', 'both')
- `includeFragments` (optional): Include full fragment details (default: true)

**Example:**
```json
{
  "name": "traverse_fragment_links",
  "arguments": {
    "startId": "fragment_123",
    "maxDepth": 2,
    "linkTypes": ["answers", "references"],
    "direction": "both",
    "includeFragments": true
  }
}
```

### 5. get_fragment_with_links

Get a fragment with all its linked fragments pre-loaded.

**Parameters:**
- `fragmentId` (required): Fragment ID
- `linkDepth` (optional): How many levels of links to load (default: 1, max: 3)

**Example:**
```json
{
  "name": "get_fragment_with_links",
  "arguments": {
    "fragmentId": "fragment_123",
    "linkDepth": 2
  }
}
```

## Common Usage Patterns

### Building a Q&A Knowledge Base

1. Create question fragments:
```json
{
  "name": "record_fragment",
  "arguments": {
    "title": "How does authentication work?",
    "body": "I need to understand the authentication flow in our system.",
    "type": "question",
    "tags": ["auth", "security"]
  }
}
```

2. Create answer fragments:
```json
{
  "name": "record_fragment",
  "arguments": {
    "title": "Authentication Flow Explanation",
    "body": "Our system uses JWT tokens with OAuth2...",
    "type": "answer",
    "tags": ["auth", "security"]
  }
}
```

3. Link the answer to the question:
```json
{
  "name": "create_fragment_link",
  "arguments": {
    "sourceId": "answer_fragment_id",
    "targetId": "question_fragment_id",
    "linkType": "answers"
  }
}
```

### Creating Reference Networks

Link related documentation fragments:
```json
{
  "name": "create_fragment_link",
  "arguments": {
    "sourceId": "detailed_guide_id",
    "targetId": "overview_document_id",
    "linkType": "references",
    "metadata": {
      "section": "implementation details"
    }
  }
}
```

### Managing Knowledge Evolution

When updating information, link new fragments to superseded ones:
```json
{
  "name": "create_fragment_link",
  "arguments": {
    "sourceId": "updated_procedure_id",
    "targetId": "old_procedure_id",
    "linkType": "supersedes",
    "metadata": {
      "reason": "API version update",
      "date": "2024-01-15"
    }
  }
}
```

## Best Practices

1. **Use Descriptive Metadata**: Add context to links with meaningful metadata
2. **Choose Appropriate Link Types**: Use specific types rather than generic "related"
3. **Avoid Deep Hierarchies**: Keep traversal depths reasonable for performance
4. **Regular Cleanup**: Use traversal tools to identify and clean up orphaned links
5. **Consistent Tagging**: Use consistent tags across linked fragments for better discovery

## Performance Considerations

- **Link Traversal**: Deep traversals (>5 levels) may be slow on large knowledge bases
- **Cycle Detection**: The system automatically detects and reports cycles
- **Batch Operations**: For bulk link creation, consider the underlying store operations
- **Search Integration**: Links are automatically considered in similarity searches

## Error Handling

The tools provide clear error messages for common issues:
- Non-existent fragments
- Invalid link types
- Circular reference detection
- Permission or validation errors

All operations are atomic - if an operation fails, no partial changes are made.