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

## [1.14.1] - 2026-11-12

### Added
- PDF 原貌页面跟随 DSH 当前明暗主题，支持手动切换、跟随系统和深色自定义主题；单页/连续页、PDFium/PDF.js 以及 Office 转换页面共用显示层适配。
- 夜间以深色纸面、浅色文字显示；滤镜仅作用于画布，不影响文字选区、区域引用和发送给模型的原始截图。彩色图像会经过夜间配色转换，查看原色可切回浅色主题。

### Fixed
- 页面加载占位、错误占位、加载状态提示及旋转指示器使用宿主主题色，避免夜间加载时出现白色占位。
- 通过主题服务订阅变化，切换无需重渲染页面；插件卸载时清理监听及样式。

### Verification
- JavaScript 语法、版本一致性及现有回归检查；当前工具环境没有浏览器控制能力，真实页面的明暗切换和视觉效果需在重新加载插件后确认。

## [1.14.0] - 2026-11-12

### Added
- 受限模型自主补读：查目录、搜索正文与目录、按单元读取正文或 PDF 整页/局部图片，默认 3 轮、8 个全文补读单元，每轮最多执行 3 次操作。
- 侧栏补读进度、原因、结果、页码跳转；上下文面板显示每轮真实模型请求、工具定义、预算、用量和阅读记录，复制功能包含这些记录。
- 每次输入与累计 Token 预算、模型窗口和输出重试预留；预算不足时优先缩减更早历史，补读达到轮次上限后撤去工具收束作答。

### Fixed
- 历史优先保留最新完整问答轮次，并携带原文、页码、块号和截图坐标；不再在预算不足时保留较早消息而丢掉最新追问。
- 完整文档上下文按预算裁剪，超长段落保留命中点附近；先按相关性选取再按文档位置排序；学习模式可找回已读的重要定义。
- 翻译先保留选区附近正文再分配邻接内容；修复截断状态与重复当前段落。
- 学习模式按实际物理页限制旧锚点，空白/扫描页不会沿用未来页正文；工具返回的命中和邻接文字同时受块号与页号约束。
- 读取结果被预算拒绝、部分图片失败或取消时，不进入成功缓存和已读计数。
- 保留流式正文；工具轮次的临时前言和继续阅读标记会清除；推理、工具调用 ID 和供应商 replayState 随后续请求保留。

### Changed
- 自主补读的初始文档文本最多 8,000 字，图片按问题/文字质量选择，替换旧的单次 JSON 选页调用。
- 概览明确标注为目录与章首页生成的辅助材料，不再在问答结束后自动调用模型生成。
- 用量合计所有轮次和空回答重试，耗时包含问答准备阶段；每轮请求保存独立快照。

### Verification
- 上下文、工具协议及 Host HTTP 回归、语法、版本和 diff 检查通过；测试模型为离线协议桩。
- 真实供应商原生工具调用与新增侧栏交互尚待重启后验证；需要支持工具调用的模型，图片补读另需视觉输入能力。

## [1.13.2] - 2026-11-12

### Fixed
- Ctrl / ⌘ 框选区域后，矩形与翻译/追问/解释菜单一起保留；选择动作后
  再一起消失，切换翻译目标语言不会提前清除矩形。
- 按 Esc、点击菜单外部、滚动或调整窗口大小时取消区域选区，防止固定
  坐标的矩形留在已移动的页面上。普通文字选择保持原有行为。

## [1.13.1] - 2026-11-12

### Fixed
- 单页和连续页的 PDF.js 文字层先在脱离文档的容器中构建，再一次性
  装入原有文字层；避免逐个插入文字时反复触发 DSH 全局样式计算。
  每 128 个文字项目让出一次任务，密集页面也能处理输入与取消。
- 提交文字层前检查渲染是否已取消、目标节点是否仍为本次节点；在
  PDF.js 初始化后固定 viewport 像素尺寸，保留文字选择的缩放与坐标。
- 连续页用稳定的“是否相邻”标记代替不断变化的页码距离，避免每次
  跨页让整份文档的页面组件重新执行；保留前后各 2 页的画布和文字层。
- 删除重复的当前页预热提取，减少与实际页面文字提取竞争；图像解码
  后再次检查取消状态，避免快速翻页继续启动旧文字任务。
- 修正 `version:check` 指向不存在脚本的问题，统一调用 `scripts/check.mjs`。

### Verification
- JavaScript 语法、版本一致性和 Host / 上下文回归通过；独立审查覆盖
  PDF.js 流式文字、取消、样式传递和邻页保留逻辑。
- 1.13.0 的真实窗口对照已证明脱离文档构建能消除主要样式反复计算，
  但 1.13.1 完整界面的选区、缩放与连续滚动尚待重启后体验验证；
  不将旧实验耗时当作本版完整界面的性能结果。

## [1.13.0] - 2026-11-11

### Changed
- PDF 原貌不再把整份文件下载到浏览器再交给 PDF.js：`/preview` 的
  Range 路由直接按字节范围读磁盘，PDF.js 只取 xref、页面字典和文字流。
  本机 164 MB / 189 页 PDF 的首屏不再经历一次完整文件复制，渲染进程
  也不再长期持有这份 ArrayBuffer。
- 连续页的相邻页预取改为分级：当前页立即开始，前后各 1 页在 120 ms
  后开始，再远一页仍等 600 ms。翻到下一页时页面图通常已经就绪，同时
  不会一次启动五个 PDFium 渲染。
- PDF 阅读区预留滚动条位置（`overflow-y: scroll` +
  `scrollbar-gutter: stable`），并把页面宽度量化到 16 px，减少滚动条
  出现/消失时宽度来回变化造成的重复页面请求和文字层重建。
- 目录还在提取时，右上角目录按钮先以禁用态出现（提示“目录加载中…”），
  提取完成后启用；没有目录的文档在提取结束后仍隐藏该按钮。

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
