---
id: ISSUE_18
type: issue
status: open
timestamp: '2025-07-31T10:03:10.898Z'
lastUpdated: '2025-07-31T10:03:10.898Z'
tags:
  - enhancement
  - process-management
  - multi-instance
  - isolation
title: Add instance isolation for process management
priority: high
---

# Add instance isolation for process management

# Add instance isolation for process management

## Problem
Multiple Murmuration instances share the same process management state and queue files, leading to:
- Process visibility conflicts (instances see each other's processes)
- Queue state corruption when multiple instances modify `queue-state.json`
- Potential race conditions in process management operations

## Solution
Implement instance isolation so each Murmuration instance manages its own processes and queue independently.

## Implementation Plan

1. **Add instance ID generation:**
   ```typescript
   // Generate unique instance ID on startup
   const instanceId = `murmur-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
   // Or use port number: `murmur-port-${actualPort}`
   ```

2. **Isolate queue state files:**
   - Change from: `queue-state.json`
   - Change to: `queue-state-${instanceId}.json`
   - Or use subdirectories: `.murmur/${instanceId}/queue-state.json`

3. **Tag processes with instance ID:**
   - Add `instanceId` field to `ProcessEntry`
   - Filter `list_processes` to only show current instance's processes
   - Prevent cross-instance process management

4. **Update process management:**
   ```typescript
   // In ProcessManager
   listProcesses(filter?: ProcessFilter): ProcessEntry[] {
     return this.processes.filter(p => 
       p.instanceId === this.instanceId && matchesFilter(p, filter)
     );
   }
   ```

5. **Configuration options:**
   - Add `--instance-id` CLI flag for explicit naming
   - Add `--shared-processes` flag to see all instances (read-only)
   - Environment variable `MURMUR_INSTANCE_ID` for scripting

6. **Cleanup on shutdown:**
   - Remove instance-specific queue state files
   - Gracefully handle orphaned files from crashed instances

## Code References
- Queue state persistence: `src/queue/manager.ts:29-30`
- Process manager: `src/process/manager.ts`
- Process list filtering: `src/process/manager.ts:listProcesses()`

## Benefits
- Multiple instances can run independently
- No process management conflicts
- Each instance has its own queue
- Cleaner testing and development

## Considerations
- Migration path for existing `queue-state.json`
- Documentation for multi-instance deployment
- Monitoring tools may need updates to aggregate across instances

## Success Criteria
- Multiple instances can manage processes independently
- No queue state corruption with concurrent instances
- Process operations only affect the originating instance
- Clear instance identification in logs and UI

Related to [[ISSUE_17]] - Works in conjunction with automatic port discovery