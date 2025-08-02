# /suggest - Proactive Project Analysis & Recommendations

## Overview

The suggest process analyzes the project holistically to identify gaps, risks, and opportunities that might not be visible when focused on individual issues. This process should be run periodically to maintain project health and discover high-value improvements.

## Analysis Categories

### 1. Critical Gaps Detection

Look for missing essential functionality by examining:

- **Security patterns**: Authentication, authorization, rate limiting, input validation
- **Error handling**: Unhandled promise rejections, missing try-catch blocks, generic errors
- **Data integrity**: Backup mechanisms, transaction handling, data validation
- **Monitoring**: Logging, metrics, health checks, alerting

Search for evidence using Grep/Glob to verify presence or absence of these patterns.

### 2. Technical Debt Indicators

Identify accumulating problems:

- Files exceeding 500 lines without clear module separation
- Functions longer than 50 lines indicating high complexity
- Accumulation of TODO/FIXME/HACK comments
- Duplicate code patterns across multiple files
- Missing tests for critical functionality
- Outdated dependencies with known issues

### 3. User Experience Opportunities

Find improvements that would delight users:

- **Performance**: Long-running operations without progress feedback
- **Error messages**: Generic or unhelpful error text
- **Defaults**: Suboptimal default configurations
- **Discoverability**: Hidden features that users can't find
- **Workflow**: Multi-step processes that could be simplified

### 4. Integration & Ecosystem Health

Evaluate external connections:

- Missing integrations with popular tools in the domain
- Incomplete API coverage
- Lack of webhook/event support
- Missing export/import capabilities
- Poor interoperability with standard formats

## Suggestion Process

### Step 1: Gather Context

Start by understanding the current project state:

1. **Review issue patterns**:
   - Check for stale high-priority issues (open > 30 days)
   - Look for recurring bug reports indicating systemic problems
   - Identify feature requests hidden in questions/notes

2. **Analyze codebase health**:
   - Search for TODO/FIXME/HACK comments
   - Find large files that need splitting
   - Check test coverage gaps
   - Look for error handling patterns

3. **Examine user feedback**:
   - Unanswered questions indicating missing features
   - Completed issues that spawned new problems
   - Notes about workarounds or pain points

### Step 2: Pattern Recognition

Identify concerning patterns:

- **Stale work**: High-priority issues sitting untouched
- **Recurring failures**: Same type of bug appearing multiple times
- **Missing basics**: No auth, no rate limiting, no validation
- **Poor UX**: Generic errors, no progress indicators, bad defaults
- **Tech debt**: Growing file sizes, increasing complexity, test gaps

### Step 3: Generate Recommendations

Present findings with clear evidence:

```markdown
## 🚨 Critical Suggestions

### 1. Security: Missing Rate Limiting
**Evidence**: No rate limiting found in WebSocket server (src/web/server.ts)
**Risk**: DoS vulnerability through connection flooding
**Effort**: ~2 hours
**Suggestion**: Add connection rate limiting with configurable thresholds

### 2. Reliability: No Graceful Shutdown
**Evidence**: Process manager kills without cleanup (src/process/manager.ts:234)
**Impact**: Data loss on server restart
**Effort**: ~3 hours
**Suggestion**: Implement shutdown handlers with timeout

## 💡 Improvement Opportunities

### 1. Developer Experience: Better Error Messages
**Evidence**: 15 generic "Error occurred" messages found
**Example**: src/mcp/server.ts:145 throws "Error" with no context
**Impact**: Harder debugging for users
**Quick win**: Add context to each error (30 min each)

### 2. Performance: Cache Frequently Read Files
**Evidence**: knowledge-state.json read on every query (10+ times/min)
**Impact**: Unnecessary disk I/O
**Effort**: ~1 hour
**Suggestion**: Add in-memory cache with file watcher

## 🎯 Delightful Additions

### 1. CLI Autocomplete
**Observation**: Complex command structure would benefit from completion
**User impact**: Faster command entry, fewer errors
**Implementation**: Generate completion scripts from MCP schema

### 2. Web UI Search
**Current state**: List views with no filtering (web/index.html)
**User need**: Find specific processes/issues quickly
**Effort**: ~2 hours for basic search
```

### Step 4: Priority Matrix

Rank suggestions by impact vs effort:

```
High Impact, Low Effort (DO FIRST):
├── Add error context (2h, prevents support issues)
├── Fix graceful shutdown (3h, prevents data loss)
└── Add basic search (2h, major UX improvement)

High Impact, High Effort (PLAN):
├── Implement full auth system (2d, security)
└── Add comprehensive testing (1w, reliability)

Low Impact, Low Effort (QUICK WINS):
├── Add CLI colors (30m, developer joy)
└── Improve log formatting (1h, debugging)

Low Impact, High Effort (DEFER):
└── Refactor to microservices (2w, architecture)
```

## Interactive Review Process

When running suggest, engage the user with findings:

```
🔍 Project Analysis Complete

Found 3 critical issues, 5 improvements, 2 delight opportunities

🚨 CRITICAL: Missing Authentication
Evidence: 
- No auth found in src/web/server.ts:89
- WebSocket accepts any connection
Risk: High - Anyone can control processes
Effort: ~4 hours
Recommendation: Add JWT validation to WebSocket upgrade

Create issue for this? (y/n/skip): _
```

For each accepted suggestion, create a concise issue:

```markdown
Title: Add WebSocket authentication

## Evidence
- No auth check at src/web/server.ts:89
- Any client can connect and control processes

## Questions
- Use JWT or session tokens?
- Store tokens in memory or Redis?

## Tasks
- [ ] Add auth middleware to WebSocket upgrade
- [ ] Validate tokens on connection
- [ ] Reject invalid tokens with 401
```

## Anti-Patterns

1. **Over-Suggesting** - Don't overwhelm with 50 suggestions
2. **Vague Problems** - Always include specific evidence
3. **Solution Bias** - Present problems, not just your preferred solution
4. **Ignoring Context** - Consider current priorities and resources
5. **Feature Creep** - Don't suggest features without user evidence

## When to Run Suggest

- **Before milestone planning** - Identify what really needs attention
- **After major releases** - Find what was missed or broken
- **Weekly/bi-weekly** - Catch issues early
- **When feeling stuck** - Discover new high-value work

## Success Metrics

A good suggest run:
- Identifies 3-7 high-value improvements
- Provides specific evidence for each
- Estimates realistic effort
- Catches critical issues before users do
- Suggests delightful improvements users didn't know they wanted

Remember: The goal is to surface non-obvious improvements that significantly impact project quality, security, or user experience.