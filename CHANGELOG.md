# Changelog

All notable changes to the Study Reader plugin are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Print / export of the original document.
- Multi-document tabs.
- Split `client.js` into source modules behind a small bundler step.

## [1.17.1] - 2026-11-13

### Changed
- 模型选择移至问答输入框底部，与发送快捷键提示同一行；翻译页在目标语言行保留紧凑模型选择。
- 历史对话入口移至问答/翻译标签旁，点击以绝对定位浮层展开，不占据文档流，不推动消息和输入框。支持点击外部或 Escape 关闭，保留切换与删除操作。

## [1.17.0] - 2026-11-13

### Added
- 按文档自动保存多段对话，历史列表支持切换与单独删除；保存并恢复草稿、引用、模式与模型，迁移旧版浏览器问答。
- 历史问题可编辑后重新提问，或编辑后创建独立分支；每条消息可从该位置创建分支，保留原会话。
- 从 DSH 已配置的模型目录选择问答、翻译、主动概览及补读模型；保留跟随全局默认的选项，不修改全局模型设置。

### Changed
- X 和新对话按钮保留旧会话并新建会话，继续引用当前文字/区域选区及聚焦输入框；不再清空历史。
- 对话写入 Host profile 数据目录，浏览器备份标记未同步修改与删除，保存失败可重试；流式请求按文档、会话和取消令牌隔离。

## [1.16.7] - 2026-11-13

### Changed
- npm 包名改为 `study-reader`，同步 Host bundle、Client 模块标识和锁文件；保留原入口 ID、浏览器存储键、Host 数据目录与 API 路径。
- 添加公开 npm 发布配置、仓库与问题反馈链接，文档增加包名安装与旧本地包迁移说明。

## [1.16.6] - 2026-11-13

### Added
- X 直接开始新对话：清空当前文档问答与草稿、取消旧生成并聚焦问答输入框；有文字或区域选区时自动附上引用，不自动发送问题。新对话按钮共用重置逻辑并保留确认框。
- 输入框、输入法组词、修饰键和弹窗中不触发 X；长按激活键不会向刚聚焦的输入框灌入字母。

## [1.16.5] - 2026-11-13

### Fixed
- 补齐“继续上次阅读”：按规范化文档路径保存页码和页内横纵位置；打开同一文件时等待页面准备完成再恢复，单页和连续页共用，避免初始第一页覆盖原有记录。
- 阅读位置另存于 Host profile 数据目录，并以浏览器记录作为备用；DSH 重启后网页端口变化不再导致已保存的文档位置失效。
- 文档切换、关闭及页面隐藏前刷新位置保存；后台写入保留顺序，旧请求不能倒写同一窗口的较新记录。无效坐标与损坏记录会明确处理。

### Verification
- 1.16.4 已使用运行中的 DSH、原测试 PDF 和真实模型复测：第 76、79 页图片成功注入，第二轮输入估算 24,495 tokens，保留学习模式当前页限制；真实模型公式可由当前 Host 提供的 KaTeX 转换。详见 `ACCEPTANCE.md`，浏览器目视验收仍待完成。

## [1.16.4] - 2026-11-12

### Fixed
- 问答与译文支持行内和独立数学公式（`$…$`、`$$…$$`、`\(…\)`、`\[…\]`），使用同源本地 KaTeX 及字体；代码片段保持原样，禁用受信任 HTML/链接命令。
- 默认单次输入预算从 24,000 提高到 196,608 tokens，累计预算从 96,000 提高到 786,432 tokens；实际仍受模型上下文窗口及输出预留约束。
- 补读图片超预算时先压缩可替代的文字上下文，再按剩余预算保留可容纳的图片；只把实际注入模型的页面记为已读，未注入页面可重试。
- 保留学习模式当前页补读及后文图片限制，用户主动框选仍作为原始引用处理。

## [1.16.3] - 2026-11-12

### Documentation
- 补齐从源码安装、插件管理器安装、更新/卸载、版本核对和已验证环境说明；兼容清单限制为已核实的 DSH 0.2.2-rc.1，Node.js 要求 >=22.13.0。
- 更正本机 Host 处理与模型推理的区别，说明发给供应商的文字/上下文/截图、本地浏览器与批注/附件存储及公开反馈脱敏。
- 增加可重复的完整可达 Git 历史扫描及发布前审查记录；不改写历史或提交作者。
- 精简用户文档中的本机调试过程、过期版本验收和固定性能数字；一次性性能探针归档为不随仓库提交的本地材料。

## [1.16.2] - 2026-11-12

### Fixed
- 多页图片补读逐页保留成功结果，并按页返回失败原因；某页渲染失败、额度不足或不允许读取时，不再丢弃同批其他成功页的图片。
- 成功图片标注本批附件序号，轨迹只记录实际成功页并另存失败明细；仅模型上下文接受的成功页消耗已读/图片额度并进入缓存，重复混合请求复用成功图片、允许失败页重试。
- 保持学习模式当前页图片（包括局部裁切）及后文的禁读规则；整次输入预算和取消检查不变，未注入结果不误记为成功。

## [1.16.1] - 2026-11-12

### Fixed
- 搜索跳转携带关键词和结果上下文；等目标页文字层渲染完毕并完成页级位置恢复后，再滚动到命中文字，而不是停留页顶。优先使用提取模型的物理 PDF 页号。
- 搜索结果页面的命中词以黄色标记，当前结果有更醒目的黄色及边框；支持跨文字片段、换行、全角/合字、组合音符和大小写映射，不修改文字节点或浏览器选区。
- 单页/连续页共用定位及标记；渲染开始清除旧就绪标记，缩放或重新加载后重新计算坐标，连续页邻页高度变化可短暂校正，用户主动滚动后停止校正。
- 浏览结果时收紧搜索面板高度，为原文保留空间；退出搜索保留最近标记，换关键词或文档清除，不保存为批注。无法在页面文字层匹配时明确提示。

## [1.16.0] - 2026-11-12

### Added
- 阅读区快捷键：←/A 上一页、→/D 下一页，↑/W 与 ↓/S 滚动，G 聚焦页码并 Enter 跳转，+/− 缩放；Alt+A/D 与 Alt+←/→ 阅读历史等价。
- F 搜索、O 目录开关、Q 聚焦提问并携带选区、T 翻译选区、E 保存高亮、R 添加批注并聚焦备注；按钮增加对应快捷键提示。
- 搜索输入与结果浏览分离：输入框内正常打字，Enter 后用 A/D、W/S 或对应方向键循环浏览，F 修改关键词，Esc 退出回 PDF；搜索浏览期间不触发阅读翻页。

### Fixed
- Esc 由最上层弹窗处理，批注编辑先退回列表，再退出至 PDF；页码 Enter/Esc 及其他弹窗退出恢复 PDF 焦点并保留滚动位置，避免重复监听器同时关闭多层。
- Ctrl/⌘ 框选主动聚焦 PDF，避免选区快捷键误写进原先的输入框；中文组词、文本编辑、系统修饰键和 Shift+方向键保持正常行为。
- 长按 Esc 只退出一层，长按 F/Q/R/G 不向新聚焦的输入框重复写入字母；翻页、滚动、缩放和结果浏览允许重复。

## [1.15.0] - 2026-11-12

### Added
- 原貌阅读支持适合页宽、适合整页、25%–300% 缩放，保留高亮坐标；单页和连续页统一适用，支持混合横竖页面。
- 阅读导航历史（最多 80 个位置），工具栏返回/前进、阅读区 Alt+←/→ 和鼠标侧键；返回时恢复页内相对位置，聊天编辑不受影响。
- 回答引用可点击预览原文和页面图片，明确点击后才跳转；处理 B 块号、物理 PDF 页和原始幻灯片标签，拒绝无效引用，不猜测 Office 转换页映射。新提示要求关键结论附依据并区分原文与推导。
- 页面书签、文字/区域高亮、带标签的批注，全书列表搜索、类型筛选、编辑、删除和跳转，页面小标记直接编辑；跨页文字高亮要求分开选择。
- Host 文件持久化批注、按规范化绝对路径隔离、并发串行与原子替换、数据损坏保护；可选 annotationDirectory；共享 study_annotations 工具。
- Office 转换后的页面可通过相同页面图片接口用于引用预览；较大缩放和异常长页面限制光栅像素数。

## [1.14.1] - 2026-11-12

### Added
- PDF 原貌页面跟随 DSH 当前明暗主题，支持手动切换、跟随系统和深色自定义主题；单页/连续页、PDFium/PDF.js 以及 Office 转换页面共用显示层适配。
- 夜间以深色纸面、浅色文字显示；滤镜仅作用于画布，不影响文字选区、区域引用和发送给模型的原始截图。彩色图像会经过夜间配色转换，查看原色可切回浅色主题。

### Fixed
- 页面加载占位、错误占位、加载状态提示及旋转指示器使用宿主主题色，避免夜间加载时出现白色占位。
- 通过主题服务订阅变化，切换无需重渲染页面；插件卸载时清理监听及样式。

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

## [1.13.0] - 2026-11-11

### Changed
- PDF 原貌不再把整份文件下载到浏览器再交给 PDF.js：`/preview` 的
  Range 路由直接按字节范围读磁盘，PDF.js 只取 xref、页面字典和文字流。
  避免首屏复制整个文件，以及在渲染进程长期保留整份 ArrayBuffer。
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
