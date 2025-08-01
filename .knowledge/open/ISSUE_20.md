---
id: ISSUE_20
type: issue
status: open
timestamp: '2025-08-01T06:48:39.723Z'
lastUpdated: '2025-08-01T06:48:39.723Z'
tags:
  - enhancement
  - process-management
  - logs
  - storage
title: Add persistent disk storage for process logs
priority: medium
---

# Add persistent disk storage for process logs

# Add persistent disk storage for process logs

## Problem
Currently, process output/logs are only stored in memory as part of the ProcessEntry. This limits:
- Ability to search logs with external tools (grep, etc.)
- Access to logs after server restart
- Integration with other tools that expect file-based logs
- Human-readable access for copying/reviewing logs

## Solution
Store process logs on disk in addition to keeping them in memory for fast MCP access.

## Implementation Plan

1. **Create logs directory structure:**
   ```
   .murmur/
   └── logs/
       └── processes/
           └── {process-id}/
               ├── stdout.log
               ├── stderr.log
               └── combined.log
   ```

2. **Update ProcessManager to write logs:**
   - Create log directory when process starts
   - Stream stdout/stderr to respective files
   - Also write to combined.log for easy access
   - Continue storing in memory for MCP tools

3. **Log rotation/cleanup strategy:**
   - Keep logs for completed processes for X hours/days
   - Add max size limits per log file
   - Rotate logs if they get too large
   - Clean up on process removal

4. **Integration points:**
   - Update `startProcess()` to create log directories
   - Modify log capture to write to both memory and disk
   - Add cleanup in `stopProcess()` based on retention policy

5. **Configuration:**
   - Add config for log retention period
   - Option to disable disk logging if needed
   - Configurable log directory path

## Benefits
- Persistent logs survive server restarts
- Easy searching with grep/ripgrep
- Can tail -f logs in real-time
- Better debugging capabilities
- Integration with log analysis tools

## Considerations
- Ensure .murmur/logs is in .gitignore
- Handle disk space constraints
- Async writes to avoid blocking
- File permissions for log access

## Success Criteria
- Process logs are written to disk in real-time
- Logs are organized by process ID
- Memory and disk logs stay in sync
- Old logs are cleaned up automatically
- No performance degradation