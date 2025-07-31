---
id: ISSUE_10
type: issue
status: completed
timestamp: '2025-07-31T06:43:23.119Z'
lastUpdated: '2025-07-31T07:04:21.818Z'
tags:
  - enhancement
  - mcp
  - api
  - tooling
title: Add get_issue MCP tool to retrieve issues by ID
priority: medium
---

# Add get_issue MCP tool to retrieve issues by ID

# Add get_issue MCP tool to retrieve issues by ID

The MCP server is missing a `get_issue` tool that would allow retrieving a specific issue by its ID. 

Currently we have:
- record_issue - Create new issues
- list_issues - List issues with filtering
- update_issue - Update existing issues  
- delete_issue - Delete issues

But no way to fetch a single issue by ID, which is a common operation needed when:
- Viewing full details of a specific issue
- Following up on a previously created issue
- Checking the current status of a known issue ID
- Building issue relationships and cross-references

The FileKnowledgeManager already has a `getEntry(id: string)` method that can retrieve any knowledge entry by ID, so the implementation would be straightforward:

1. Add the tool definition in the MCP server's tool list
2. Create a `handleGetIssue` method that validates the issue_id parameter
3. Call `knowledgeManager.getEntry(issue_id)` 
4. Verify it's an issue type (not a question/answer/note)
5. Format and return the issue details

This would make the issue management API complete with full CRUD operations.

## Implementation Complete ✅

The `get_issue` tool has been successfully implemented:

- **Tool Definition**: Added to MCP server tools list at line 773
- **Switch Route**: Added case for 'get_issue' at line 841  
- **Handler Method**: Implemented `handleGetIssue` at line 2792
- **Import**: Added `isIssue` type guard to imports
- **Validation**: Proper argument validation and type checking
- **Error Handling**: Comprehensive error cases with appropriate McpError codes
- **Response Format**: Consistent with other issue handlers (summary + JSON details)

The implementation follows all established patterns and integrates seamlessly with the existing MCP architecture.