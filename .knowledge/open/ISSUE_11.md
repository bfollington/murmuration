---
id: ISSUE_11
type: issue
status: open
timestamp: '2025-07-31T07:38:19.571Z'
lastUpdated: '2025-07-31T07:38:19.571Z'
tags:
  - bug
  - queue
  - statistics
title: Fix negative pending count in queue statistics
priority: high
---

# Fix negative pending count in queue statistics

# Fix negative pending count in queue statistics

## Bug Description
The queue statistics are showing `-1 pending` which is mathematically impossible. This appears to be a calculation error in the queue status reporting.

## Observed Behavior
When calling `get_queue_status`, the response shows:
```json
{
  "statistics": {
    "totalQueued": 0,
    "pending": -1,
    "processing": 0,
    "completed": 1,
    ...
  }
}
```

## Expected Behavior
The pending count should never be negative. It should be 0 or a positive integer.

## Likely Cause
The pending count calculation in the queue manager is probably subtracting completed/processing items incorrectly from the total, resulting in a negative value when the queue is empty.

## Reproduction Steps
1. Run a process through the queue
2. Wait for it to complete
3. Call `get_queue_status`
4. Observe negative pending count

## Fix Suggestion
Check the pending calculation logic in the queue manager. It should use `Math.max(0, calculation)` to prevent negative values.