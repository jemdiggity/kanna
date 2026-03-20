# Markdown Preview in File Preview Modal

## Summary

Add rendered markdown preview to the existing FilePreviewModal. When a `.md` file is open, pressing spacebar toggles between raw syntax-highlighted text (default) and rendered markdown.

## Requirements

- Spacebar toggles between raw and rendered views for `.md` files only
- Default view is raw (syntax-highlighted, current behavior)
- Rendered view supports GFM features: headings, bold, italic, lists, links, code blocks (syntax-highlighted via Shiki), tables, task lists, blockquotes, horizontal rules, strikethrough
- Styling matches the existing dark theme
- No changes to FilePickerModal, App.vue, or keyboard shortcuts composable

## Approach

Use `markdown-it` as the parser with GFM plugins. Fenced code blocks use the existing lazy-loaded Shiki highlighter singleton for syntax highlighting.

## Design

### State & Toggle Logic

In `FilePreviewModal.vue`:

- `renderMarkdown` ref, default `false`
- `isMarkdownFile` computed from file path (ends with `.md`)
- Spacebar keydown listener on the modal toggles `renderMarkdown` when `isMarkdownFile` is true
- Small indicator in the header shows current mode and toggle hint

### Rendering Pipeline

When `renderMarkdown` is true:

- Raw content passed through `markdown-it` configured with GFM support (tables, task lists, strikethrough)
- Custom highlight function calls the existing Shiki highlighter singleton for fenced code blocks
- Output HTML rendered via `v-html` in the same container div
- When false, existing Shiki syntax-highlighted raw view (unchanged)

No new Tauri commands needed — raw content is already loaded.

### Styling

Scoped styles using `:deep()` on a `.markdown-rendered` wrapper class:

- Headings: sized hierarchy, `#e0e0e0`, subtle bottom border on h1/h2
- Code blocks: `#252525` background, rounded corners, Shiki syntax colors
- Inline code: slight background highlight, monospace
- Tables: bordered cells, alternating row backgrounds
- Task lists: styled checkboxes (read-only)
- Links: colored, underline on hover
- Blockquotes: left border accent, muted text
- Lists: proper indentation and spacing

All colors consistent with existing theme (`#1a1a1a`, `#252525`, `#333`, `#e0e0e0`).

## Dependencies

### New

- `markdown-it` — markdown parser
- `@types/markdown-it` — TypeScript types

### Existing (reused)

- `shiki` v4.0.2 — fenced code block highlighting via existing singleton

## Files Modified

- `apps/desktop/src/components/FilePreviewModal.vue` — toggle state, rendering logic, styles
- `apps/desktop/package.json` — new dependencies

## Out of Scope

- No sanitization library (content is local filesystem, trusted)
- No image rendering (broken images acceptable for code project preview)
- No `.markdown` or `.mdx` support (can be added later)
- No side-by-side view
- No changes to other components
