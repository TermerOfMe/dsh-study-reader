# Changelog

All notable changes to the Study Reader plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Zoom controls and a persisted reading position per document.
- Bookmarks and notes attached to PDF pages.
- Print / export of the original document.
- Multi-document tabs.
- Split `client.js` into source modules behind a small bundler step.

## [1.12.3] - 2026-11-10

### Changed
- Continuous view now builds the selectable PDF.js text layer only for the
  page under the reading position. Neighbouring pages are still prefetched as
  images, but no longer build several text layers (hundreds of absolutely
  positioned spans) at once on the main thread. This is the main cause of the
  delayed hover/click feedback while continuous mode was rendering.
- Current-page detection while scrolling uses one `elementFromPoint` hit test
  instead of walking every preceding page and calling
  `getBoundingClientRect()` on each scroll frame.
- Continuous mode keeps one rendered page on each side of the reading
  position instead of two. Together with the current-only text layer this
  halves the number of page images prepared during scrolling while a single
  page flip still reuses a rendered canvas.
- CSS containment on the header, reader column, PDF scroll area and page box
  isolates their layout/paint from the header buttons, so a page repaint no
  longer invalidates the top-right controls. Icon-button hover no longer uses
  a 140 ms transition.

## [1.12.2] - 2026-11-10

### Changed
- Performance: reasoning-only frames are coalesced at 120 ms instead of one
  React update per animation frame; the whole chat no longer re-renders for
  every reasoning token.
- The reasoning panel is collapsed by default while generating (the header
  still shows **正在思考…** and the character count); click it to watch live.
  This keeps the growing reasoning text out of the layout unless requested.
- `Markdown`, settled message bubbles and settled translation cards are
  memoized, and chat auto-scroll ignores reasoning-only updates, so previous
  answers are not re-parsed or re-laid-out on every frame.
- Context thumbnails are requested at 420 px through `/context-image?w=420`;
  clicking still opens the full-size page/crop image. Opening a context panel
  no longer renders several full-size 1200 px pages at once.

## [1.12.1] - 2026-11-09

### Fixed
- Expanding **查看注入的上下文** showed a plain `HTTP 404`. The panel passed the
  already-absolute `contextPath` into `apiGet`, which prefixes `APP_BASE` again,
  producing `/api/dsh-study/api/dsh-study/context`. It now requests the relative
  `/context?...` path; image URLs keep using the absolute path for `<img>`/links.

## [1.12.0] - 2026-11-09

### Added
- **Injected context panel**: every Q&A answer and every translation now has
  an expandable **查看注入的上下文** section. It shows the exact system prompt,
  the user message (document context, history and question), the ordered image
  attachments with thumbnails, reading position, image/character/estimated
  token counts, context trimming, book-brief injection, pages requested by the
  planner, status, duration and token usage. The system prompt and user message
  can be copied separately or together.
- **Reasoning panel**: when the model emits reasoning, answers and translations
  show an expandable **思考过程** stream. It opens automatically while the answer
  is still being generated and can be collapsed or copied afterwards.
- Host-side context records (`lib/context-log.js`) keep the last 12 requests per
  document in memory (up to 8 documents). `GET /context` returns one record;
  `GET /context-image` reproduces each attached page or crop with the same
  PDFium rendering/cropping pipeline. Nothing is written to disk or the Session.
- The answer/translation `meta` NDJSON frame now carries a `contextId`, and
  `reasoning-delta` chunks are forwarded as `reasoning` frames.
- `scripts/smoke-context.mjs` and `scripts/smoke-host.mjs` cover the context
  log, reasoning capture, NDJSON frames, context record and image route.

### Changed
- `lib/llm.js` collects `reasoning-delta` text, returns it with the completion
  result and retries still preserve both attempts' reasoning.
- Prompt builders report context/history sizes used by the inspector.

### Known limits
- Context records are memory-only; after a DSH restart or 12 newer questions
  for the same document, older panels report an expired record.
- The overview flow runs in batches; its context panel merges every batch into
  one record separated by `第 N / M 批` markers instead of showing one entry per
  batch.

## [1.11.1] - 2026-11-07

### Changed
- Region quoting is now **Ctrl/⌘ + drag** over a page; a plain drag keeps the
  browser's text selection. Removed the toolbar toggle so selecting text and
  quoting a region no longer compete for the same gesture.
- The original-view hint now explains the Ctrl/⌘ gesture.

## [1.11.0] - 2026-11-07

### Added
- **Region quote**: enable 区域引用 in the original toolbar and drag a box over
  any rendered page. The region becomes a normal quote (same selection bar and
  ask/translate/explain actions) and its cropped image is sent to the model.
- Text selections now also carry a normalized crop of the selected area, so a
  quote can be answered from the rendered page even when its Chinese text is
  not extractable.
- Translation accepts an image-only region quote: with a vision model it
  translates the text inside the selected region.
- The crop is attached as the first image and the prompt tells the model that
  it represents the user's quoted source.

## [1.10.0] - 2026-11-07

### Added
- Q&A now attaches the current PDF page as an image to the model, so PDFs
  whose Chinese glyphs lack a ToUnicode map (such as the Easy-RL textbook)
  can still be read and answered from the rendered page.
- Before answering, a lightweight planner asks the model which extra pages it
  needs (up to `visionMaxPages`); Learning mode restricts the plan to pages at
  or before the current page, Re-reading mode may look ahead.
- A whole-book chapter map (chapter titles, page labels and section names) is
  always added to the prompt. Re-reading mode also uses a cached, model-written
  chapter brief once it has been generated.
- The contents panel has an **概览 (Overview)** action: it reads chapter opening
  pages in batches, streams a chapter-by-chapter summary into the chat, and
  caches it for later questions. Re-reading mode also warms this brief in the
  background after an answer when it is still missing.
- Answers can show which pages were read (`参考页：…`).
- The answer call retries once with a larger output budget when a reasoning
  model exhausts `maxAnswerTokens` before producing any text.

### Changed
- `maxAnswerTokens` default raised from 1,800 to 4,096.
- New config: `visionPages` (default `true`) and `visionMaxPages` (default 4).

## [1.9.0] - 2026-11-07

### Added
- Full-text search over the extracted text (top-right **查找** panel), with
  match snippets, page labels and Enter/arrow-key navigation that jumps the
  original view to the hit.
- Diagnostics dialog (top-right **i** button): plugin version, active page
  renderer, PDF.js entry, model/Office availability, document statistics and
  recent problems, with one-click copy for bug reports.
- Keyboard and screen-reader support for dialogs: focus is trapped inside the
  TOC, file browser, search and diagnostics; Escape closes them and focus
  returns to the trigger.
- Friendly error for password-protected PDFs instead of a generic parse
  failure.

### Changed
- The plugin version now has one source of truth: `lib/app.js` reads
  `package.json` and the browser receives it through `/bootstrap`; the PDF.js
  fallback warning and diagnostics no longer hardcode a version.
- Added `npm run check` / `npm run version:check` to catch manifest, lockfile
  and version-reference drift.

## [1.8.0] - 2026-11-07

### Added
- Collapsible contents: only chapter-level entries are shown by default and
  each chapter expands on demand, with a `共 N 章` count in the panel header.
- Chapter-aware grouping keeps slide decks (no chapter level) flat instead of
  hiding every slide behind the first one.

## [1.7.0] - 2026-11-07

### Added
- The contents panel now prefers the PDF's embedded outline (bookmarks),
  including its titles, nesting and destination pages; documents without an
  outline fall back to the font-size heuristic.
- Page indices are remapped correctly when pages without extractable text are
  dropped, so jump targets no longer collapse onto page 0.
- PDF heading fallback ignores formula-only lines such as `A`, `6 Q` or `7.9`.

## [1.6.0] - 2026-11-07

### Changed
- Continuous view keeps the current page plus two pages on each side mounted
  and rendered, so flipping back reuses the existing canvas and text layer
  instead of rendering the page again.
- Turning a neighbouring page into the current one starts it immediately
  without cancelling the work already in flight.
- PDF pages prefetch only the text layer, not the PDF.js operator list, so
  scanned pages are no longer decoded twice in the worker.

## [1.5.0] - 2026-11-07

### Added
- Host-side PDFium (WASM) page rendering encoded as JPEG, with PDF.js serving
  only page count, text extraction and the transparent text layer.
- Current-page-first scheduling, adjacent-page delay and a page-image cache.

### Fixed
- Blurry original view on high-DPI screens (2× page bitmaps).
- Light/dark theme button contrast; zero-specificity form reset.
- White screen when returning from the plugin to the conversation.

## [1.0.0] - 2026-11-06

### Added
- First working release: original-layout reader for PDF/Word/PowerPoint,
  selectable text, contextual translation, Learning/Re-reading Q&A, lazy PDF
  text extraction and a sidebar entry.
