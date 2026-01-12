# Code Review Feature Spec

## Overview

Automated code review for session diffs, powered by Claude. Reviews are generated during upload (opt-in) and rendered inline with diffs using `@pierre/diffs` annotation support.

## Goals

1. Provide meaningful, automated code review for diffs created during Claude Code sessions
2. Help reviewers quickly understand code quality, potential issues, and improvements
3. Integrate seamlessly with existing diff visualization

## Non-Goals

- Human-authored comments (future Phase 3)
- Editing or deleting reviews after creation
- Real-time/streaming review updates

---

## User Experience

### Upload Flow

```
archive upload --review [session.jsonl] [diff.patch]
```

When `--review` flag is present:
1. CLI parses session and diff data
2. CLI invokes local Claude agent to review session-relevant diffs
3. CLI posts session + diff + review data to server
4. Server stores all data atomically

Without `--review`, sessions upload without review data (existing behavior).

### Viewing Reviews

**Session detail page shows:**

1. **Review summary** at the top of the diff panel
   - Overall assessment of the changes
   - Key observations (2-3 bullets)
   - Displayed in a distinct card/banner

2. **Inline annotations** on session-relevant diffs
   - Default: expanded inline below the annotated line (GitHub PR style)
   - Toggle: collapse to gutter markers, click to expand
   - Color-coded by type (suggestion, issue, praise, question)

**Sessions without reviews:**
- Show a subtle prompt: "Generate a code review for this session"
- Link to CLI command or future "Generate Review" feature

---

## Data Model

### New Tables

```sql
-- One review per session (optional)
CREATE TABLE reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,           -- Markdown summary
  model TEXT,                      -- Model used for review (e.g., "claude-sonnet-4-20250514")
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Line-level annotations
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  diff_id INTEGER NOT NULL,        -- Which diff file
  line_number INTEGER NOT NULL,    -- Line in the NEW file (additions side)
  side TEXT NOT NULL DEFAULT 'additions',  -- 'additions' or 'deletions'
  annotation_type TEXT NOT NULL,   -- 'suggestion', 'issue', 'praise', 'question'
  content TEXT NOT NULL,           -- Markdown content
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (diff_id) REFERENCES diffs(id) ON DELETE CASCADE
);

CREATE INDEX idx_annotations_diff ON annotations(diff_id);
CREATE INDEX idx_annotations_review ON annotations(review_id);
```

### TypeScript Types

```typescript
type AnnotationType = 'suggestion' | 'issue' | 'praise' | 'question';

interface Review {
  id: number;
  session_id: string;
  summary: string;
  model: string | null;
  created_at: string;
}

interface Annotation {
  id: number;
  review_id: number;
  diff_id: number;
  line_number: number;
  side: 'additions' | 'deletions';
  annotation_type: AnnotationType;
  content: string;
}

// For API responses
interface ReviewWithAnnotations extends Review {
  annotations: Annotation[];
}

// For diff rendering (matches @pierre/diffs)
interface DiffAnnotation {
  side: 'additions' | 'deletions';
  lineNumber: number;
  metadata: {
    id: number;
    type: AnnotationType;
    content: string;
  };
}
```

---

## API Changes

### Create Session (Updated)

```
POST /api/sessions (multipart/form-data)
```

**New optional fields:**
- `review_summary`: Markdown text for overall review
- `review_model`: Model identifier used for review
- `annotations`: JSON array of annotation objects

```typescript
interface AnnotationInput {
  filename: string;      // Matched against diff filenames
  line_number: number;
  side: 'additions' | 'deletions';
  annotation_type: AnnotationType;
  content: string;
}
```

**Processing:**
1. Parse session and diff data (existing)
2. If review data present:
   - Create review record
   - Match annotations to diff records by filename
   - Insert annotation records
3. Return session with review included

### Get Session (Updated)

```
GET /api/sessions/:id
```

**Response additions:**
```typescript
{
  // ... existing fields
  review?: {
    id: number;
    summary: string;
    model: string | null;
    created_at: string;
    annotation_count: number;
  }
}
```

### Get Annotations

```
GET /api/sessions/:id/annotations
```

**Response:**
```typescript
{
  review: Review;
  annotations_by_diff: Record<number, Annotation[]>;  // Keyed by diff_id
}
```

---

## CLI Integration

### Review Generation

The CLI generates reviews by:
1. Filtering to session-relevant diffs (`is_session_relevant = true`)
2. Building context from conversation + diffs
3. Calling Claude with a review prompt
4. Parsing structured output

**Prompt structure (conceptual):**

```
You are reviewing code changes made during a Claude Code session.

<session_context>
{conversation summary or key tool calls}
</session_context>

<diffs>
{session-relevant diffs with filenames and line numbers}
</diffs>

Provide:
1. A brief summary (2-4 sentences) of the overall changes
2. Line-level annotations where relevant

For annotations, output JSON:
{
  "summary": "...",
  "annotations": [
    {
      "filename": "src/foo.ts",
      "line_number": 42,
      "side": "additions",
      "type": "suggestion",
      "content": "Consider using a constant here..."
    }
  ]
}

Annotation types:
- suggestion: Improvement ideas
- issue: Potential bugs or problems
- praise: Good patterns worth noting
- question: Clarification needed
```

### Upload Command

```bash
# With review
archive upload --review session.jsonl diff.patch

# Without review (existing)
archive upload session.jsonl diff.patch
```

---

## Frontend Rendering

### @pierre/diffs Integration

The library supports annotations natively:

```typescript
import { FileDiff, DiffLineAnnotation } from '@pierre/diffs';

// Transform stored annotations to library format
function toDiffAnnotations(annotations: Annotation[]): DiffLineAnnotation<AnnotationMetadata>[] {
  return annotations.map(a => ({
    side: a.side,
    lineNumber: a.line_number,
    metadata: {
      id: a.id,
      type: a.annotation_type,
      content: a.content,
    },
  }));
}

// Render diff with annotations
const fileDiff = new FileDiff({
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  diffStyle: 'unified',
  renderAnnotation: (annotation) => {
    return createAnnotationElement(annotation.metadata);
  },
});

fileDiff.render({
  fileDiff: parsedDiff,
  lineAnnotations: toDiffAnnotations(annotations),
});
```

### Annotation Component

```typescript
function createAnnotationElement(metadata: AnnotationMetadata): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `annotation annotation--${metadata.type}`;

  const icon = document.createElement('span');
  icon.className = 'annotation__icon';
  icon.textContent = iconForType(metadata.type);

  const content = document.createElement('div');
  content.className = 'annotation__content';
  content.innerHTML = renderMarkdown(metadata.content);

  wrapper.appendChild(icon);
  wrapper.appendChild(content);
  return wrapper;
}

function iconForType(type: AnnotationType): string {
  switch (type) {
    case 'suggestion': return '💡';
    case 'issue': return '⚠️';
    case 'praise': return '✓';
    case 'question': return '?';
  }
}
```

### Styling

```css
.annotation {
  padding: 8px 12px;
  margin: 4px 0;
  border-radius: 4px;
  font-size: 13px;
  border-left: 3px solid;
}

.annotation--suggestion {
  background: var(--color-suggestion-bg);
  border-color: var(--color-suggestion);
}

.annotation--issue {
  background: var(--color-issue-bg);
  border-color: var(--color-issue);
}

.annotation--praise {
  background: var(--color-praise-bg);
  border-color: var(--color-praise);
}

.annotation--question {
  background: var(--color-question-bg);
  border-color: var(--color-question);
}
```

### Collapsed Mode

When annotations are collapsed:
- Show colored dot/icon in gutter
- Click to expand that annotation inline
- "Expand all" / "Collapse all" toggle in diff header

---

## Review Summary UI

At the top of the diff panel (before file list):

```
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 Code Review                                    claude-sonnet │
├─────────────────────────────────────────────────────────────────┤
│ This session adds a new authentication middleware with JWT      │
│ token validation. The implementation follows security best      │
│ practices, though there are a few areas to consider:            │
│                                                                 │
│ • Token expiry handling could be more graceful                  │
│ • Consider adding rate limiting to the auth endpoints           │
│                                                                 │
│ 3 suggestions · 1 issue · 2 praise                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Data Model & Storage
1. Add `reviews` and `annotations` tables
2. Update repository with CRUD operations
3. Extend session API to accept review data
4. Extend session API to return review data

### Phase 2: Basic Rendering
1. Display review summary in diff panel header
2. Integrate with @pierre/diffs for inline annotations
3. Style annotation components

### Phase 3: CLI Integration
1. Add `--review` flag to upload command
2. Implement review prompt and parsing
3. Format and send review data with upload

### Phase 4: Polish
1. Collapsed annotation mode
2. Annotation counts in file headers
3. "No review" prompt for sessions without reviews
4. Filter/highlight by annotation type

---

## Future Considerations

- **Human comments** (Phase 3 of north star): Allow viewers to add their own annotations
- **Review regeneration**: Re-run review with different model/prompt
- **Review diffs**: Compare reviews from different models
- **Severity levels**: Add severity to issues (info/warning/error)
- **Code suggestions**: Structured code replacement suggestions (like GitHub Copilot)

---

## Open Questions

1. **Line number stability**: If diffs are reformatted/normalized, do line numbers remain stable?
2. **Annotation anchoring**: Should we store surrounding context to re-anchor if lines shift?
3. **Review quality**: What makes a good review prompt? Need iteration.
4. **Cost visibility**: Should we show token usage / cost for review generation?
