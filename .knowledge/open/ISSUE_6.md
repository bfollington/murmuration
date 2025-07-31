---
id: ISSUE_6
type: issue
status: open
timestamp: '2025-07-31T06:21:30.000Z'
lastUpdated: '2025-07-31T06:21:30.000Z'
tags:
  - performance
  - optimization
  - future
priority: low
---

# Optimize file-based operations for scale

Optimize the file-based system for handling 1000+ entries efficiently:

- Implement caching layer for frequently accessed files
- Add indexing for faster searches (maybe SQLite for metadata?)
- Batch file operations where possible
- Consider async file watching with debouncing
- Profile and optimize hot paths

This can be done later once we have real usage patterns. The current implementation should handle hundreds of files fine.

Related to [[ISSUE_4]] - do performance testing first to identify bottlenecks.