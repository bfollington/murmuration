# /backlog - Agile Backlog Review Process

## Overview

The backlog review process is a systematic approach to maintaining issue quality, ensuring alignment with project goals, and preventing wasted effort on unnecessary or misguided features. This process should be run regularly to keep the issue tracker healthy and actionable.

## Process Steps

### 1. Issue Discovery & Assessment

```bash
# Start by getting a comprehensive view of all open issues
mcp.list_issues({ status: "open", limit: 100 })

# Check in-progress work to understand current focus
mcp.list_issues({ status: "in-progress" })

# Review recently completed issues for context
mcp.list_issues({ status: "completed", limit: 10 })
```

For each issue, assess:
- Is the description clear enough for implementation?
- Are there unanswered questions that would block progress?
- Has recent work made this issue obsolete or changed its priority?

### 2. Knowledge Integration

Before making decisions, gather recent learnings:

```bash
# Check recent notes that might impact priorities
mcp.list_notes({ limit: 20 })

# Review answered questions for insights
mcp.list_questions_and_answers({ answered: true, limit: 20 })

# Look for troubleshooting notes that reveal constraints
mcp.list_notes({ category: "troubleshooting" })
```

### 3. Interactive Clarification Process

For each ambiguous or unclear issue, engage the user with precise questions:

#### Question Templates:

**For Feature Requests:**
```
"Looking at ISSUE_XXX: [title]

Current facts from issue:
- [Listed evidence/context]
- [File references with line numbers]

Unanswered questions from issue:
1. [Specific question needing answer]
2. [Another concrete question]

Based on codebase evidence:
- Found existing pattern at src/file.ts:123
- Similar feature implemented in src/other.ts:456

What's the minimum scope that provides value?"
```

**For Bug Reports:**
```
"Reviewing ISSUE_XXX: [title]

Evidence from issue:
- [Specific error message/behavior]
- [Steps to reproduce if known]
- [Affected code locations]

Missing information:
1. [What specific data needed]
2. [What measurements required]

From codebase:
- Related code at src/file.ts:789
- Error handling pattern at src/error.ts:45

Need to confirm root cause or investigate further?"
```

**For Technical Debt:**
```
"Evaluating ISSUE_XXX: [title]

Technical debt assessment:
1. What's the current pain this causes during development?
2. How often do we encounter this friction?
3. What's the effort estimate vs. long-term time savings?
4. Are there dependencies on other work?

Recent implementation experience suggests:
- [relevant notes about similar refactoring]

Should we tackle this now, defer it, or break it into smaller pieces?"
```

### 4. Issue Refinement Actions

Based on discussions, take appropriate actions:

```typescript
// Update with concrete findings only
await mcp.update_issue({
  issue_id: "ISSUE_123",
  content: originalContent + `\n\n## Backlog Review Updates\n\n### Answered Questions\n- Q: Which auth method? A: JWT (decided by team)\n- Q: Performance impact? A: <100ms based on tests\n\n### New Evidence\n- Found similar implementation in src/auth/jwt.ts\n- Measured current response time: 50ms avg\n\n### Updated Subtasks\n- [ ] Reuse JWT validation from src/auth/jwt.ts\n- [ ] Add performance test to maintain <100ms`
});

// Adjust priorities based on new information
await mcp.update_issue({
  issue_id: "ISSUE_124",
  priority: "high", // was medium
  content: content + "\n\n**Priority increased due to: " + reasoning + "**"
});

// Close obsolete issues
await mcp.update_issue({
  issue_id: "ISSUE_125",
  status: "archived",
  content: content + "\n\n## Archived Reason\n\n" + obsoleteReason
});

// Split with concrete scope
const newIssue = await mcp.record_issue({
  title: "Part 1: Add JWT validation to WebSocket",
  content: `Split from ISSUE_126\n\n## Scope\n- Add JWT validation using existing src/auth/jwt.ts\n- Reject invalid tokens with 401\n\n## Known tasks\n- [ ] Import validateJWT from src/auth/jwt.ts\n- [ ] Add to WebSocket upgrade handler\n- [ ] Return 401 on invalid token\n\n## Out of scope\n- Token refresh (tracked in ISSUE_127)\n- Multiple auth methods (future work)`,
  priority: "high",
  tags: [...originalTags, "split-issue"]
});
```

### 5. Goal Setting Process

After reviewing all issues, facilitate goal setting:

```
"Based on our backlog review, here's the current state:

High Priority & Clear:
- ISSUE_XXX: [title] - Ready for implementation
- ISSUE_YYY: [title] - Ready after small clarification

Needs Discussion:
- ISSUE_ZZZ: [title] - Unclear value proposition
- ISSUE_AAA: [title] - Multiple possible approaches

Recent Insights:
- [Key learning that affects priorities]
- [Technical constraint discovered]

For our next sprint/milestone, I recommend focusing on [suggestion] because [reasoning].

Questions for goal setting:
1. What's the most important outcome for users in the next iteration?
2. Are there any external deadlines or dependencies?
3. Should we prioritize stability (bugs) or new capabilities (features)?
4. What's our risk tolerance for tackling complex issues?

What would you like to accomplish?"
```

### 6. Milestone Update

Once goals are agreed upon:

```typescript
// Update the milestone with new focus
await mcp.set_milestone({
  title: "Sprint X: " + agreedFocus,
  description: "Goals:\n" + bulletedGoals + "\n\nKey Issues:\n" + prioritizedIssues,
  targetDate: targetDate,
  relatedIssues: selectedIssueIds,
  progress: 0
});

// Tag issues for the milestone
for (const issueId of selectedIssueIds) {
  await mcp.update_issue({
    issue_id: issueId,
    tags: [...existingTags, "current-sprint"]
  });
}
```

## Best Practices

### 1. Regular Cadence
- Run backlog review weekly or bi-weekly
- More frequent for active projects
- Always run before starting major work

### 2. Question Quality
- Ask "why" before "how"
- Challenge assumptions explicitly
- Propose alternatives when unclear

### 3. Documentation Trail
- Record all clarifications in issues
- Note why priorities changed
- Link related discoveries

### 4. Prevent Waste
- Close issues early if value unclear
- Merge duplicate efforts
- Challenge feature requests with user evidence

### 5. Learning Integration
- Reference recent implementation experiences
- Cite specific technical constraints discovered
- Use past estimates to inform future ones

## Example Backlog Review Session

```typescript
// 1. Start with overview
const openIssues = await mcp.list_issues({ status: "open" });
console.log(`Found ${openIssues.length} open issues to review`);

// 2. Group by clarity and priority
const unclear = [];
const ready = [];
const questionable = [];

for (const issue of openIssues) {
  const details = await mcp.get_issue({ issue_id: issue.id });
  // Analyze and categorize...
}

// 3. Address unclear issues first
for (const issue of unclear) {
  // Present clarification questions to user
  // Update issue with responses
}

// 4. Challenge questionable value
for (const issue of questionable) {
  // Discuss alternatives and real need
  // Close or reframe as needed
}

// 5. Set sprint goal
// Interactive discussion with user
// Create focused milestone

// 6. Document decisions
await mcp.record_note({
  category: "planning",
  content: "Backlog Review " + date + "\n\nDecisions:\n" + decisions,
  tags: ["backlog-review", "planning"]
});
```

## Anti-Patterns to Avoid

1. **Rubber Stamping** - Don't just organize, actively question
2. **Feature Creep** - Challenge scope expansion
3. **Unclear Acceptance** - Every issue needs clear success criteria
4. **Priority Everything** - Force hard choices
5. **Solutionism** - Ensure problem exists before solving
6. **Speculation** - Don't write essays about what might be wrong
7. **Vague Tasks** - Replace "investigate X" with specific questions
8. **Missing Evidence** - Always include file paths and line numbers

## Outcome

A successful backlog review produces:
- Clear, implementable issues
- Aligned priorities with user needs
- Documented rationale for decisions
- Focused goal for next iteration
- Prevented wasted effort on wrong solutions

Remember: The goal is not to do everything, but to do the right things well.