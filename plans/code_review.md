# Code Review Feature Implementation Plan

**Spec:** `specs/code_review.md`

## Summary

Add storage and rendering for Claude code reviews. This plan covers the data model and frontend rendering. CLI integration (`--review` flag) is deferred to a separate plan.

**Scope:** Phases 1-2 only (Data Model + Rendering)

---

## Phase 1: Data Model & Storage

### 1.1 Add tables and types (`src/db/schema.ts`)

Add after existing table creation (~line 45):

```sql
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER NOT NULL,
  diff_id INTEGER NOT NULL,
  line_number INTEGER NOT NULL,
  side TEXT NOT NULL DEFAULT 'additions',
  annotation_type TEXT NOT NULL,
  content TEXT NOT NULL,
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (diff_id) REFERENCES diffs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_annotations_diff ON annotations(diff_id);
CREATE INDEX IF NOT EXISTS idx_annotations_review ON annotations(review_id);
```

Export types:

```typescript
export type AnnotationType = 'suggestion' | 'issue' | 'praise' | 'question';
export type Review = { id: number; session_id: string; summary: string; model: string | null; created_at: string };
export type Annotation = { id: number; review_id: number; diff_id: number; line_number: number; side: 'additions' | 'deletions'; annotation_type: AnnotationType; content: string };
```

### 1.2 Add repository methods (`src/db/repository.ts`)

Add prepared statements:
- `insertReview`, `getReview`, `insertAnnotation`, `getAnnotationsByDiff`, `getAnnotationsBySession`

Add method `createSessionWithDataAndReview()` that wraps session + messages + diffs + review creation in one transaction.

Add method `getAnnotationsGroupedByDiff(sessionId)` for fetching annotations keyed by diff_id.

### 1.3 Update API routes (`src/routes/api.ts`)

**Extend `POST /api/sessions`:**
- Accept new form fields: `review_summary`, `review_model`, `annotations` (JSON array)
- Parse annotations and match to diffs by filename
- Use `createSessionWithDataAndReview()` if review data present

**Extend `GET /api/sessions/:id`:**
- Include `review` object in response: `{ id, summary, model, created_at, annotation_count }`

**Add `GET /api/sessions/:id/annotations`:**
- Return `{ review, annotations_by_diff: Record<number, Annotation[]> }`

---

## Phase 2: Frontend Rendering

### 2.1 Add review summary component (`src/client/views.ts`)

Update `renderDiffPanel(diffs, review?)` to show:
- Review summary card at top (if review exists)
- "No review" prompt (if no review)

### 2.2 Add annotation rendering (`src/client/index.ts`)

Update `initializeDiffs()`:
1. Fetch annotations via `/api/sessions/:id/annotations` (returns `{ review, annotations_by_diff }`)
2. Extract `review.model` to include in annotation metadata
3. Pass `lineAnnotations` and `renderAnnotation` callback to `FileDiff.render()`

The integration point is already there (line 194-211) - just add:
```typescript
const diffInstance = new FileDiff({
  // ... existing options
  renderAnnotation: (annotation) => createAnnotationElement(annotation.metadata),
});

diffInstance.render({
  fileDiff,
  fileContainer: container,
  lineAnnotations,  // <-- add this
});
```

Add `createAnnotationElement(metadata)` function that returns styled HTMLElement:

```typescript
function createAnnotationElement(metadata: AnnotationMetadata): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `annotation annotation--${metadata.type}`;

  wrapper.innerHTML = `
    <div class="annotation__pointer"></div>
    <div class="annotation__body">
      <span class="annotation__icon">${iconForType(metadata.type)}</span>
      <span class="annotation__content">${escapeHtml(metadata.content)}</span>
      <span class="annotation__meta">${metadata.model || ''}</span>
    </div>
  `;

  return wrapper;
}
```

### 2.3 Update diff blocks (`src/client/views.ts`)

Add `data-diff-id` attribute to diff containers for annotation matching.

### 2.4 Add annotation styles (`src/public/css/style.css`)

**Layout:** Annotation appears below the annotated line, full-width, pushing subsequent lines down.

**Visual style:** Colored card with speech bubble pointer:
```
   42 │ +   const result = await fetch(url);
      ╭──────────────────────────────────────────────────
      │ 💡 Consider adding error handling for network failures.
      │                                          claude-sonnet
      ╰──────────────────────────────────────────────────
   43 │ +   return result.json();
```

**CSS classes:**
- `.annotation` - base styles: padding, margin-left to align with code, border-radius
- `.annotation__pointer` - small triangle/arrow pointing up to the line
- `.annotation__content` - main text
- `.annotation__meta` - right-aligned model name, muted color
- `.annotation--suggestion` - blue tint + border
- `.annotation--issue` - red/orange tint + border
- `.annotation--praise` - green tint + border
- `.annotation--question` - purple tint + border

---

## Critical Files

| File | Changes |
|------|---------|
| `src/db/schema.ts` | Add reviews + annotations tables, types |
| `src/db/repository.ts` | Add prepared statements, `createSessionWithDataAndReview()` |
| `src/routes/api.ts` | Extend createSession, add annotations endpoint |
| `src/client/index.ts` | Add lineAnnotations to FileDiff.render() |
| `src/client/views.ts` | Add review summary card, data-diff-id attribute |
| `src/public/css/style.css` | Add annotation styles |

---

## Verification

1. **Data model:** Run `bun run start`, check tables created in SQLite
2. **API:** Use curl to POST session with review data, verify stored and returned
3. **Rendering:** Manually insert review data, verify summary card + inline annotations render
4. **Tests:** Add tests in `src/db/repository.test.ts` for new methods

---

## Future Work (separate plans)

- **CLI integration:** Add `--review` flag to `bin/upload-session.ts`. This script already handles session detection, git diff, and uploads. Adding review generation requires:
  - New `--review` flag in `parseArgs()`
  - Review generation function (calls Claude API with session + diffs)
  - Appending `review_summary`, `review_model`, `annotations` to form data
- **Polish:** Collapsed annotation mode, annotation count badges, no-review prompts
