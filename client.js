/**
 * Browser half of the Study Reader.
 *
 * A full-width main panel (sidebar entry id `study-reader`) with an
 * original-layout document reader, a selection toolbar, a contextual
 * translation tab, and a side Q&A that switches between Learning and
 * Re-reading modes. All model and file work goes through the Host half's
 * same-origin routes; nothing is appended to the DSH Session log.
 */
globalThis.__ModuleLoader__.load({
  id: '@local/dsh-study-reader',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const {
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
    } = React

    const PANEL_ID = 'study-reader'
    const APP_BASE = (() => {
      try {
        return new URL('api/dsh-study', document.baseURI).href.replace(/\/$/, '')
      } catch {
        return '/api/dsh-study'
      }
    })()
    const STORE_PREFIX = 'dsh.study-reader.v1.'
    const MAX_SELECTION = 8000
    const TARGET_LANGUAGES = [
      ['zh-CN', '简体中文', 'Simplified Chinese'],
      ['zh-TW', '繁體中文', 'Traditional Chinese'],
      ['en', 'English', 'English'],
      ['ja', '日本語', 'Japanese'],
      ['ko', '한국어', 'Korean'],
      ['fr', 'Français', 'French'],
      ['de', 'Deutsch', 'German'],
      ['es', 'Español', 'Spanish'],
      ['ru', 'Русский', 'Russian'],
      ['ar', 'العربية', 'Arabic'],
      ['pt', 'Português', 'Portuguese'],
      ['it', 'Italiano', 'Italian'],
    ]

    const STR = {
      zh: {
        appName: '研读',
        appTag: '读 · 译 · 问',
        openDoc: '打开文档',
        open: '打开',
        close: '关闭',
        cancel: '取消',
        refresh: '刷新',
        up: '上一级',
        home: '主目录',
        workspace: '工作目录',
        recent: '最近打开',
        noRecent: '还没有打开过文档',
        loading: '正在加载…',
        loadingDoc: '正在解析文档…',
        loadFailed: '加载失败',
        dialogTitle: '打开文档',
        dialogHint: '选择工作目录中的 PDF、Word、PowerPoint 或文本文件。也可以直接输入路径。',
        pathPlaceholder: '输入文件或文件夹路径…',
        openPath: '打开路径',
        noFiles: '这个文件夹里没有可阅读的文档。',
        unsupportedFile: '暂不支持',
        folder: '文件夹',
        file: '文件',
        welcomeTitle: '把阅读变成一场对话',
        welcomeSub: '在主页面读 PDF、Word、PowerPoint。框选一句话，就能结合上下文翻译；打开侧边问答，在第一次学习和重读之间切换。',
        getStarted: '开始阅读',
        restoreLast: '继续上次阅读',
        featureReadTitle: '原貌阅读',
        featureReadDesc: 'PDF、Word 和 PowerPoint 都按原版式显示，可直接在页面上框选文字。',
        featureTranslateTitle: '带上下文的翻译',
        featureTranslateDesc: '不只翻译选中的一句，还会参考所在段落、前后文和小节标题。',
        featureModesTitle: '两种问答模式',
        featureModesDesc: '学习模式只依赖已读内容，并提醒你“后面马上会讲”；重读模式调用全文，建立跨章节联系。',
        supported: '支持 PDF · DOCX · PPTX · DOC · PPT',
        modelMissing: '当前没有可用的默认模型，问答和翻译暂不可用。',
        settings: '设置',
        toc: '目录',
        noToc: '这篇文档没有标题目录',
        tocExpand: '展开本章',
        tocCollapse: '收起本章',
        tocChapterCount: '共 {n} 章',
        tocOverview: '概览',
        overviewQuestion: '请按章概括这本书的内容，说明每一章主要讲什么。',
        readPages: '参考页',
        pageShort: '第 {n} 页',
        search: '查找',
        searchPlaceholder: '搜索正文关键词…',
        searchEmpty: '输入关键词搜索正文',
        searchNoResult: '没有找到匹配内容',
        searchResults: '找到 {n} 处',
        searchMore: '仅显示前 200 处',
        searchNoText: '这篇文档没有可搜索的文字层',
        diagnostics: '诊断',
        diagVersion: '插件版本',
        diagEngine: '页面渲染',
        diagPath: '文件路径',
        diagPages: '页数',
        diagBlocks: '文本块',
        diagToc: '目录条目',
        diagExtraction: '文字提取',
        diagModel: '默认模型',
        diagOffice: 'Office 转换',
        diagPlatform: '平台',
        diagProblems: '最近问题',
        diagNone: '无',
        diagCopy: '复制诊断信息',
        diagCopied: '诊断信息已复制',
        diagNoPdfium: 'PDFium 未生效，已回退到 PDF.js',
        pdfPassword: '这个 PDF 有密码保护，暂时无法在阅读器中打开。请用系统 PDF 阅读器打开。',
        originalLoading: '正在准备原貌，Office 文档可能需要几秒…',
        extractingText: '正在建立目录与问答上下文…',
        extractFailed: '文字提取失败：',
        pdfiumEngine: 'Host PDFium 页面渲染',
        pdfjsEngine: 'PDF.js 兼容渲染',
        pdfCompatWarning: '当前回退到 PDF.js 渲染，扫描页会明显更慢。请确认 DSH 已完全重启并加载 {version}。',
        downloadPdf: '在新标签页打开',
        parsingWarnings: '解析提示',
        position: '正在读',
        progress: '阅读进度',
        chat: '问答',
        translation: '翻译',
        chatTitle: '旁注问答',
        chatSub: '基于当前阅读位置回答',
        newChat: '新对话',
        clearChat: '清空问答',
        clearChatConfirm: '清空本文档的问答记录？',
        askPlaceholder: '就当前内容提问…',
        askWithQuote: '就选中的内容提问…',
        send: '发送',
        stop: '停止',
        composerHint: 'Enter 发送 · Shift + Enter 换行',
        quoteLabel: '引用',
        removeQuote: '移除引用',
        emptyChatTitle: '从读懂这一段开始',
        emptyChatDesc: '你可以直接提问，也可以先框选一句话，再选择“追问”或“解释”。',
        emptyChatLearning: '学习模式会尽量只用你已经读到的内容；如果后面马上有更系统的解释，它会先提醒你继续读。',
        emptyChatReread: '重读模式会调用全文，帮你把这一处和前后章节、概念和例子联系起来。',
        modeLearn: '学习模式',
        modeReread: '重读模式',
        modeLearnShort: '第一次学',
        modeRereadShort: '读过一遍',
        modeLearnDesc: '只用当前位置之前的内容；若后文马上会解释，会先提醒你继续读。',
        modeRereadDesc: '可以使用全文，主动联系其他章节和概念。',
        modeSwitch: '切换模式',
        currentPosition: '当前位置',
        jumpTo: '跳到该处',
        continueReading: '继续阅读',
        aheadTitle: '建议先继续读',
        aheadDesc: '后面的内容会更系统地讲到这一点。先读到这里，再回来看这个问题会更顺。',
        noAnswer: '没有收到回答',
        answerStopped: '已停止生成',
        reasoningTitle: '思考过程',
        reasoningStreaming: '正在思考…',
        reasoningChars: '{n} 字',
        reasoningCopy: '复制思考过程',
        reasoningCopied: '思考过程已复制',
        contextTitle: '注入的上下文',
        contextShow: '查看注入的上下文',
        contextHide: '收起上下文',
        contextLoading: '正在读取上下文…',
        contextMissing: '这次请求的上下文记录已失效（DSH 重启或记录已被新请求覆盖）。',
        contextSummary: '本次请求',
        contextKind: '类型',
        contextMode: '模式',
        contextModel: '模型',
        contextPosition: '阅读位置',
        contextImages: '附带图片',
        contextNoImages: '没有附带图片',
        contextChars: '文档上下文',
        contextTokens: '估算输入',
        contextHistory: '历史对话',
        contextTrimmed: '上下文截断',
        contextBrief: '全书概览',
        contextVision: '页面图片',
        contextPlanned: '模型加读页面',
        contextUsage: 'Token 用量',
        contextDuration: '耗时',
        contextCopyAll: '复制全部上下文',
        contextCopied: '上下文已复制',
        contextSystem: '系统提示',
        contextUser: '用户消息',
        contextImagePage: '第 {n} 页',
        contextImageCrop: '第 {n} 页框选',
        contextImageCurrent: '当前页',
        contextStatus: '状态',
        contextStatusStreaming: '生成中',
        contextStatusDone: '已完成',
        contextStatusError: '失败',
        contextStatusAborted: '已停止',
        contextYes: '是',
        contextNo: '否',
        contextOverviewInjected: '已注入',
        contextOverviewNo: '未注入',
        usageInput: '输入',
        usageOutput: '输出',
        usageReasoning: '推理',
        errorPrefix: '出错了',
        retry: '重试',
        translateTitle: '上下文翻译',
        translateSub: '选中文字后即可翻译',
        targetLanguage: '翻译为',
        emptyTranslateTitle: '在正文里框选一段试试',
        emptyTranslateDesc: '译文会出现在这里，并保留原文的段落和列表结构。',
        translating: '正在翻译…',
        translationFailed: '翻译失败',
        source: '原文',
        result: '译文',
        copy: '复制',
        copied: '已复制',
        copyFailed: '复制失败',
        clearTranslations: '清空翻译',
        retranslate: '重新翻译',
        selectionTranslate: '翻译',
        selectionAsk: '追问',
        selectionExplain: '解释',
        quoteRegion: '框选区域',
        selectionTooLong: '选中的内容太长，已截取前 8000 个字符。',
        pageOf: '{current} / {total}',
        selectionLabel: '已选中 {n} 字',
        parseError: '无法打开文档',
        fileNotFound: '文件不存在或无法读取。',
        closePanel: '收起侧栏',
        openPanel: '展开问答',
        more: '更多',
        loginTitle: '文档缓存已过期',
        loginDesc: '重新打开文件即可继续。',
        jumpPosition: '定位到阅读位置',
        toastOpenFailed: '打开失败',
        restoreFailed: '上次阅读的文件已无法打开。',
        sortHint: '双击或单击文件夹进入',
        quickNav: '快速跳转',
        pageCount: '{n} 个阅读单元',
        chars: '{n} 字',
        modelLabel: '模型',
        note: '演讲者备注',
        you: '你',
        crashTitle: '研读页面遇到问题',
        crashDesc: '阅读器渲染中断了。刷新页面后可以重新打开文档；如果反复出现，请把浏览器控制台里的错误发给插件作者。',
        reloadPage: '刷新页面',
        backToChat: '返回对话',
        pdfjsUnavailable: '原貌框选组件未能加载。刷新页面或重启 DSH 后再试；期间会使用原生 PDF 查看器。',
        pdfRenderFailed: '原貌渲染失败',
        prevPage: '上一页',
        nextPage: '下一页',
        pageInput: '页码',
        pdfSelectionHint: '直接拖选文字；按住 Ctrl（Mac 为 ⌘）拖动可框选页面区域，作为截图引用。',
        originalNewTab: '新标签页打开原文件',
        pdfPageOf: '第 {current} / {total} 页',
        pdfPageLabel: '第 {n} 页',
        pdfPages: '{n} 页',
        originalOnlyTitle: '没有可用的原貌',
        originalOnlyDesc: '当前只显示原貌页面，需要 PDF 或可转换为 PDF 的 Word / PowerPoint 文档。',
        pageMode: '翻页方式',
        singlePage: '单页',
        continuousPages: '连续页',
        pdfLoadingPage: '正在渲染页面…',
      },
      en: {
        appName: 'Study',
        appTag: 'read · translate · ask',
        openDoc: 'Open document',
        open: 'Open',
        close: 'Close',
        cancel: 'Cancel',
        refresh: 'Refresh',
        up: 'Up',
        home: 'Home',
        workspace: 'Workspace',
        recent: 'Recent',
        noRecent: 'No documents opened yet',
        loading: 'Loading…',
        loadingDoc: 'Reading document…',
        loadFailed: 'Could not load',
        dialogTitle: 'Open a document',
        dialogHint: 'Pick a PDF, Word, PowerPoint or text file. You can also type a path.',
        pathPlaceholder: 'File or folder path…',
        openPath: 'Open path',
        noFiles: 'No readable documents in this folder.',
        unsupportedFile: 'Unsupported',
        folder: 'Folder',
        file: 'File',
        welcomeTitle: 'Turn reading into a conversation',
        welcomeSub: 'Read PDF, Word and PowerPoint in the main panel. Select a sentence to translate it with context, then discuss it in Learning or Re-reading mode.',
        getStarted: 'Start reading',
        restoreLast: 'Continue last document',
        featureReadTitle: 'Original page layout',
        featureReadDesc: 'PDF, Word and PowerPoint open in their original layout, with selectable text directly on the page.',
        featureTranslateTitle: 'Translation with context',
        featureTranslateDesc: 'The selected sentence is translated using its paragraph, neighbours and section heading.',
        featureModesTitle: 'Two Q&A modes',
        featureModesDesc: 'Learning relies on what you have read and flags explanations that are just ahead. Re-reading uses the whole document to connect ideas.',
        supported: 'PDF · DOCX · PPTX · DOC · PPT',
        modelMissing: 'No default model is available, so Q&A and translation are disabled.',
        settings: 'Settings',
        toc: 'Contents',
        noToc: 'This document has no heading outline',
        tocExpand: 'Expand chapter',
        tocCollapse: 'Collapse chapter',
        tocChapterCount: '{n} chapters',
        tocOverview: 'Overview',
        overviewQuestion: 'Summarize this book chapter by chapter: what does each chapter cover?',
        readPages: 'Pages read',
        pageShort: 'p. {n}',
        search: 'Find',
        searchPlaceholder: 'Search the document…',
        searchEmpty: 'Type a keyword to search the text',
        searchNoResult: 'No matches',
        searchResults: '{n} matches',
        searchMore: 'Showing the first 200 matches',
        searchNoText: 'This document has no searchable text layer',
        diagnostics: 'Diagnostics',
        diagVersion: 'Plugin version',
        diagEngine: 'Page rendering',
        diagPath: 'File path',
        diagPages: 'Pages',
        diagBlocks: 'Text blocks',
        diagToc: 'Contents entries',
        diagExtraction: 'Text extraction',
        diagModel: 'Default model',
        diagOffice: 'Office conversion',
        diagPlatform: 'Platform',
        diagProblems: 'Recent problems',
        diagNone: 'None',
        diagCopy: 'Copy diagnostics',
        diagCopied: 'Diagnostics copied',
        diagNoPdfium: 'PDFium is unavailable; PDF.js fallback is active',
        pdfPassword: 'This PDF is password-protected and cannot be opened in the reader yet. Open it in your system PDF viewer.',
        originalLoading: 'Preparing the original view; Office files can take a few seconds…',
        extractingText: 'Preparing contents and Q&A context…',
        extractFailed: 'Text extraction failed: ',
        pdfiumEngine: 'Host PDFium page rendering',
        pdfjsEngine: 'PDF.js compatibility rendering',
        pdfCompatWarning: 'Falling back to PDF.js rendering; scanned pages will be much slower. Confirm DSH was fully restarted and version {version} is loaded.',
        downloadPdf: 'Open in a new tab',
        parsingWarnings: 'Notes',
        position: 'Reading',
        progress: 'Reading progress',
        chat: 'Ask',
        translation: 'Translate',
        chatTitle: 'Margin Q&A',
        chatSub: 'Answers follow your reading position',
        newChat: 'New thread',
        clearChat: 'Clear Q&A',
        clearChatConfirm: 'Clear the Q&A for this document?',
        askPlaceholder: 'Ask about what you are reading…',
        askWithQuote: 'Ask about the selected passage…',
        send: 'Send',
        stop: 'Stop',
        composerHint: 'Enter to send · Shift + Enter for a new line',
        quoteLabel: 'Quote',
        removeQuote: 'Remove quote',
        emptyChatTitle: 'Start with the passage in front of you',
        emptyChatDesc: 'Ask freely, or select a passage and choose Ask or Explain.',
        emptyChatLearning: 'Learning mode stays with what you have already read, and warns you when the next pages explain it better.',
        emptyChatReread: 'Re-reading mode uses the whole document to connect this spot with other sections, concepts and examples.',
        modeLearn: 'Learning mode',
        modeReread: 'Re-reading mode',
        modeLearnShort: 'First pass',
        modeRereadShort: 'Revisit',
        modeLearnDesc: 'Uses only what you have read so far; points out explanations that are just ahead.',
        modeRereadDesc: 'Uses the whole document and actively connects distant ideas.',
        modeSwitch: 'Change mode',
        currentPosition: 'Current position',
        jumpTo: 'Jump there',
        continueReading: 'Continue reading',
        aheadTitle: 'Read on first',
        aheadDesc: 'The document explains this more systematically a little later. Reading that part first will make the answer click.',
        noAnswer: 'No answer received',
        answerStopped: 'Generation stopped',
        reasoningTitle: 'Reasoning',
        reasoningStreaming: 'Thinking…',
        reasoningChars: '{n} characters',
        reasoningCopy: 'Copy reasoning',
        reasoningCopied: 'Reasoning copied',
        contextTitle: 'Injected context',
        contextShow: 'View injected context',
        contextHide: 'Hide context',
        contextLoading: 'Reading context…',
        contextMissing: 'This context record has expired (DSH restarted, or newer requests replaced it).',
        contextSummary: 'This request',
        contextKind: 'Kind',
        contextMode: 'Mode',
        contextModel: 'Model',
        contextPosition: 'Reading position',
        contextImages: 'Attached images',
        contextNoImages: 'No images attached',
        contextChars: 'Document context',
        contextTokens: 'Estimated input',
        contextHistory: 'Conversation history',
        contextTrimmed: 'Context trimmed',
        contextBrief: 'Book brief',
        contextVision: 'Page images',
        contextPlanned: 'Extra pages planned',
        contextUsage: 'Token usage',
        contextDuration: 'Duration',
        contextCopyAll: 'Copy all context',
        contextCopied: 'Context copied',
        contextSystem: 'System prompt',
        contextUser: 'User message',
        contextImagePage: 'Page {n}',
        contextImageCrop: 'Page {n} selection',
        contextImageCurrent: 'current page',
        contextStatus: 'Status',
        contextStatusStreaming: 'Generating',
        contextStatusDone: 'Completed',
        contextStatusError: 'Failed',
        contextStatusAborted: 'Stopped',
        contextYes: 'Yes',
        contextNo: 'No',
        contextOverviewInjected: 'Injected',
        contextOverviewNo: 'Not injected',
        usageInput: 'Input',
        usageOutput: 'Output',
        usageReasoning: 'Reasoning',
        errorPrefix: 'Something went wrong',
        retry: 'Retry',
        translateTitle: 'Contextual translation',
        translateSub: 'Select text in the document to translate it',
        targetLanguage: 'Translate to',
        emptyTranslateTitle: 'Select a passage in the document',
        emptyTranslateDesc: 'The translation appears here and keeps the paragraph and list structure.',
        translating: 'Translating…',
        translationFailed: 'Translation failed',
        source: 'Source',
        result: 'Translation',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        clearTranslations: 'Clear translations',
        retranslate: 'Translate again',
        selectionTranslate: 'Translate',
        selectionAsk: 'Ask',
        selectionExplain: 'Explain',
        quoteRegion: 'Selected region',
        selectionTooLong: 'The selection is long; only the first 8,000 characters were used.',
        pageOf: '{current} / {total}',
        selectionLabel: '{n} characters selected',
        parseError: 'Could not open document',
        fileNotFound: 'The file is missing or unreadable.',
        closePanel: 'Hide side panel',
        openPanel: 'Show Q&A',
        more: 'More',
        loginTitle: 'Document cache expired',
        loginDesc: 'Reopen the file to continue.',
        jumpPosition: 'Jump to reading position',
        toastOpenFailed: 'Could not open',
        restoreFailed: 'The last document could not be reopened.',
        sortHint: 'Click a folder to enter it',
        quickNav: 'Quick links',
        pageCount: '{n} reading units',
        chars: '{n} characters',
        modelLabel: 'Model',
        note: 'Speaker notes',
        you: 'You',
        crashTitle: 'The study page hit a problem',
        crashDesc: 'Rendering stopped. Refresh the page to reopen the document; if it keeps happening, send the browser console error to the plugin author.',
        reloadPage: 'Refresh page',
        backToChat: 'Back to chat',
        pdfjsUnavailable: 'The selectable original-view component could not load. Refresh the page or restart DSH and try again; the native PDF viewer is used in the meantime.',
        pdfRenderFailed: 'Could not render the original view',
        prevPage: 'Previous page',
        nextPage: 'Next page',
        pageInput: 'Page number',
        pdfSelectionHint: 'Drag to select text; hold Ctrl (⌘ on Mac) and drag to quote a page region as an image.',
        originalNewTab: 'Open original in a new tab',
        pdfPageOf: 'Page {current} / {total}',
        pdfPageLabel: 'Page {n}',
        pdfPages: '{n} pages',
        originalOnlyTitle: 'No original view available',
        originalOnlyDesc: 'This reader shows original page layout only. Open a PDF, or a Word / PowerPoint file that can be converted to PDF.',
        pageMode: 'Page mode',
        singlePage: 'Single page',
        continuousPages: 'Continuous',
        pdfLoadingPage: 'Rendering page…',
      },
    }

    const CSS = String.raw`
.dsr-root{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:var(--dsh-font-family-content,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:var(--dsh-content-font-size,14px);-webkit-font-smoothing:antialiased;color-scheme:light}
body[data-ds-dark-theme] .dsr-root{color-scheme:dark}
.dsr-root option{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsr-root *,.dsr-root *::before,.dsr-root *::after{box-sizing:border-box}
.dsr-root :where(button,input,textarea,select){font:inherit;color:inherit}
.dsr-root ::selection{background:var(--dsw-alias-bg-document-selection,rgba(59,130,246,.38))}
.dsr-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsr-header{flex:none;position:relative;display:flex;align-items:center;gap:18px;height:62px;padding:0 22px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);z-index:8}
.dsr-brand{display:flex;align-items:center;gap:10px;flex:none;min-width:0}
.dsr-brand-mark{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base));flex:none;box-shadow:0 4px 14px color-mix(in srgb,var(--dsw-alias-brand-primary) 25%,transparent)}
.dsr-brand-text{display:flex;flex-direction:column;line-height:1.15;min-width:0}
.dsr-brand-name{font-size:14px;font-weight:650;letter-spacing:.01em}
.dsr-brand-tag{font-size:10px;color:var(--dsw-alias-label-secondary);letter-spacing:.06em;white-space:nowrap}
.dsr-header-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding-left:18px;border-left:1px solid var(--dsw-alias-border-l1)}
.dsr-doc-title{font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.35}
.dsr-doc-meta{display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.dsr-doc-meta .dsr-file-icon{width:16px;height:16px;border-radius:4px;font-size:6.5px}
.dsr-doc-path{overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;opacity:.8;min-width:0}
.dsr-extracting{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsr-header-actions{display:flex;align-items:center;gap:7px;flex:none}
.dsr-progress-track{position:absolute;left:0;right:0;bottom:-1px;height:2px;background:transparent;overflow:hidden}
.dsr-progress-fill{height:100%;background:var(--dsw-alias-brand-primary);transition:width .18s ease}
.dsr-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:31px;padding:0 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:520;cursor:pointer;white-space:nowrap;transition:background .14s,border-color .14s,transform .1s}
.dsr-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--dsw-alias-bg-base));border-color:var(--dsw-alias-border-l2)}
.dsr-btn:active{transform:translateY(1px)}
.dsr-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.dsr-btn-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.dsr-btn-primary:hover{filter:brightness(.93);border-color:transparent}
.dsr-btn-quiet{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.dsr-btn-quiet:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}
.dsr-icon-btn{appearance:none;width:31px;height:31px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .14s,color .14s}
.dsr-icon-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent);color:var(--dsw-alias-label-primary)}
.dsr-icon-btn.is-active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-brand-primary)}
.dsr-icon-btn:disabled{opacity:.4;cursor:not-allowed}
.dsr-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.dsr-seg-btn{appearance:none;height:25px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:550;cursor:pointer;white-space:nowrap}
.dsr-seg-btn:hover{color:var(--dsw-alias-label-primary)}
.dsr-seg-btn.on{background:var(--dsw-alias-button-ghost-active-fill,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
.dsr-body{flex:1;min-height:0;display:flex;position:relative}
.dsr-reader-col{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-base)}
.dsr-scroll{flex:1;min-height:0;overflow:auto;scroll-behavior:smooth;overscroll-behavior:contain;position:relative}
.dsr-doc{max-width:860px;margin:0 auto;padding:34px 36px 140px}
.dsr-page{position:relative;margin:0 0 26px;scroll-margin-top:22px}
.dsr-page-label{display:flex;align-items:center;gap:9px;margin:0 0 8px;padding:0 2px;font-size:10.5px;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.dsr-page-label::after{content:"";height:1px;flex:1;background:color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent)}
.dsr-page-title{margin-left:6px;letter-spacing:0;text-transform:none;font-weight:500;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
.dsr-paper{position:relative;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:34px 42px 38px;box-shadow:0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent);overflow-wrap:anywhere}
.dsr-b{position:relative}
.dsr-h{font-weight:650;line-height:1.35;color:var(--dsw-alias-label-primary);scroll-margin-top:24px}
h1.dsr-h{font-size:24px;margin:8px 0 16px;letter-spacing:-.01em}
h2.dsr-h{font-size:20px;margin:25px 0 11px;letter-spacing:-.005em}
h3.dsr-h{font-size:16.5px;margin:21px 0 9px}
.dsr-p{margin:0 0 14px;line-height:1.82;color:var(--dsw-alias-label-primary);text-wrap:pretty}
.dsr-p:last-child{margin-bottom:0}
.dsr-li{display:flex;gap:10px;margin:0 0 9px;line-height:1.75}
.dsr-li-dot{flex:none;width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary);margin-top:.7em;opacity:.8}
.dsr-table-wrap{width:100%;overflow-x:auto;margin:4px 0 18px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px}
.dsr-table{border-collapse:collapse;width:100%;min-width:360px;font-size:12.5px;line-height:1.6}
.dsr-table td,.dsr-table th{border-bottom:1px solid var(--dsw-alias-border-l1);border-right:1px solid var(--dsw-alias-border-l1);padding:8px 10px;text-align:left;vertical-align:top}
.dsr-table tr:last-child td{border-bottom:0}
.dsr-table td:last-child,.dsr-table th:last-child{border-right:0}
.dsr-table tr:nth-child(even) td{background:color-mix(in srgb,var(--dsw-alias-label-primary) 2.5%,transparent)}
.dsr-note{margin:0 0 16px;padding:11px 14px;border-left:2px solid var(--dsw-alias-state-warn-primary);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent);font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary)}
.dsr-note-label{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-state-warn-primary);display:block;margin-bottom:2px}
.dsr-code{margin:0 0 16px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:var(--dsh-code-font-size,12px);line-height:1.65;overflow:auto;white-space:pre}
.dsr-quote{margin:0 0 15px;padding:2px 0 2px 14px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);line-height:1.75;font-style:italic}
.dsr-warnings{max-width:860px;margin:18px auto 0;padding:0 36px}
.dsr-original-warnings{flex:none;max-height:112px;overflow:auto;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 5%,var(--dsw-alias-bg-layer-1))}
.dsr-original-warnings .dsr-warning{margin:0 0 4px;padding:6px 8px;font-size:10.5px}
.dsr-original-warnings .dsr-warning:last-child{margin-bottom:0}
.dsr-warning{display:flex;gap:8px;align-items:flex-start;padding:9px 12px;margin:0 0 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 35%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-secondary);border-radius:8px;font-size:11.5px;line-height:1.55}
.dsr-warning svg{flex:none;margin-top:1px;color:var(--dsw-alias-state-warn-primary)}
.dsr-empty-doc{max-width:660px;margin:12vh auto 0;text-align:center;padding:0 24px}
.dsr-empty-doc-icon{width:58px;height:58px;margin:0 auto 16px;border-radius:16px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.dsr-empty-doc h2{font-size:17px;margin:0 0 6px}
.dsr-empty-doc p{font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary);margin:0 auto 18px;max-width:440px}
.dsr-side{flex:none;width:382px;min-height:0;display:flex;flex-direction:column;border-left:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);position:relative;z-index:6}
.dsr-side-head{flex:none;display:flex;align-items:center;gap:8px;padding:14px 14px 0}
.dsr-side-title{font-size:13px;font-weight:650;flex:1;min-width:0;overflow:hidden}
.dsr-side-title small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsr-side-title small{display:block;font-weight:450;color:var(--dsw-alias-label-secondary);font-size:10.5px;margin-top:2px}
.dsr-tabs{display:flex;gap:2px;padding:10px 14px 0;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsr-tab{appearance:none;position:relative;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:550;padding:8px 10px 10px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.dsr-tab:hover{color:var(--dsw-alias-label-primary)}
.dsr-tab.on{color:var(--dsw-alias-label-primary)}
.dsr-tab.on::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary)}
.dsr-count{font-size:9.5px;min-width:15px;height:15px;padding:0 4px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsr-mode-box{flex:none;padding:11px 14px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.dsr-mode-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsr-mode-label{font-size:10.5px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em}
.dsr-mode-desc{font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);margin:7px 0 0;padding-left:1px}
.dsr-side-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.dsr-chat-list{padding:14px}
.dsr-msg{display:flex;flex-direction:column;margin-bottom:14px;animation:dsr-in .16s ease both}
@keyframes dsr-in{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.dsr-msg-user{align-items:flex-end}
.dsr-msg-assistant{align-items:flex-start}
.dsr-msg-bubble{max-width:94%;padding:10px 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-size:12.5px;line-height:1.72;overflow-wrap:anywhere}
.dsr-msg-status{margin-top:7px;font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsr-msg-pages{margin-top:9px;padding-top:6px;border-top:1px solid var(--dsw-alias-border-l1);font-size:9.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsr-msg-user .dsr-msg-bubble{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,var(--dsw-alias-bg-base));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,var(--dsw-alias-border-l1));max-width:90%}
.dsr-msg-meta{display:flex;align-items:center;gap:6px;margin:0 3px 5px;font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.dsr-msg-user .dsr-msg-meta{flex-direction:row-reverse}
.dsr-msg-mode{font-size:9px;padding:1px 6px;border-radius:99px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsr-quote-chip{position:relative;margin:0 0 10px;padding:8px 10px 8px 11px;border-left:2px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);border-radius:0 6px 6px 0;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:130px;overflow:auto}
.dsr-quote-chip .dsr-quote-label{display:block;font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-brand-primary);margin-bottom:2px}
.dsr-md{font-size:12.5px;line-height:1.72;overflow-wrap:anywhere}
.dsr-md > :first-child{margin-top:0}
.dsr-md > :last-child{margin-bottom:0}
.dsr-md p{margin:0 0 9px}
.dsr-md h1,.dsr-md h2,.dsr-md h3,.dsr-md h4{font-weight:650;line-height:1.35;margin:14px 0 6px}
.dsr-md h1{font-size:15.5px}.dsr-md h2{font-size:14.5px}.dsr-md h3,.dsr-md h4{font-size:13px}
.dsr-md ul,.dsr-md ol{margin:0 0 9px;padding-left:18px}
.dsr-md li{margin:0 0 4px;line-height:1.65}
.dsr-md blockquote{margin:0 0 9px;padding:1px 0 1px 10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dsr-md code{font-family:var(--dsh-font-family-code,ui-monospace,Consolas,monospace);font-size:.92em;padding:1px 4px;border-radius:4px;background:var(--dsw-alias-bg-layer-2)}
.dsr-md pre{margin:0 0 10px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);overflow:auto;font-size:11px;line-height:1.6}
.dsr-md pre code{padding:0;background:transparent}
.dsr-md a{color:var(--dsw-alias-brand-primary);text-decoration:underline;text-underline-offset:2px}
.dsr-md hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:12px 0}
.dsr-md table{border-collapse:collapse;width:100%;margin:0 0 10px;font-size:11.5px}
.dsr-md td,.dsr-md th{border:1px solid var(--dsw-alias-border-l1);padding:5px 7px;text-align:left;vertical-align:top}
.dsr-cite{display:inline-block;padding:0 4px;margin:0 1px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-brand-primary);font-size:10.5px;font-weight:550;white-space:nowrap}
.dsr-ahead{margin:10px 0 0;padding:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,var(--dsw-alias-border-l1));border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,var(--dsw-alias-bg-layer-1));font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.dsr-ahead-head{display:flex;align-items:center;gap:5px;font-weight:650;color:var(--dsw-alias-brand-primary);margin-bottom:3px;font-size:11px}
.dsr-ahead p{margin:0 0 7px}
.dsr-ahead .dsr-btn{height:26px;font-size:10.5px;padding:0 9px;background:var(--dsw-alias-bg-layer-1)}
.dsr-typing{display:inline-flex;gap:3px;align-items:center;padding:3px 0}
.dsr-typing i{width:4px;height:4px;border-radius:50%;background:var(--dsw-alias-label-secondary);animation:dsr-bounce 1s infinite ease-in-out}
.dsr-typing i:nth-child(2){animation-delay:.15s}.dsr-typing i:nth-child(3){animation-delay:.3s}
@keyframes dsr-bounce{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-3px);opacity:1}}
.dsr-error-box{margin-top:7px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);border-radius:6px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.55}
.dsr-fold{margin-top:9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.dsr-fold:first-child{margin-top:0}
.dsr-fold-head{width:100%;appearance:none;border:0;background:transparent;display:flex;align-items:center;gap:6px;padding:7px 9px;font-size:10.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;text-align:left}
.dsr-fold-head:hover{background:var(--dsw-alias-bg-layer-2)}
.dsr-fold-title{font-size:10.5px;font-weight:620;color:var(--dsw-alias-label-primary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsr-fold-meta{margin-left:auto;font-size:9.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;opacity:.85}
.dsr-fold-caret{display:flex;align-items:center;color:var(--dsw-alias-label-secondary);transition:transform .12s ease;flex:none}
.dsr-fold-head.is-open .dsr-fold-caret{transform:rotate(90deg)}
.dsr-fold-body{border-top:1px solid var(--dsw-alias-border-l1);padding:9px 10px;background:var(--dsw-alias-bg-base)}
.dsr-reasoning .dsr-fold-body{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 3%,var(--dsw-alias-bg-base))}
.dsr-reasoning-body{white-space:pre-wrap;font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary);max-height:260px;overflow:auto;overflow-wrap:anywhere}
.dsr-fold-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:6px}
.dsr-ctx-note{display:flex;align-items:center;gap:6px;font-size:10.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);padding:3px 0}
.dsr-ctx-note.dsr-ctx-error{justify-content:space-between;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 25%,var(--dsw-alias-border-l1));border-radius:6px;padding:7px 8px;gap:10px}
.dsr-ctx-section-title{font-size:8.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:10px 0 5px;opacity:.85}
.dsr-ctx-section-title:first-child{margin-top:0}
.dsr-ctx-grid{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;font-size:10.5px;line-height:1.5}
.dsr-ctx-label{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsr-ctx-value{color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;min-width:0}
.dsr-ctx-images{display:flex;gap:8px;overflow-x:auto;padding:1px 0 3px}
.dsr-ctx-image{flex:none;width:138px;display:flex;flex-direction:column;gap:3px;text-decoration:none;color:inherit;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:4px;background:var(--dsw-alias-bg-layer-2)}
.dsr-ctx-image:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.dsr-ctx-image img{display:block;width:100%;height:104px;object-fit:contain;border-radius:4px;background:var(--dsw-alias-bg-base)}
.dsr-ctx-image-label{font-size:9.5px;line-height:1.35;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsr-ctx-image-meta{font-size:8.5px;line-height:1.3;color:var(--dsw-alias-label-secondary);opacity:.75}
.dsr-ctx-tabs{display:flex;gap:2px;margin:10px 0 6px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsr-ctx-tab{appearance:none;border:0;background:transparent;padding:4px 8px;font-size:10px;color:var(--dsw-alias-label-secondary);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.dsr-ctx-tab:hover{color:var(--dsw-alias-label-primary)}
.dsr-ctx-tab.on{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.dsr-ctx-text{margin:0;padding:8px 9px;max-height:280px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--dsh-font-family-code,ui-monospace,Consolas,monospace);font-size:10px;line-height:1.55;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-secondary)}
.dsr-empty-chat{text-align:center;padding:30px 22px 20px;color:var(--dsw-alias-label-secondary)}
.dsr-empty-chat-icon{width:40px;height:40px;margin:0 auto 10px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.dsr-empty-chat h3{font-size:12.5px;margin:0 0 5px;color:var(--dsw-alias-label-primary)}
.dsr-empty-chat p{font-size:11px;line-height:1.65;margin:0 auto;max-width:260px}
.dsr-empty-chat .dsr-mode-hint{margin-top:10px;padding:8px 10px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:10.5px;text-align:left;border:1px solid var(--dsw-alias-border-l1)}
.dsr-composer{flex:none;padding:10px 12px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsr-composer-box{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);padding:8px 9px 7px;transition:border-color .15s,box-shadow .15s}
.dsr-composer-box:focus-within{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.dsr-composer-box textarea{display:block;width:100%;min-height:36px;max-height:170px;resize:none;border:0;outline:0;background:transparent;font-size:12.5px;line-height:1.6;padding:1px 2px;color:var(--dsw-alias-label-primary)}
.dsr-composer-box textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8}
.dsr-composer-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:5px}
.dsr-composer-hint{font-size:9.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsr-send{appearance:none;width:27px;height:27px;border-radius:7px;border:0;display:inline-flex;align-items:center;justify-content:center;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base));cursor:pointer;flex:none}
.dsr-send:hover{filter:brightness(.93)}
.dsr-send:disabled{opacity:.35;cursor:not-allowed}
.dsr-composer .dsr-quote-chip{position:relative;margin-bottom:7px}
.dsr-quote-remove{position:absolute;top:4px;right:4px;width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer}
.dsr-quote-remove:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsr-translate-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsr-translate-head label{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.dsr-select{appearance:auto;height:28px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);font-size:11px;color:var(--dsw-alias-label-primary);cursor:pointer;max-width:180px}
.dsr-translate-list{padding:12px}
.dsr-trans-card{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);margin:0 0 10px;overflow:hidden}
.dsr-trans-card-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);font-size:10px;color:var(--dsw-alias-label-secondary)}
.dsr-trans-card-head .dsr-lang-badge{font-size:9px;padding:1px 5px;border-radius:99px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.dsr-trans-card-body{padding:9px 10px 10px}
.dsr-trans-source{margin:0 0 8px;padding-left:8px;border-left:1px solid var(--dsw-alias-border-l2);font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:120px;overflow:auto}
.dsr-trans-result{font-size:12.5px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
.dsr-trans-actions{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:7px}
.dsr-mini-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;padding:3px 6px;border-radius:5px;display:inline-flex;align-items:center;gap:3px;cursor:pointer}
.dsr-mini-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsr-trans-status{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:6px}
.dsr-spinner{width:12px;height:12px;border:1.5px solid color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:dsr-spin .8s linear infinite;display:inline-block;flex:none}
@keyframes dsr-spin{to{transform:rotate(360deg)}}
.dsr-selection{position:fixed;z-index:1200;display:flex;align-items:center;gap:2px;max-width:calc(100vw - 16px);overflow-x:auto;padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-overlay);box-shadow:0 10px 30px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);backdrop-filter:blur(10px);animation:dsr-pop .12s ease both}
@keyframes dsr-pop{from{opacity:0;transform:translate(-50%,4px)}to{opacity:1;transform:translate(-50%,0)}}
.dsr-selection-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-primary);height:26px;padding:0 8px;border-radius:6px;font-size:11px;font-weight:530;display:inline-flex;align-items:center;gap:4px;cursor:pointer;white-space:nowrap}
.dsr-selection-btn:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent)}
.dsr-selection-btn.primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base))}
.dsr-selection-btn.primary:hover{filter:brightness(.93)}
.dsr-selection-sep{width:1px;height:17px;background:var(--dsw-alias-border-l1);margin:0 2px}
.dsr-selection select{appearance:none;height:26px;border:0;border-radius:6px;background:transparent;font-size:10.5px;color:var(--dsw-alias-label-primary);max-width:82px;padding:0 4px;cursor:pointer}
.dsr-selection select:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-primary)}
.dsr-modal-layer{position:fixed;inset:0;z-index:1400;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 34%,transparent);backdrop-filter:blur(3px);animation:dsr-fade .15s ease both}
@keyframes dsr-fade{from{opacity:0}to{opacity:1}}
.dsr-modal{width:min(900px,94vw);height:min(640px,88vh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 26px 70px color-mix(in srgb,var(--dsw-alias-label-primary) 30%,transparent);overflow:hidden;animation:dsr-modal-in .16s ease both}
@keyframes dsr-modal-in{from{opacity:0;transform:scale(.985) translateY(4px)}to{opacity:1;transform:none}}
.dsr-modal-head{flex:none;display:flex;align-items:flex-start;gap:12px;padding:17px 18px 13px}
.dsr-modal-head h2{font-size:15px;margin:0 0 3px;font-weight:650}
.dsr-modal-head p{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin:0;max-width:680px}
.dsr-modal-head .dsr-icon-btn{margin-left:auto}
.dsr-pathbar{flex:none;display:flex;align-items:center;gap:6px;padding:9px 14px;border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dsr-path-input{flex:1;min-width:0;height:28px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);padding:0 8px;font-size:11px;outline:0}
.dsr-path-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsr-modal-body{flex:1;min-height:0;display:flex}
.dsr-modal-side{flex:none;width:168px;border-right:1px solid var(--dsw-alias-border-l1);padding:12px 10px;overflow-y:auto;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 48%,transparent)}
.dsr-side-label{font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);padding:0 4px;margin:0 0 6px}
.dsr-quick{display:flex;flex-direction:column;gap:2px;margin-bottom:13px}
.dsr-quick button{appearance:none;border:0;border-radius:6px;background:transparent;text-align:left;padding:6px 7px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;display:flex;align-items:center;gap:6px}
.dsr-quick button:hover{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsr-recent-mini{display:flex;flex-direction:column;gap:1px}
.dsr-recent-mini button{appearance:none;border:0;background:transparent;text-align:left;padding:6px 7px;border-radius:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsr-recent-mini button:hover{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
.dsr-recent-mini .dsr-recent-empty{font-size:10px;padding:6px 7px;color:var(--dsw-alias-label-secondary);opacity:.65;line-height:1.5}
.dsr-modal-list{flex:1;min-width:0;display:flex;flex-direction:column}
.dsr-crumbs{flex:none;display:flex;align-items:center;gap:1px;padding:8px 14px;overflow-x:auto;white-space:nowrap;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsr-crumb{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10.5px;padding:2px 4px;border-radius:4px;cursor:pointer;flex:none}
.dsr-crumb:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsr-crumb-sep{color:var(--dsw-alias-label-secondary);opacity:.5;font-size:10px;flex:none}
.dsr-file-list{flex:1;overflow-y:auto;padding:6px 8px 14px}
.dsr-file-row{width:100%;appearance:none;border:1px solid transparent;border-radius:7px;background:transparent;display:flex;align-items:center;gap:10px;padding:7px 8px;text-align:left;cursor:pointer;min-height:39px;color:var(--dsw-alias-label-primary)}
.dsr-file-row:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}
.dsr-file-row:disabled{cursor:default;opacity:.45}
.dsr-file-row.is-busy{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 20%,transparent)}
.dsr-file-icon{flex:none;width:25px;height:25px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:750;letter-spacing:.02em;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsr-file-icon.pdf{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 28%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
.dsr-file-icon.word{color:var(--dsw-alias-brand-primary);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}
.dsr-file-icon.ppt{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 28%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 7%,transparent)}
.dsr-file-icon.md{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 7%,transparent)}
.dsr-file-main{flex:1;min-width:0}
.dsr-file-name{display:block;font-size:11.5px;font-weight:520;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsr-file-sub{display:block;font-size:9.5px;color:var(--dsw-alias-label-secondary);margin-top:1px}
.dsr-file-right{flex:none;display:flex;align-items:center;gap:5px;color:var(--dsw-alias-label-secondary);font-size:9.5px}
.dsr-file-empty{padding:42px 20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.6}
.dsr-modal-foot{flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.dsr-modal-foot .dsr-path-input{height:30px}
.dsr-inline-error{display:flex;gap:6px;align-items:flex-start;margin:8px 14px 0;padding:7px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1));border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.dsr-hero{max-width:860px;margin:0 auto;padding:56px 38px 80px;display:flex;flex-direction:column;align-items:flex-start}
.dsr-hero-kicker{display:inline-flex;align-items:center;gap:6px;font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-brand-primary);margin-bottom:13px;font-weight:650}
.dsr-hero h1{font-size:34px;line-height:1.18;letter-spacing:-.025em;margin:0 0 13px;max-width:620px;font-weight:680}
.dsr-hero p.lead{font-size:13.5px;line-height:1.75;color:var(--dsw-alias-label-secondary);margin:0 0 22px;max-width:610px}
.dsr-hero-actions{display:flex;align-items:center;gap:8px;margin-bottom:32px;flex-wrap:wrap}
.dsr-hero-actions .dsr-btn{height:36px;padding:0 15px;font-size:12.5px}
.dsr-hero-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;width:100%;margin-bottom:26px}
.dsr-hero-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 14px 13px;background:var(--dsw-alias-bg-layer-1);min-height:116px}
.dsr-hero-card-icon{width:27px;height:27px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);color:var(--dsw-alias-brand-primary);display:flex;align-items:center;justify-content:center;margin-bottom:9px}
.dsr-hero-card h3{font-size:11.5px;margin:0 0 4px;font-weight:650}
.dsr-hero-card p{font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0}
.dsr-hero-recent{width:100%;border-top:1px solid var(--dsw-alias-border-l1);padding-top:18px}
.dsr-hero-recent h3{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin:0 0 8px;font-weight:600}
.dsr-hero-recent-list{display:flex;flex-direction:column;gap:2px;max-width:640px}
.dsr-hero-recent-row{appearance:none;border:1px solid transparent;border-radius:7px;background:transparent;display:flex;align-items:center;gap:9px;padding:7px 8px;text-align:left;cursor:pointer;color:var(--dsw-alias-label-primary)}
.dsr-hero-recent-row:hover{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
.dsr-hero-recent-row .dsr-file-main{display:flex;align-items:baseline;gap:8px}
.dsr-hero-recent-row .dsr-file-name{font-size:11.5px;max-width:70%}
.dsr-supported{font-size:10px;color:var(--dsw-alias-label-secondary);letter-spacing:.02em;margin-top:4px}
.dsr-restore{appearance:none;background:transparent;border:0;color:var(--dsw-alias-label-secondary);font-size:10.5px;text-decoration:underline;text-underline-offset:2px;cursor:pointer;padding:0}
.dsr-restore:hover{color:var(--dsw-alias-label-primary)}
.dsr-toc-layer{position:fixed;inset:0;z-index:1100}
.dsr-toc{position:absolute;top:60px;right:22px;width:min(330px,calc(100vw - 40px));max-height:min(520px,70vh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 16px 45px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);overflow:hidden;animation:dsr-pop2 .13s ease both}
@keyframes dsr-pop2{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.dsr-toc-head{flex:none;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11px;font-weight:650}
.dsr-toc-heading{display:flex;align-items:baseline;gap:7px;min-width:0}
.dsr-toc-sub{font-size:9.5px;font-weight:400;opacity:.55;white-space:nowrap}
.dsr-toc-brief{flex:none;height:24px;padding:0 9px;font-size:10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;margin-left:auto;margin-right:6px}
.dsr-toc-brief:hover{background:var(--dsw-alias-bg-layer-2)}
.dsr-toc-list{overflow-y:auto;padding:6px 5px 8px}
.dsr-toc-row{display:flex;align-items:center;gap:2px;margin-top:4px}
.dsr-toc-caret{flex:none;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer;align-self:center}
.dsr-toc-caret svg{transition:transform .12s ease}
.dsr-toc-row.is-open .dsr-toc-caret svg{transform:rotate(90deg)}
.dsr-toc-caret:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsr-toc-caret.is-empty{visibility:hidden;pointer-events:none}
.dsr-toc-item{width:100%;appearance:none;border:0;background:transparent;text-align:left;border-radius:5px;padding:5px 8px;font-size:11px;line-height:1.45;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;gap:7px;align-items:baseline}
.dsr-toc-row .dsr-toc-item{width:auto;flex:1;min-width:0;padding-left:2px}
.dsr-toc-chapter{font-weight:650}
.dsr-toc-item[data-level="1"]{font-weight:650;margin-top:4px}
.dsr-toc-item[data-level="3"]{font-size:10.5px;opacity:.86}
.dsr-toc-item:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsr-toc-item .dsr-toc-page{flex:none;font-size:9px;opacity:.65;margin-left:auto;white-space:nowrap}
.dsr-toc-empty{padding:22px 12px;text-align:center;font-size:11px;color:var(--dsw-alias-label-primary);line-height:1.6}
.dsr-modal-narrow{width:min(620px,94vw);height:auto;max-height:88vh}
.dsr-diag-body{flex:1;min-height:0;overflow-y:auto;padding:0 18px 14px;display:flex;flex-direction:column}
.dsr-diag-row{display:flex;gap:12px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:11.5px;line-height:1.45}
.dsr-diag-row:last-child{border-bottom:0}
.dsr-diag-label{flex:none;width:96px;color:var(--dsw-alias-label-secondary)}
.dsr-diag-value{flex:1;min-width:0;word-break:break-all;color:var(--dsw-alias-label-primary)}
.dsr-search-layer{position:fixed;inset:0;z-index:1100}
.dsr-search{position:absolute;top:60px;right:22px;width:min(420px,calc(100vw - 40px));max-height:min(560px,72vh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 16px 45px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent);overflow:hidden;animation:dsr-pop2 .13s ease both}
.dsr-search-head{flex:none;display:flex;align-items:center;gap:7px;padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dsr-search-input{flex:1;min-width:0;height:28px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px}
.dsr-search-meta{flex:none;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:10px;color:var(--dsw-alias-label-secondary)}
.dsr-search-list{overflow-y:auto;padding:4px 5px 6px}
.dsr-search-result{width:100%;display:flex;align-items:baseline;gap:8px;border:0;background:transparent;border-radius:5px;padding:6px 8px;text-align:left;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer}
.dsr-search-result:hover,.dsr-search-result.is-active{background:var(--dsw-alias-bg-layer-2)}
.dsr-search-snippet{flex:1;min-width:0;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.dsr-search-snippet mark{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent);color:inherit;border-radius:2px;padding:0 1px}
.dsr-search-page{flex:none;font-size:9px;opacity:.65;margin-left:auto;white-space:nowrap}
.dsr-original{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2)}
.dsr-original-bar{flex:none;display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:10.5px;color:var(--dsw-alias-label-secondary);min-height:42px;overflow-x:auto;scrollbar-width:none}
.dsr-original-bar::-webkit-scrollbar{display:none}
.dsr-original-bar .dsr-btn{height:26px;font-size:10.5px}
.dsr-original-hint{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:4px}
.dsr-engine{flex:none;padding:1px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;font-size:9.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsr-engine.is-fallback{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 45%,var(--dsw-alias-border-l1))}
.dsr-pdf-pager{display:flex;align-items:center;gap:3px;flex:none}
.dsr-pdf-page-input{width:42px;height:25px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:10.5px;text-align:center;outline:0;padding:0 2px}
.dsr-pdf-page-input:focus{border-color:var(--dsw-alias-brand-primary)}
.dsr-pdf-count{font-variant-numeric:tabular-nums;white-space:nowrap;padding:0 3px}
.dsr-pdf-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:20px 16px 34px;background:var(--dsw-alias-bg-layer-2)}
.dsr-pdf-scroll.dsr-selecting-region{cursor:crosshair;user-select:none;touch-action:none}
.dsr-pdf-scroll.dsr-selecting-region .dsr-pdf-page,.dsr-pdf-scroll.dsr-selecting-region .dsr-pdf-textLayer{cursor:crosshair;user-select:none}
.dsr-region-box{position:fixed;z-index:1300;border:1.5px solid var(--dsw-alias-brand-primary);border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent) inset;pointer-events:none}
.dsr-pdf-stage{min-height:100%;display:flex;justify-content:center;align-items:flex-start}
.dsr-pdf-mode{display:inline-flex;align-items:center;gap:2px;flex:none;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2)}
.dsr-pdf-mode .dsr-seg-btn{height:22px;padding:0 8px;font-size:10.5px}
.dsr-pdf-flow{min-height:100%;display:flex;flex-direction:column;align-items:center;gap:16px;padding:0 0 12px}
.dsr-pdf-page-block{position:relative;display:flex;flex-direction:column;align-items:flex-start;flex:none;scroll-margin-top:14px}
.dsr-pdf-page-no{font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary);margin:0 0 6px 2px;letter-spacing:.04em;user-select:none}
.dsr-pdf-page-block.is-current .dsr-pdf-page-no{color:var(--dsw-alias-brand-primary)}
.dsr-pdf-page-block.is-current .dsr-pdf-page{box-shadow:0 10px 34px color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}
.dsr-pdf-page-placeholder{position:absolute;inset:0;z-index:3;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;padding:20px;background:#fff;color:#3f4652;font-size:10.5px;line-height:1.5;text-align:center;pointer-events:none}
.dsr-pdf-page-placeholder .dsr-spinner{border-color:rgba(15,17,21,.16);border-top-color:#0f1115}
.dsr-pdf-page{position:relative;flex:none;background:#fff;color:#3f4652;box-shadow:0 8px 28px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);overflow:hidden;color-scheme:light}
.dsr-pdf-canvas{display:block;position:absolute;inset:0;width:100%;height:100%}
.dsr-pdf-textLayer{position:absolute;inset:0;overflow:clip;opacity:1;line-height:1;text-align:initial;letter-spacing:normal;word-spacing:normal;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;caret-color:CanvasText;z-index:2;--total-scale-factor:1;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
.dsr-pdf-textLayer span,.dsr-pdf-textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;user-select:text}
.dsr-pdf-textLayer > :not(.markedContent),.dsr-pdf-textLayer .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.dsr-pdf-textLayer .markedContent{display:contents}
.dsr-pdf-textLayer ::selection{background:var(--dsw-alias-bg-document-selection,rgba(59,130,246,.4));color:transparent}
.dsr-pdf-textLayer .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;user-select:none}
.dsr-pdf-busy{position:absolute;right:9px;top:9px;z-index:4;display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:99px;border:1px solid rgba(15,17,21,.12);background:rgba(248,249,250,.94);color:#3f4652;font-size:9.5px;box-shadow:0 3px 10px rgba(15,17,21,.14)}
.dsr-pdf-busy .dsr-spinner{border-color:rgba(15,17,21,.16);border-top-color:#0f1115}
.dsr-pdf-fallback{max-width:620px;margin:10vh auto 0;padding:22px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);text-align:center;color:var(--dsw-alias-label-secondary);font-size:11.5px;line-height:1.65}
.dsr-pdf-fallback h3{font-size:14px;margin:0 0 7px;color:var(--dsw-alias-label-primary)}
.dsr-pdf-fallback p{margin:0 0 13px}
.dsr-pdf-fallback .dsr-btn{height:29px;font-size:11px}
.dsr-original-loading{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:9px;color:var(--dsw-alias-label-secondary);font-size:11.5px;text-align:center;padding:30px}
.dsr-native-frame{flex:1;min-height:0;width:100%;border:0;background:var(--dsw-alias-bg-layer-2)}
.dsr-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:1600;padding:8px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:11.5px;box-shadow:0 8px 26px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);animation:dsr-toast-in .16s ease both}
.dsr-crash{max-width:560px;margin:14vh auto 0;padding:26px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);text-align:center}
.dsr-crash h2{font-size:16px;margin:0 0 8px}
.dsr-crash p{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);margin:0 0 16px;white-space:pre-wrap}
.dsr-crash pre{text-align:left;max-height:180px;overflow:auto;font-size:10.5px;padding:10px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);white-space:pre-wrap;color:var(--dsw-alias-label-secondary)}
@keyframes dsr-toast-in{from{opacity:0;transform:translate(-50%,4px)}to{opacity:1;transform:translate(-50%,0)}}
.dsr-overlay-loading{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 78%,transparent);backdrop-filter:blur(3px);font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.dsr-overlay-loading strong{font-size:12.5px;color:var(--dsw-alias-label-primary);font-weight:540}
.dsr-scrim{display:none}
.dsr-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:1240px){.dsr-side{width:350px}.dsr-doc{padding-left:26px;padding-right:26px}.dsr-warnings{padding-left:26px;padding-right:26px}}
@media (max-width:1080px){
  .dsr-side{position:absolute;top:0;right:0;bottom:0;width:min(390px,92vw);box-shadow:-18px 0 44px color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent)}
  .dsr-scrim{display:block;position:absolute;inset:0;z-index:5;background:color-mix(in srgb,var(--dsw-alias-label-primary) 28%,transparent);backdrop-filter:blur(1px)}
  .dsr-header{gap:10px;padding:0 14px}
  .dsr-header-main{padding-left:12px}
  .dsr-brand-tag{display:none}
  .dsr-hero-grid{grid-template-columns:1fr 1fr}
}
@media (max-width:760px){
  .dsr-header{height:56px;padding:0 10px;gap:7px}
  .dsr-brand-text{display:none}
  .dsr-header-main{padding-left:8px;border-left:0}
  .dsr-doc-title{font-size:12.5px}
  .dsr-doc-meta{font-size:9.5px}
  .dsr-header-actions{gap:3px}
  .dsr-header-actions .dsr-btn span{display:none}
  .dsr-header-actions .dsr-btn{padding:0 8px}
  .dsr-seg-btn{padding:0 7px}
  .dsr-doc{padding:18px 12px 100px}
  .dsr-paper{padding:22px 18px 26px;border-radius:9px}
  .dsr-page-label{font-size:9.5px}
  .dsr-warnings{padding-left:12px;padding-right:12px;margin-top:12px}
  .dsr-hero{padding:32px 18px 60px}
  .dsr-hero h1{font-size:27px}
  .dsr-hero-grid{grid-template-columns:1fr}
  .dsr-modal-layer{padding:0;align-items:stretch}
  .dsr-modal{width:100%;height:100%;border-radius:0;border:0}
  .dsr-modal-side{display:none}
  .dsr-modal-body{flex-direction:column}
  .dsr-side{width:min(100vw,390px)}
  .dsr-toc{right:10px;top:55px}
  .dsr-side-head{padding-top:10px}
  .dsr-header-main{min-width:0}
  .dsr-doc-path{display:none}
  .dsr-original-hint{display:none}
  .dsr-pdf-mode .dsr-seg-btn{padding:0 6px}
}
@media (prefers-reduced-motion:reduce){
  .dsr-root *,.dsr-root *::before,.dsr-root *::after{animation-duration:0.001ms!important;transition-duration:0.001ms!important;scroll-behavior:auto!important}
}
`

    // ── helpers ──────────────────────────────────────────────────────────────

    function tr(t, key, vars) {
      let value = t(key)
      if (vars !== undefined && value !== key) {
        for (const [name, replacement] of Object.entries(vars)) {
          value = value.split(`{${name}}`).join(String(replacement))
        }
      }
      return value
    }

    function cls(...values) {
      return values.filter(Boolean).join(' ')
    }

    function uid() {
      try {
        return globalThis.crypto?.randomUUID?.() ?? `m${Date.now()}${Math.random().toString(16).slice(2)}`
      } catch {
        return `m${Date.now()}${Math.random().toString(16).slice(2)}`
      }
    }

    const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const SEARCH_RESULT_LIMIT = 200

    /** Keep keyboard focus inside an open dialog and close it on Escape. */
    function useModalFocus(open, onClose, containerRef, initialFocusRef) {
      const closeRef = useRef(onClose)
      closeRef.current = onClose
      useEffect(() => {
        if (!open) return undefined
        const previous = document.activeElement
        const focusTarget = () => {
          const target = initialFocusRef?.current ?? containerRef.current?.querySelector(FOCUSABLE) ?? containerRef.current
          try { target?.focus?.() } catch { /* the dialog may have closed */ }
        }
        const timer = window.setTimeout(focusTarget, 0)
        const onKeyDown = event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeRef.current?.()
            return
          }
          if (event.key !== 'Tab') return
          const container = containerRef.current
          if (container === null || container === undefined) return
          const items = Array.from(container.querySelectorAll(FOCUSABLE)).filter(element => element.getClientRects().length > 0)
          if (items.length === 0) return
          const first = items[0]
          const last = items[items.length - 1]
          const outside = !container.contains(document.activeElement)
          if (event.shiftKey && (document.activeElement === first || outside)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && (document.activeElement === last || outside)) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
          window.clearTimeout(timer)
          document.removeEventListener('keydown', onKeyDown)
          if (previous !== null && previous !== undefined && typeof previous.focus === 'function') {
            try { previous.focus() } catch { /* focus target was removed */ }
          }
        }
      }, [open, containerRef, initialFocusRef])
    }

    /** Normalize a viewport rectangle into a 0..1 crop of one rendered page. */
    function cropForRect(pageElement, rect) {
      if (pageElement === null || pageElement === undefined) return undefined
      const pageRect = pageElement.getBoundingClientRect()
      if (!(pageRect.width > 0) || !(pageRect.height > 0)) return undefined
      const clamp = value => Math.min(1, Math.max(0, value))
      const x = clamp((rect.left - pageRect.left) / pageRect.width)
      const y = clamp((rect.top - pageRect.top) / pageRect.height)
      const right = clamp((rect.left + rect.width - pageRect.left) / pageRect.width)
      const bottom = clamp((rect.top + rect.height - pageRect.top) / pageRect.height)
      if (right - x < 0.002 || bottom - y < 0.002) return undefined
      return { x, y, width: right - x, height: bottom - y }
    }

    /**
     * Ctrl/⌘ + drag over a rendered page reports the rectangle as a crop
     * candidate. A plain drag still selects text, so the same selection bar
     * can quote either text or an image region.
     */
    function useRegionSelection(containerRef, enabled, onSelect) {
      const selectRef = useRef(onSelect)
      selectRef.current = onSelect
      useEffect(() => {
        const container = containerRef.current
        if (container === null || container === undefined || !enabled) return undefined
        let drag = null
        let box = null
        const boxElement = () => {
          if (box !== null) return box
          box = document.createElement('div')
          box.className = 'dsr-region-box'
          document.body.appendChild(box)
          return box
        }
        const removeBox = () => {
          if (box !== null) {
            box.remove()
            box = null
          }
        }
        const onPointerDown = event => {
          if (event.button !== 0) return
          // Plain drag keeps the browser's text selection; Ctrl/⌘ switches to
          // an image region quote.
          if (!event.ctrlKey && !event.metaKey) return
          const page = event.target instanceof Element ? event.target.closest('.dsr-pdf-page') : null
          if (page === null) return
          const pageNumber = Number(page.dataset.page)
          if (!Number.isInteger(pageNumber)) return
          event.preventDefault()
          try { window.getSelection()?.removeAllRanges() } catch { /* ignore */ }
          container.classList.add('dsr-selecting-region')
          drag = { page, pageNumber, startX: event.clientX, startY: event.clientY, moved: false }
          try { container.setPointerCapture(event.pointerId) } catch { /* ignore */ }
          const pageRect = page.getBoundingClientRect()
          const element = boxElement()
          element.style.left = `${Math.max(pageRect.left, event.clientX)}px`
          element.style.top = `${Math.max(pageRect.top, event.clientY)}px`
          element.style.width = '0px'
          element.style.height = '0px'
        }
        const onPointerMove = event => {
          if (drag === null) return
          const pageRect = drag.page.getBoundingClientRect()
          const x1 = Math.min(Math.max(drag.startX, pageRect.left), pageRect.right)
          const y1 = Math.min(Math.max(drag.startY, pageRect.top), pageRect.bottom)
          const x2 = Math.min(Math.max(event.clientX, pageRect.left), pageRect.right)
          const y2 = Math.min(Math.max(event.clientY, pageRect.top), pageRect.bottom)
          const width = Math.abs(x2 - x1)
          const height = Math.abs(y2 - y1)
          if (width > 4 || height > 4) drag.moved = true
          const element = boxElement()
          element.style.left = `${Math.min(x1, x2)}px`
          element.style.top = `${Math.min(y1, y2)}px`
          element.style.width = `${width}px`
          element.style.height = `${height}px`
        }
        const onPointerUp = event => {
          if (drag === null) return
          const current = drag
          drag = null
          removeBox()
          container.classList.remove('dsr-selecting-region')
          try { container.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
          if (!current.moved) return
          const pageRect = current.page.getBoundingClientRect()
          const x1 = Math.min(Math.max(current.startX, pageRect.left), pageRect.right)
          const y1 = Math.min(Math.max(current.startY, pageRect.top), pageRect.bottom)
          const x2 = Math.min(Math.max(event.clientX, pageRect.left), pageRect.right)
          const y2 = Math.min(Math.max(event.clientY, pageRect.top), pageRect.bottom)
          const left = Math.min(x1, x2)
          const top = Math.min(y1, y2)
          const width = Math.abs(x2 - x1)
          const height = Math.abs(y2 - y1)
          if (width < 8 || height < 8) return
          const rect = { left, top, width, height, right: left + width, bottom: top + height }
          const crop = cropForRect(current.page, rect)
          if (crop === undefined) return
          selectRef.current?.({ pageNumber: current.pageNumber, rect, crop })
        }
        const onCancel = () => {
          drag = null
          removeBox()
          container.classList.remove('dsr-selecting-region')
        }
        container.addEventListener('pointerdown', onPointerDown)
        container.addEventListener('pointermove', onPointerMove)
        container.addEventListener('pointerup', onPointerUp)
        container.addEventListener('pointercancel', onCancel)
        return () => {
          removeBox()
          container.removeEventListener('pointerdown', onPointerDown)
          container.removeEventListener('pointermove', onPointerMove)
          container.removeEventListener('pointerup', onPointerUp)
          container.removeEventListener('pointercancel', onCancel)
        }
      }, [containerRef, enabled])
    }

    /** Case-insensitive search over outline titles and extracted paragraphs. */
    function searchBlocks(doc, query) {
      const needle = String(query ?? '').trim().toLowerCase()
      if (needle === '' || doc === null) return []
      const results = []
      const push = (text, blockId, page, kind) => {
        const haystack = text.toLowerCase()
        const at = haystack.indexOf(needle)
        if (at < 0) return
        const start = Math.max(0, at - 36)
        const end = Math.min(text.length, at + needle.length + 52)
        results.push({
          blockId,
          page,
          label: doc.pages[page]?.label ?? '',
          kind,
          prefix: `${start > 0 ? '…' : ''}${text.slice(start, at)}`,
          match: text.slice(at, at + needle.length),
          suffix: `${text.slice(at + needle.length, end)}${end < text.length ? '…' : ''}`,
        })
      }
      // Outline titles are real text even when the page glyphs have no
      // ToUnicode mapping, so they make search useful for scanned/vector PDFs.
      for (const item of doc.toc ?? []) {
        push(item.title, item.blockId, item.page, 'toc')
        if (results.length >= SEARCH_RESULT_LIMIT) return results
      }
      for (const block of doc.blocks) {
        push(block.text, block.id, block.page, 'text')
        if (results.length >= SEARCH_RESULT_LIMIT) break
      }
      return results
    }

    function readStore(key, fallback) {
      try {
        const raw = localStorage.getItem(STORE_PREFIX + key)
        if (raw === null) return fallback
        return JSON.parse(raw)
      } catch {
        return fallback
      }
    }

    function writeStore(key, value) {
      try {
        if (value === undefined || value === null) localStorage.removeItem(STORE_PREFIX + key)
        else localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value))
      } catch {
        // Quota or private-mode failures must not break reading.
      }
    }

    function removeStore(key) {
      try { localStorage.removeItem(STORE_PREFIX + key) } catch { /* ignore */ }
    }

    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return ''
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`
      return `${(value / 1024 / 1024).toFixed(1)} MB`
    }

    function fileBadge(extension) {
      if (extension === 'pdf') return { label: 'PDF', cls: 'pdf' }
      if (extension === 'doc' || extension === 'docx') return { label: 'W', cls: 'word' }
      if (extension === 'ppt' || extension === 'pptx') return { label: 'P', cls: 'ppt' }
      if (extension === 'md' || extension === 'markdown') return { label: 'MD', cls: 'md' }
      return { label: 'TXT', cls: '' }
    }

    function pathName(path) {
      const normalized = String(path).replace(/[\\/]+$/, '')
      const parts = normalized.split(/[\\/]/)
      return parts[parts.length - 1] || normalized
    }

    function joinPath(base, name) {
      if (!base) return name
      const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/'
      return base.endsWith(separator) ? `${base}${name}` : `${base}${separator}${name}`
    }

    function extensionOf(path) {
      const name = pathName(path)
      const at = name.lastIndexOf('.')
      return at === -1 ? '' : name.slice(at + 1).toLowerCase()
    }

    async function apiGet(path) {
      const response = await fetch(`${APP_BASE}${path}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      const body = await response.json().catch(() => undefined)
      if (!response.ok || body === undefined || body.ok === false) {
        const message = body?.error?.message ?? `HTTP ${response.status}`
        throw new Error(message)
      }
      return body
    }

    async function apiPost(path, payload) {
      const response = await fetch(`${APP_BASE}${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'x-dsh-study': '1',
          accept: 'application/json, application/x-ndjson',
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => undefined)
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
      }
      return response
    }

    function contextQuery(docId, contextId) {
      return `/context?id=${encodeURIComponent(docId)}&entry=${encodeURIComponent(contextId)}`
    }

    function contextPath(docId, contextId, imageIndex, width) {
      const query = `id=${encodeURIComponent(docId)}&entry=${encodeURIComponent(contextId)}`
      if (imageIndex === undefined) return `${APP_BASE}/context?${query}`
      const size = Number.isFinite(Number(width)) && Number(width) > 0 ? `&w=${Math.round(Number(width))}` : ''
      return `${APP_BASE}/context-image?${query}&i=${encodeURIComponent(imageIndex)}${size}`
    }

    async function apiPageImage(docId, pageNumber, width, signal) {      const response = await fetch(
        `${APP_BASE}/page?id=${encodeURIComponent(docId)}&n=${encodeURIComponent(pageNumber)}&w=${encodeURIComponent(Math.round(width))}`,
        {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          signal,
          headers: { accept: 'image/jpeg,image/*' },
        },
      )
      if (!response.ok) {
        const body = await response.json().catch(() => undefined)
        throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
      }
      const imageWidth = Number(response.headers.get('x-page-width'))
      const imageHeight = Number(response.headers.get('x-page-height'))
      const contentType = response.headers.get('content-type') ?? ''
      const blob = await response.blob()
      if (!(imageWidth > 0) || !(imageHeight > 0) || blob.size === 0 || !contentType.toLowerCase().startsWith('image/')) {
        throw new Error('页面图像数据无效。')
      }
      return { blob, width: imageWidth, height: imageHeight }
    }

    async function streamPost(path, payload, signal, onFrame) {
      const response = await apiPost(path, payload)
      if (response.body === null) throw new Error('浏览器不支持流式响应。')
      const reader = response.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newline
          while ((newline = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (line !== '') onFrame(JSON.parse(line))
          }
        }
        buffer += decoder.decode()
        if (buffer.trim() !== '') onFrame(JSON.parse(buffer.trim()))
      } finally {
        reader.releaseLock()
      }
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        try {
          const area = document.createElement('textarea')
          area.value = text
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          const ok = document.execCommand('copy')
          area.remove()
          return ok
        } catch {
          return false
        }
      }
    }

    function formatModel(model) {
      if (model === undefined) return ''
      return [model.provider, model.model].filter(Boolean).join(' / ')
    }

    // ── PDF.js original view ────────────────────────────────────────────────

    let pdfjsLoader = null
    // Filled from /bootstrap so diagnostics and upgrade hints never carry a
    // second hand-maintained copy of the manifest version.
    let pluginVersion = ''

    function vendorUrl(relative) {
      if (typeof relative !== 'string' || relative === '') return ''
      return `${APP_BASE}${relative.startsWith('/') ? '' : '/'}${relative}`
    }

    function loadPdfjs(info) {
      if (info === null || info === undefined) return Promise.reject(new Error('pdfjs-unavailable'))
      if (pdfjsLoader !== null && pdfjsLoader.key === info.module) return pdfjsLoader.promise
      const key = info.module
      const promise = import(vendorUrl(info.module)).then(module => {
        if (module.GlobalWorkerOptions !== undefined && typeof info.worker === 'string') {
          module.GlobalWorkerOptions.workerSrc = vendorUrl(info.worker)
        }
        return module
      })
      pdfjsLoader = { key, promise }
      promise.catch(() => {
        if (pdfjsLoader !== null && pdfjsLoader.promise === promise) pdfjsLoader = null
      })
      return promise
    }

    function normalizeForPdfMatch(value) {
      return String(value ?? '').replace(/\s+/g, '').toLowerCase()
    }

    /**
     * Map one rendered PDF page back to the extracted document model. For a
     * PDF the labels line up exactly; for a converted Office document the PDF
     * page count differs from the section/slide count, so we map
     * proportionally and then prefer a block whose text contains the actual
     * PDF selection.
     */
    function blockForPdfPage(doc, pdfPageNumber, pdfPageCount, selectedText) {
      if (doc === null) return undefined
      if (doc.pages.length === 0) {
        if (doc.extraction === 'pending' || doc.extraction === 'error') {
          return { id: 0, page: 0, text: '', type: 'pdf-page' }
        }
        return undefined
      }
      const exact = doc.pages.find(page => page.label === `第 ${pdfPageNumber} 页`)
        ?? doc.pages.find(page => page.label === `第 ${pdfPageNumber} 张`)
      let page = exact
      if (page === undefined) {
        const ratio = pdfPageCount > 0 ? (pdfPageNumber - 1) / pdfPageCount : 0
        const index = Math.min(doc.pages.length - 1, Math.max(0, Math.floor(ratio * doc.pages.length)))
        page = doc.pages[index]
      }
      if (page === undefined || page.blockIds.length === 0) return undefined
      const needle = normalizeForPdfMatch(selectedText)
      if (needle.length >= 4) {
        for (const blockId of page.blockIds) {
          const block = doc.blocks[blockId]
          if (block === undefined) continue
          const haystack = normalizeForPdfMatch(block.text)
          if (haystack.includes(needle) || (haystack.length >= 24 && needle.includes(haystack.slice(0, Math.min(haystack.length, 80))))) {
            return block
          }
        }
      }
      return doc.blocks[page.blockIds[0]]
    }

    async function fetchPageImage(doc, pageNumber, width, signal) {
      if (doc === null || doc === undefined || doc.extension !== 'pdf') return null
      try {
        return await apiPageImage(doc.id, pageNumber, width * PDFIUM_SUPERSAMPLE, signal)
      } catch (error) {
        if (signal?.aborted !== true) {
          console.warn('[study-reader] PDFium page image unavailable; falling back to PDF.js:', error)
        }
        return null
      }
    }

    async function paintPageImage(canvas, image, viewport) {
      let source
      let close = null
      try {
        source = await createImageBitmap(image.blob)
        close = source
      } catch {
        source = await new Promise((resolve, reject) => {
          const url = URL.createObjectURL(image.blob)
          const element = new Image()
          element.onload = () => {
            URL.revokeObjectURL(url)
            resolve(element)
          }
          element.onerror = () => {
            URL.revokeObjectURL(url)
            reject(new Error('无法解码页面图像。'))
          }
          element.src = url
        })
      }
      try {
        canvas.width = source.width
        canvas.height = source.height
        const context = canvas.getContext('2d', { alpha: false })
        if (context === null) throw new Error('浏览器无法创建页面画布。')
        context.drawImage(source, 0, 0)
      } finally {
        try { close?.close?.() } catch { /* ignore */ }
      }
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
    }

    // Inverse of blockForPdfPage for TOC / "read ahead" jumps in the original
    // view. PDF pages usually carry a readable label ("第 N 页" / "第 N 张");
    // for Office-derived PDFs without one, fall back to the proportional
    // mapping used by the extraction layer.
    function pdfPageForBlock(doc, blockId, pdfPageCount) {
      if (doc === null || doc === undefined || pdfPageCount <= 0) return undefined
      const block = doc.blocks?.[blockId]
      if (block === undefined || doc.pages.length === 0) return undefined
      const pageIndex = Math.min(doc.pages.length - 1, Math.max(0, Number(block.page) || 0))
      const label = doc.pages[pageIndex]?.label ?? ''
      const match = label.match(/第\s*(\d+)\s*[页张]/) ?? label.match(/Page\s*(\d+)/i)
      if (match !== null) {
        const page = Number(match[1])
        if (Number.isInteger(page)) return Math.min(pdfPageCount, Math.max(1, page))
      }
      const ratio = (pageIndex + 0.5) / doc.pages.length
      return Math.min(pdfPageCount, Math.max(1, Math.round(ratio * pdfPageCount)))
    }

    // ── icons ────────────────────────────────────────────────────────────────

    function iconPaths(name) {
      switch (name) {
        case 'book':
          return [
            h('path', { key: 'a', d: 'M4 5.5c2.8-1 5.6-.7 8 1.2 2.4-1.9 5.2-2.2 8-1.2v13c-2.8-1-5.6-.7-8 1.2-2.4-1.9-5.2-2.2-8-1.2v-13Z' }),
            h('path', { key: 'b', d: 'M12 6.7v13' }),
          ]
        case 'spark':
          return [
            h('path', { key: 'a', d: 'm12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z' }),
            h('path', { key: 'b', d: 'm18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z' }),
          ]
        case 'folder':
          return [h('path', { key: 'a', d: 'M3.5 6.8A2.3 2.3 0 0 1 5.8 4.5h3.1l1.8 2h7.5a2.3 2.3 0 0 1 2.3 2.3v7.4a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3V6.8Z' })]
        case 'home':
          return [h('path', { key: 'a', d: 'm4 11 8-7 8 7v9H4v-9Z' }), h('path', { key: 'b', d: 'M9.5 20v-6h5v6' })]
        case 'chat':
          return [
            h('path', { key: 'a', d: 'M20 11.5a7.5 7.5 0 0 1-8.2 7.4 8 8 0 0 1-2.8-.6L4 20l1.5-4.2A7.5 7.5 0 1 1 20 11.5Z' }),
            h('path', { key: 'b', d: 'M8.5 10.5h7M8.5 13.5h4.5' }),
          ]
        case 'translate':
          return [
            h('path', { key: 'a', d: 'M4 5.5h8M8 3.5v2M10.3 5.5c-.4 4-2.6 7.3-6.3 9.2M6.3 9.3c1.2 3 3.5 4.7 6.2 5.7' }),
            h('path', { key: 'b', d: 'M13 20l3.4-8 3.4 8M14.1 17.4h4.6' }),
          ]
        case 'send':
          return [h('path', { key: 'a', d: 'M4 11.5 20 4l-4.5 16-3.4-6.1L4 11.5Z' }), h('path', { key: 'b', d: 'M12.1 13.9 20 4' })]
        case 'stop':
          return [h('rect', { key: 'a', x: '7', y: '7', width: '10', height: '10', rx: '2', fill: 'currentColor', stroke: 'none' })]
        case 'close':
          return [h('path', { key: 'a', d: 'm6 6 12 12M18 6 6 18' })]
        case 'chevron':
          return [h('path', { key: 'a', d: 'm9 5 7 7-7 7' })]
        case 'up':
          return [h('path', { key: 'a', d: 'm6 14 6-6 6 6' })]
        case 'down':
          return [h('path', { key: 'a', d: 'm6 9 6 6 6-6' })]
        case 'refresh':
          return [h('path', { key: 'a', d: 'M20 11a8 8 0 1 0-2.1 6.3M20 5v6h-6' })]
        case 'copy':
          return [
            h('rect', { key: 'a', x: '8', y: '8', width: '11', height: '11', rx: '2' }),
            h('path', { key: 'b', d: 'M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2' }),
          ]
        case 'check':
          return [h('path', { key: 'a', d: 'm5 12 4.5 4.5L19 7' })]
        case 'list':
          return [h('path', { key: 'a', d: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01' })]
        case 'alert':
          return [h('path', { key: 'a', d: 'M12 3 2.8 20h18.4L12 3Z' }), h('path', { key: 'b', d: 'M12 9v5M12 17h.01' })]
        case 'external':
          return [h('path', { key: 'a', d: 'M14 4h6v6M20 4l-8 8M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' })]
        case 'panel':
          return [h('rect', { key: 'a', x: '3', y: '4', width: '18', height: '16', rx: '2' }), h('path', { key: 'b', d: 'M14 4v16' })]
        case 'file':
          return [h('path', { key: 'a', d: 'M6 3h8l4 4v14H6V3Z' }), h('path', { key: 'b', d: 'M14 3v5h4' })]
        case 'search':
          return [h('circle', { key: 'a', cx: '10.5', cy: '10.5', r: '6.5' }), h('path', { key: 'b', d: 'm16 16 4.5 4.5' })]
        case 'info':
          return [h('circle', { key: 'a', cx: '12', cy: '12', r: '8.5' }), h('path', { key: 'b', d: 'M12 11v5M12 7.6h.01' })]
        case 'crop':
          return [
            h('path', { key: 'a', d: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3' }),
            h('path', { key: 'b', d: 'M9 9h6v6H9z' }),
          ]
        case 'code':
          return [h('path', { key: 'a', d: 'm8 8-4 4 4 4M16 8l4 4-4 4M13.5 4.5l-3 15' })]
        default:
          return [h('circle', { key: 'a', cx: '12', cy: '12', r: '8' })]
      }
    }

    function Icon({ name, size = 16, strokeWidth = 1.7 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: 'false',
      }, iconPaths(name))
    }

    // ── i18n ─────────────────────────────────────────────────────────────────

    function useI18n(ctx) {
      const [snapshot, setSnapshot] = useState(() => {
        try { return ctx.locale.getLocale() } catch { return { active: 'zh-CN' } }
      })
      useEffect(() => {
        let unsubscribe = () => {}
        try {
          const result = ctx.locale.subscribe(() => {
            try { setSnapshot(ctx.locale.getLocale()) } catch { /* ignore */ }
          })
          if (typeof result === 'function') unsubscribe = result
        } catch { /* locale service unavailable */ }
        return () => {
          try { unsubscribe() } catch { /* already disposed */ }
        }
      }, [ctx])
      const lang = typeof snapshot?.active === 'string' && snapshot.active.startsWith('en') ? 'en' : 'zh'
      const t = useCallback(key => {
        const table = STR[lang] ?? STR.zh
        return table[key] ?? STR.zh[key] ?? key
      }, [lang])
      return { lang, t }
    }

    function panelLabel(ctx) {
      try {
        return ctx.locale.getLocale().active.startsWith('en') ? 'Study' : '研读'
      } catch {
        return '研读'
      }
    }

    // ── markdown ─────────────────────────────────────────────────────────────

    const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\[(?:第\s*\d+\s*[页张节]|B\d+)\])/g

    function inlineNodes(text, keyPrefix) {
      const nodes = []
      let last = 0
      let match
      let index = 0
      while ((match = INLINE_RE.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        const key = `${keyPrefix}-i${index++}`
        if (token.startsWith('**') && token.endsWith('**')) {
          nodes.push(h('strong', { key }, token.slice(2, -2)))
        } else if (token.startsWith('`') && token.endsWith('`')) {
          nodes.push(h('code', { key }, token.slice(1, -1)))
        } else if (token.startsWith('*') && token.endsWith('*')) {
          nodes.push(h('em', { key }, token.slice(1, -1)))
        } else if (token.startsWith('[') && token.includes('](')) {
          const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token)
          if (link !== null) {
            nodes.push(h('a', { key, href: link[2], target: '_blank', rel: 'noreferrer noopener' }, link[1]))
          } else nodes.push(token)
        } else {
          nodes.push(h('span', { key, className: 'dsr-cite' }, token.slice(1, -1)))
        }
        last = match.index + token.length
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes.length === 0 ? text : nodes
    }

    // Rendering a long answer is the expensive part of a streaming update.
    // Memoizing both the Markdown tree and each settled message keeps a
    // reasoning-only frame from re-rendering every previous answer.
    const Markdown = React.memo(function Markdown({ text }) {
      const lines = useMemo(() => String(text ?? '').replace(/\r\n?/g, '\n').split('\n'), [text])
      const blocks = useMemo(() => {
        const out = []
        let index = 0
        let key = 0
        const isBlockStart = line => /^\s*(#{1,6})\s+/.test(line)
          || /^\s*```/.test(line)
          || /^\s*(?:[-*+]|\d+[.)])\s+/.test(line)
          || /^\s*>\s?/.test(line)
          || /^\s*(?:---+|\*\*\*+)\s*$/.test(line)
          || /^\s*\|.*\|/.test(line)
        while (index < lines.length) {
          const line = lines[index]
          if (line.trim() === '') {
            index += 1
            continue
          }
          const fence = /^\s*```/.exec(line)
          if (fence !== null) {
            index += 1
            const code = []
            while (index < lines.length && !/^\s*```/.test(lines[index])) {
              code.push(lines[index])
              index += 1
            }
            index += 1
            out.push(h('pre', { key: `b${key++}` }, h('code', null, code.join('\n'))))
            continue
          }
          const heading = /^(#{1,6})\s+(.+)$/.exec(line)
          if (heading !== null) {
            const level = Math.min(4, heading[1].length)
            out.push(h(`h${level}`, { key: `b${key++}` }, inlineNodes(heading[2], `h${key}`)))
            index += 1
            continue
          }
          if (/^\s*>\s?/.test(line)) {
            const quote = []
            while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
              quote.push(lines[index].replace(/^\s*>\s?/, ''))
              index += 1
            }
            out.push(h('blockquote', { key: `b${key++}` }, h('p', null, inlineNodes(quote.join(' '), `q${key}`))))
            continue
          }
          if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
            const ordered = /^\s*\d+[.)]\s+/.test(line)
            const items = []
            while (index < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index])) {
              items.push(lines[index].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''))
              index += 1
            }
            out.push(h(ordered ? 'ol' : 'ul', { key: `b${key++}` }, items.map((item, itemIndex) => h('li', { key: itemIndex }, inlineNodes(item, `li${key}-${itemIndex}`)))))
            continue
          }
          if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
            out.push(h('hr', { key: `b${key++}` }))
            index += 1
            continue
          }
          if (/^\s*\|.*\|\s*$/.test(line) && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1])) {
            const splitRow = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
            const header = splitRow(line)
            index += 2
            const rows = []
            while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
              rows.push(splitRow(lines[index]))
              index += 1
            }
            out.push(h('table', { key: `b${key++}` },
              h('thead', null, h('tr', null, header.map((cell, cellIndex) => h('th', { key: cellIndex }, inlineNodes(cell, `th${key}-${cellIndex}`))))),
              h('tbody', null, rows.map((row, rowIndex) => h('tr', { key: rowIndex }, row.map((cell, cellIndex) => h('td', { key: cellIndex }, inlineNodes(cell, `td${key}-${rowIndex}-${cellIndex}`))))))
            ))
            continue
          }
          const paragraph = [line]
          index += 1
          while (index < lines.length && lines[index].trim() !== '' && !isBlockStart(lines[index])) {
            paragraph.push(lines[index])
            index += 1
          }
          out.push(h('p', { key: `b${key++}` }, inlineNodes(paragraph.join(' '), `p${key}`)))
        }
        return out
      }, [lines])
      if (blocks.length === 0) return null
      return h('div', { className: 'dsr-md' }, blocks)
    })

    // ── small controls ───────────────────────────────────────────────────────

    function CopyButton({ text, t, onToast, label }) {
      const [copied, setCopied] = useState(false)
      return h('button', {
        type: 'button',
        className: 'dsr-mini-btn',
        onClick: async () => {
          const ok = await copyText(text)
          if (ok) {
            setCopied(true)
            onToast?.(t('copied'))
            setTimeout(() => setCopied(false), 1500)
          } else {
            onToast?.(t('copyFailed'))
          }
        },
      }, h(Icon, { name: copied ? 'check' : 'copy', size: 11 }), label ?? t('copy'))
    }

    function Spinner() {
      return h('span', { className: 'dsr-spinner', 'aria-hidden': true })
    }

    function FileBadge({ extension }) {
      const badge = fileBadge(extension)
      return h('span', { className: cls('dsr-file-icon', badge.cls), 'aria-hidden': true }, badge.label)
    }

    function ModeSwitch({ mode, onChange, t, compact }) {
      return h('div', { className: 'dsr-seg', role: 'group', 'aria-label': t('modeSwitch') },
        h('button', {
          type: 'button',
          className: cls('dsr-seg-btn', mode === 'learn' && 'on'),
          onClick: () => onChange('learn'),
          title: t('modeLearnDesc'),
        }, compact ? t('modeLearnShort') : t('modeLearn')),
        h('button', {
          type: 'button',
          className: cls('dsr-seg-btn', mode === 'reread' && 'on'),
          onClick: () => onChange('reread'),
          title: t('modeRereadDesc'),
        }, compact ? t('modeRereadShort') : t('modeReread'))
      )
    }

    // A render failure anywhere in the reader must not blank the whole center
    // panel. React's event handlers still report themselves; this covers the
    // render/lifecycle path that would otherwise remove the slot entry.
    class StudyBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        console.error('[study-reader] render failed:', error, info)
      }

      render() {
        const { ctx, children } = this.props
        if (this.state.error === null) return children
        let lang = 'zh'
        try { lang = ctx?.locale?.getLocale().active.startsWith('en') ? 'en' : 'zh' } catch { /* default */ }
        const t = key => STR[lang]?.[key] ?? STR.zh[key] ?? key
        return h('div', { className: 'dsr-root' },
          h('div', { className: 'dsr-crash', role: 'alert' },
            h('h2', null, t('crashTitle')),
            h('p', null, t('crashDesc')),
            h('pre', null, this.state.error instanceof Error ? this.state.error.message : String(this.state.error)),
            h('button', { type: 'button', className: 'dsr-btn dsr-btn-primary', onClick: () => window.location.reload() }, t('reloadPage'))
          )
        )
      }
    }

    // ── panel icon ───────────────────────────────────────────────────────────

    function PanelIcon({ size }) {
      return h('svg', {
        width: size || 20,
        height: size || 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.55,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M4 5.4c2.6-.9 5.3-.6 8 1.2 2.7-1.8 5.4-2.1 8-1.2v13c-2.6-.9-5.3-.6-8 1.2-2.7-1.8-5.4-2.1-8-1.2v-13Z' }),
        h('path', { d: 'M12 6.6v13' }),
        h('path', { d: 'm18.1 3 .8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8.8-2.1Z', strokeWidth: 1.1 })
      )
    }

    // ── file browser ─────────────────────────────────────────────────────────

    function FileBrowser({ t, defaultDir, homeDir, workspaces, recent, onClose, onOpenPath, openingPath, openError }) {
      const [path, setPath] = useState('')
      const [listing, setListing] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [manual, setManual] = useState('')
      const dialogRef = useRef(null)
      const mountedRef = useRef(true)
      const requestRef = useRef(0)

      useModalFocus(true, onClose, dialogRef)

      useEffect(() => {
        mountedRef.current = true
        return () => { mountedRef.current = false }
      }, [])

      const load = useCallback(async nextPath => {
        const request = requestRef.current + 1
        requestRef.current = request
        setLoading(true)
        setError('')
        try {
          const result = await apiGet(`/list?path=${encodeURIComponent(nextPath ?? '')}`)
          if (!mountedRef.current || request !== requestRef.current) return false
          setListing(result)
          setPath(result.path)
          setManual(result.path)
          writeStore('lastDir', result.path)
          return true
        } catch (loadError) {
          if (mountedRef.current && request === requestRef.current) setError(loadError instanceof Error ? loadError.message : String(loadError))
          return false
        } finally {
          if (mountedRef.current && request === requestRef.current) setLoading(false)
        }
      }, [])

      useEffect(() => {
        let cancelled = false
        const last = readStore('lastDir', '')
        const preferred = defaultDir !== '' && !/[\\/]\.dsh[\\/]/i.test(defaultDir) ? defaultDir : homeDir
        const initial = last || preferred || defaultDir || homeDir || ''
        void (async () => {
          const ok = await load(initial)
          if (!cancelled && !ok && initial !== (defaultDir || homeDir || '')) {
            await load(defaultDir || homeDir || '')
          }
        })()
        return () => { cancelled = true }
      }, [load, defaultDir, homeDir])

      useEffect(() => {
        const onKey = event => {
          if (event.key === 'Escape') onClose()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [onClose])

      const openRow = entry => {
        if (entry.type === 'directory') void load(entry.path)
        else if (entry.supported) onOpenPath(entry.path)
      }

      const submitManual = () => {
        const value = manual.trim()
        if (value === '') return
        const extension = extensionOf(value)
        if (extension !== '' && !/^[\\/]$/.test(value)) {
          onOpenPath(value)
          return
        }
        void load(value)
      }

      const parent = listing?.parent
      const crumbs = listing?.crumbs ?? []

      return h('div', { className: 'dsr-modal-layer', onMouseDown: event => { if (event.target === event.currentTarget) onClose() } },
        h('div', {
          ref: dialogRef,
          className: 'dsr-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsr-open-title',
        },
          h('div', { className: 'dsr-modal-head' },
            h('div', null,
              h('h2', { id: 'dsr-open-title' }, t('dialogTitle')),
              h('p', null, t('dialogHint'))
            ),
            h('button', { type: 'button', className: 'dsr-icon-btn', onClick: onClose, title: t('close'), 'aria-label': t('close') }, h(Icon, { name: 'close', size: 16 }))
          ),
          openError !== '' ? h('div', { className: 'dsr-inline-error' }, h(Icon, { name: 'alert', size: 13 }), h('span', null, openError)) : null,
          h('div', { className: 'dsr-pathbar' },
            h('button', { type: 'button', className: 'dsr-icon-btn', title: t('up'), 'aria-label': t('up'), disabled: parent === null || parent === undefined, onClick: () => parent && load(parent) }, h(Icon, { name: 'up', size: 15 })),
            h('input', {
              className: 'dsr-path-input',
              value: manual,
              onChange: event => setManual(event.target.value),
              onKeyDown: event => { if (event.key === 'Enter') submitManual() },
              placeholder: t('pathPlaceholder'),
              'aria-label': t('pathPlaceholder'),
              spellCheck: false,
            }),
            h('button', { type: 'button', className: 'dsr-btn', onClick: submitManual }, t('openPath')),
            h('button', { type: 'button', className: 'dsr-icon-btn', title: t('refresh'), 'aria-label': t('refresh'), onClick: () => load(path) }, h(Icon, { name: 'refresh', size: 15 }))
          ),
          h('div', { className: 'dsr-modal-body' },
            h('aside', { className: 'dsr-modal-side' },
              h('p', { className: 'dsr-side-label' }, t('quickNav')),
              h('div', { className: 'dsr-quick' },
                workspaces.length === 0
                  ? h('button', { type: 'button', onClick: () => load(defaultDir) }, h(Icon, { name: 'folder', size: 14 }), t('workspace'))
                  : workspaces.slice(0, 5).map(workspace => h('button', {
                    type: 'button',
                    key: workspace.path,
                    title: workspace.path,
                    onClick: () => load(workspace.path),
                  }, h(Icon, { name: 'folder', size: 14 }), workspace.title)),
                h('button', { type: 'button', onClick: () => load(homeDir) }, h(Icon, { name: 'home', size: 14 }), t('home'))
              ),
              h('p', { className: 'dsr-side-label' }, t('recent')),
              h('div', { className: 'dsr-recent-mini' },
                recent.length === 0
                  ? h('div', { className: 'dsr-recent-empty' }, t('noRecent'))
                  : recent.map(entry => h('button', {
                    type: 'button',
                    key: entry.path,
                    title: entry.path,
                    onClick: () => onOpenPath(entry.path),
                  }, entry.name))
              )
            ),
            h('div', { className: 'dsr-modal-list' },
              h('div', { className: 'dsr-crumbs' },
                crumbs.map((crumb, index) => h(React.Fragment, { key: crumb.path },
                  index > 0 ? h('span', { className: 'dsr-crumb-sep' }, '/') : null,
                  h('button', { type: 'button', className: 'dsr-crumb', onClick: () => load(crumb.path) }, crumb.name)
                ))
              ),
              error !== '' ? h('div', { className: 'dsr-inline-error' }, h(Icon, { name: 'alert', size: 13 }), h('span', null, error)) : null,
              loading
                ? h('div', { className: 'dsr-file-list' }, h('div', { className: 'dsr-file-empty' }, h(Spinner, null), h('div', { style: { marginTop: 8 } }, t('loading'))))
                : h('div', { className: 'dsr-file-list', role: 'list' },
                  (listing?.entries ?? []).length === 0
                    ? h('div', { className: 'dsr-file-empty' }, t('noFiles'))
                    : (listing?.entries ?? []).map(entry => {
                      const isOpening = openingPath === entry.path
                      return h('button', {
                        type: 'button',
                        key: entry.path,
                        className: cls('dsr-file-row', isOpening && 'is-busy'),
                        onClick: () => openRow(entry),
                        disabled: entry.type !== 'directory' && (!entry.supported || openingPath !== null),
                        role: 'listitem',
                        title: entry.path,
                      },
                        entry.type === 'directory'
                          ? h('span', { className: 'dsr-file-icon', 'aria-hidden': true }, h(Icon, { name: 'folder', size: 14 }))
                          : h(FileBadge, { extension: entry.extension }),
                        h('span', { className: 'dsr-file-main' },
                          h('span', { className: 'dsr-file-name' }, entry.name),
                          h('span', { className: 'dsr-file-sub' },
                            entry.type === 'directory'
                              ? t('folder')
                              : entry.supported
                                ? `${entry.extension.toUpperCase()}${entry.size ? ` · ${formatBytes(entry.size)}` : ''}`
                                : `${entry.extension ? entry.extension.toUpperCase() : t('file')} · ${t('unsupportedFile')}`
                          )
                        ),
                        h('span', { className: 'dsr-file-right' },
                          isOpening ? h(Spinner, null) : entry.type === 'directory' ? h(Icon, { name: 'chevron', size: 13 }) : null
                        )
                      )
                    })
                )
            )
          ),
          h('div', { className: 'dsr-modal-foot' },
            h('div', { className: 'dsr-supported', style: { flex: 1 } }, t('supported')),
            openingPath !== null ? h('span', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 } }, h(Spinner, null), t('loadingDoc')) : null
          )
        )
      )
    }

    // ── side panel: Q&A ──────────────────────────────────────────────────────

    // ── model reasoning and injected context ─────────────────────────────────

    function modeNameFor(mode, t) {
      if (mode === 'reread') return t('modeReread')
      if (mode === 'translate') return t('translation')
      if (mode === 'overview') return t('tocOverview')
      return t('modeLearn')
    }

    function localNumber(value) {
      const number = Number(value)
      return Number.isFinite(number) ? number.toLocaleString() : '0'
    }

    // Reasoning can be long; keep enough for inspection without letting one
    // answer exhaust the localStorage quota used for chat history.
    const REASONING_LIMIT = 40_000

    function appendReasoning(previous, chunk) {
      const value = typeof previous === 'string' ? previous : ''
      if (typeof chunk !== 'string' || chunk === '' || value.length >= REASONING_LIMIT) return value
      return value + chunk.slice(0, REASONING_LIMIT - value.length)
    }

    function ReasoningBlock({ text, pending, t, onToast }) {
      const value = typeof text === 'string' ? text : ''
      const [open, setOpen] = useState(false)
      if (value === '') return null
      const copy = () => {
        void copyText(value).then(ok => onToast?.(ok ? t('reasoningCopied') : t('copyFailed')))
      }
      return h('div', { className: 'dsr-fold dsr-reasoning' },
        h('button', {
          type: 'button',
          className: cls('dsr-fold-head', open && 'is-open'),
          'aria-expanded': open,
          onClick: () => setOpen(current => !current),
        },
          h(Icon, { name: 'spark', size: 12 }),
          h('span', { className: 'dsr-fold-title' }, pending ? t('reasoningStreaming') : t('reasoningTitle')),
          h('span', { className: 'dsr-fold-meta' }, tr(t, 'reasoningChars', { n: localNumber(value.length) })),
          h('span', { className: 'dsr-fold-caret' }, h(Icon, { name: 'chevron', size: 11 }))
        ),
        open
          ? h('div', { className: 'dsr-fold-body' },
            h('div', { className: 'dsr-reasoning-body' }, value),
            h('div', { className: 'dsr-fold-actions' },
              h('button', { type: 'button', className: 'dsr-mini-btn', onClick: copy },
                h(Icon, { name: 'copy', size: 12 }), t('reasoningCopy'))
            )
          )
          : null
      )
    }

    const CONTEXT_STATUS = {
      streaming: 'contextStatusStreaming',
      done: 'contextStatusDone',
      error: 'contextStatusError',
      aborted: 'contextStatusAborted',
    }

    function contextImageLabel(image, t) {
      const page = Number(image.page) || 0
      const base = image.kind === 'crop' ? tr(t, 'contextImageCrop', { n: page }) : tr(t, 'contextImagePage', { n: page })
      return image.current ? `${base} · ${t('contextImageCurrent')}` : base
    }

    function ContextBlock({ docId, contextId, t, onToast, compact, live }) {
      const [open, setOpen] = useState(false)
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(false)
      const [attempt, setAttempt] = useState(0)
      const [tab, setTab] = useState('prompt')
      const refreshed = useRef(false)

      useEffect(() => {
        setData(null)
        setError('')
        setAttempt(0)
        refreshed.current = false
      }, [contextId])

      useEffect(() => {
        if (!open || data !== null || error !== '') return undefined
        let alive = true
        setLoading(true)
        void apiGet(contextQuery(docId, contextId))
          .then(body => {
            if (!alive) return
            if (body?.entry === null || typeof body?.entry !== 'object') throw new Error(t('contextMissing'))
            setData(body.entry)
          })
          .catch(problem => {
            if (alive) setError(problem instanceof Error ? problem.message : String(problem))
          })
          .finally(() => {
            if (alive) setLoading(false)
          })
        return () => { alive = false }
      }, [open, data, error, attempt, docId, contextId, t])

      useEffect(() => {
        if (!open || live === true || data === null || data.status !== 'streaming' || refreshed.current) return
        // The answer finished while the panel was open: reload the record so
        // status, duration and usage reflect the settled request. Only once,
        // so a stale Host record cannot cause a fetch loop.
        refreshed.current = true
        setData(null)
        setError('')
        setAttempt(value => value + 1)
      }, [open, live, data])

      if (typeof contextId !== 'string' || contextId === '') return null

      const rows = []
      const push = (label, value) => {
        if (value === undefined || value === null || String(value) === '') return
        rows.push([label, String(value)])
      }
      if (data !== null) {
        const notes = data.notes ?? {}
        const stats = data.stats ?? {}
        const listSeparator = t('source') === 'Source' ? ', ' : '、'
        push(t('contextKind'), data.mode === 'overview'
          ? t('tocOverview')
          : data.kind === 'translate' ? t('translation') : t('chat'))
        push(t('contextMode'), modeNameFor(data.mode, t))
        push(t('contextModel'), `${data.provider || '—'} / ${data.model || '—'}`)
        push(t('contextPosition'), notes.anchorLabel || '—')
        if (notes.targetLanguage) push(t('targetLanguage'), notes.targetLanguage)
        push(t('contextImages'), data.images.length > 0
          ? `${data.images.length} · ${[...new Set(data.images.map(image => image.page))].map(page => tr(t, 'pageShort', { n: page })).join(listSeparator)}`
          : t('contextNoImages'))
        push(t('contextChars'), tr(t, 'chars', { n: localNumber(stats.contextChars) }))
        push(t('contextTokens'), `≈ ${localNumber(stats.estimatedTokens)} tokens`)
        push(t('contextHistory'), Number(notes.historyChars) > 0 ? tr(t, 'chars', { n: localNumber(notes.historyChars) }) : '—')
        if (data.kind === 'ask' && data.mode !== 'overview') push(t('contextTrimmed'), notes.trimmed ? t('contextYes') : t('contextNo'))
        if (data.kind === 'ask' && data.mode !== 'overview') push(t('contextBrief'), notes.briefInjected ? t('contextOverviewInjected') : t('contextOverviewNo'))
        if (Array.isArray(notes.plannedPages) && notes.plannedPages.length > 0) {
          push(t('contextPlanned'), notes.plannedPages.map(page => tr(t, 'pageShort', { n: page })).join(listSeparator))
        }
        push(t('contextStatus'), t(CONTEXT_STATUS[data.status] ?? 'contextStatusDone'))
        push(t('contextDuration'), data.durationMs > 0 ? `${(data.durationMs / 1000).toFixed(1)} s` : '—')
        if (data.usage !== null && typeof data.usage === 'object') {
          const usage = []
          if (Number.isFinite(Number(data.usage.inputTokens))) usage.push(`${t('usageInput')} ${localNumber(data.usage.inputTokens)}`)
          if (Number.isFinite(Number(data.usage.outputTokens))) usage.push(`${t('usageOutput')} ${localNumber(data.usage.outputTokens)}`)
          if (Number.isFinite(Number(data.usage.reasoningTokens))) usage.push(`${t('usageReasoning')} ${localNumber(data.usage.reasoningTokens)}`)
          push(t('contextUsage'), usage.join(' · '))
        }
      }

      const copyAll = () => {
        if (data === null) return
        const text = `# ${t('contextSystem')}\n${data.system}\n\n# ${t('contextUser')}\n${data.prompt}`
        void copyText(text).then(ok => onToast?.(ok ? t('contextCopied') : t('copyFailed')))
      }

      return h('div', { className: cls('dsr-fold dsr-context', compact && 'is-compact') },
        h('button', {
          type: 'button',
          className: cls('dsr-fold-head', open && 'is-open'),
          'aria-expanded': open,
          onClick: () => setOpen(current => !current),
        },
          h(Icon, { name: 'code', size: 12 }),
          h('span', { className: 'dsr-fold-title' }, open ? t('contextHide') : t('contextShow')),
          data !== null
            ? h('span', { className: 'dsr-fold-meta' }, `≈ ${localNumber(data.stats?.estimatedTokens)} tokens`)
            : null,
          h('span', { className: 'dsr-fold-caret' }, h(Icon, { name: 'chevron', size: 11 }))
        ),
        open
          ? h('div', { className: 'dsr-fold-body' },
            loading ? h('div', { className: 'dsr-ctx-note' }, h(Spinner, null), t('contextLoading')) : null,
            error !== ''
              ? h('div', { className: 'dsr-ctx-note dsr-ctx-error' },
                h('span', null, error),
                h('button', {
                  type: 'button',
                  className: 'dsr-mini-btn',
                  onClick: () => {
                    setError('')
                    setAttempt(value => value + 1)
                  },
                }, t('retry'))
              )
              : null,
            data !== null
              ? h(React.Fragment, null,
                h('div', { className: 'dsr-ctx-section-title' }, t('contextSummary')),
                h('div', { className: 'dsr-ctx-grid' },
                  rows.map(([label, value]) => h(React.Fragment, { key: label },
                    h('span', { className: 'dsr-ctx-label' }, label),
                    h('span', { className: 'dsr-ctx-value', title: value }, value)
                  ))
                ),
                h('div', { className: 'dsr-ctx-section-title' }, t('contextImages')),
                data.images.length === 0
                  ? h('div', { className: 'dsr-ctx-note' }, t('contextNoImages'))
                  : h('div', { className: 'dsr-ctx-images' },
                    data.images.map(image => {
                      const label = contextImageLabel(image, t)
                      return h('a', {
                        key: image.index,
                        className: 'dsr-ctx-image',
                        href: contextPath(docId, contextId, image.index),
                        target: '_blank',
                        rel: 'noreferrer',
                        title: label,
                      },
                        h('img', { src: contextPath(docId, contextId, image.index, 420), alt: label, loading: 'lazy' }),
                        h('span', { className: 'dsr-ctx-image-label' }, label),
                        image.width > 0 && image.height > 0
                          ? h('span', { className: 'dsr-ctx-image-meta' }, `${image.width}×${image.height} · ${formatBytes(image.bytes)}`)
                          : null
                      )
                    })
                  ),
                h('div', { className: 'dsr-ctx-tabs', role: 'tablist' },
                  h('button', {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': tab === 'prompt',
                    className: cls('dsr-ctx-tab', tab === 'prompt' && 'on'),
                    onClick: () => setTab('prompt'),
                  }, t('contextUser')),
                  h('button', {
                    type: 'button',
                    role: 'tab',
                    'aria-selected': tab === 'system',
                    className: cls('dsr-ctx-tab', tab === 'system' && 'on'),
                    onClick: () => setTab('system'),
                  }, t('contextSystem'))
                ),
                h('pre', { className: 'dsr-ctx-text' }, tab === 'system' ? data.system : data.prompt),
                h('div', { className: 'dsr-fold-actions' },
                  h('button', { type: 'button', className: 'dsr-mini-btn', onClick: copyAll },
                    h(Icon, { name: 'copy', size: 12 }), t('contextCopyAll'))
                )
              )
              : null
          )
          : null
      )
    }

    const MessageBubble = React.memo(function MessageBubble({ message, t, docId, onAhead, onToast }) {
      const isUser = message.role === 'user'
      const modeLabel = message.mode === 'reread' ? t('modeReread') : t('modeLearn')
      return h('div', { className: cls('dsr-msg', isUser ? 'dsr-msg-user' : 'dsr-msg-assistant') },
        h('div', { className: 'dsr-msg-meta' },
          h('span', null, isUser ? t('you') : t('appName')),
          !isUser && message.mode ? h('span', { className: 'dsr-msg-mode' }, modeLabel) : null
        ),
        h('div', { className: 'dsr-msg-bubble' },
          message.quote ? h('div', { className: 'dsr-quote-chip' },
            h('span', { className: 'dsr-quote-label' }, t('quoteLabel')),
            message.quote
          ) : null,
          isUser
            ? h('div', { style: { whiteSpace: 'pre-wrap' } }, message.text)
            : h('div', null,
              h(ReasoningBlock, {
                text: message.reasoning,
                pending: message.pending === true,
                t,
                onToast,
              }),
              message.text !== '' ? h(Markdown, { text: message.text }) : null,
              !isUser && Array.isArray(message.pages) && message.pages.length > 0
                ? h('div', { className: 'dsr-msg-pages' },
                  `${t('readPages')}：${message.pages.map(page => tr(t, 'pageShort', { n: page })).join('、')}`)
                : null,
              message.pending && message.status ? h('div', { className: 'dsr-msg-status' }, message.status) : null,
              message.pending && message.text === '' ? h('span', { className: 'dsr-typing', 'aria-label': t('loading') }, h('i'), h('i'), h('i')) : null,
              message.ahead ? h('div', { className: 'dsr-ahead' },
                h('div', { className: 'dsr-ahead-head' }, h(Icon, { name: 'book', size: 13 }), t('aheadTitle')),
                h('p', null, t('aheadDesc')),
                h('button', { type: 'button', className: 'dsr-btn', onClick: () => onAhead?.(message.ahead.blockId) }, t('jumpTo'))
              ) : null,
              message.error ? h('div', { className: 'dsr-error-box' }, h('strong', null, `${t('errorPrefix')}: `), message.error) : null,
              message.aborted ? h('div', { className: 'dsr-error-box' }, t('answerStopped')) : null,
              h(ContextBlock, {
                docId,
                contextId: message.contextId,
                t,
                onToast,
                compact: true,
                live: message.pending === true,
              })
            )
        )
      )
    })

    function ChatBody({ t, mode, setMode, messages, busy, onSend, onStop, quote, onClearQuote, onClear, empty, onAhead, scrollRef, docId, onToast }) {
      const [draft, setDraft] = useState('')
      const inputRef = useRef(null)
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : undefined
      const lastTextLength = lastMessage?.text?.length ?? 0
      const lastId = lastMessage?.id ?? ''

      useEffect(() => {
        if (quote !== null) {
          const timer = setTimeout(() => inputRef.current?.focus(), 40)
          return () => clearTimeout(timer)
        }
        return undefined
      }, [quote])

      useEffect(() => {
        const element = scrollRef.current
        if (element === null) return
        const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 160
        if (nearBottom || busy) element.scrollTop = element.scrollHeight
        // Reasoning-only updates change neither the message count nor the
        // answer text length, so they must not force a layout + scroll on
        // every throttled reasoning frame.
      }, [messages.length, lastId, lastTextLength, busy, scrollRef])

      const submit = () => {
        const text = draft.trim()
        if (text === '' || busy) return
        onSend(text, quote)
        setDraft('')
        if (inputRef.current !== null) inputRef.current.style.height = 'auto'
      }

      const onKeyDown = event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          submit()
        }
      }

      useEffect(() => {
        const element = inputRef.current
        if (element === null) return
        element.style.height = 'auto'
        element.style.height = `${Math.min(170, element.scrollHeight)}px`
      }, [draft])

      return h(React.Fragment, null,
        h('div', { className: 'dsr-mode-box' },
          h('div', { className: 'dsr-mode-row' },
            h('span', { className: 'dsr-mode-label' }, t('modeSwitch')),
            h(ModeSwitch, { mode, onChange: setMode, t, compact: false })
          ),
          h('p', { className: 'dsr-mode-desc' }, mode === 'reread' ? t('modeRereadDesc') : t('modeLearnDesc'))
        ),
        h('div', { className: 'dsr-side-scroll', ref: scrollRef },
          messages.length === 0
            ? h('div', { className: 'dsr-empty-chat' },
              h('div', { className: 'dsr-empty-chat-icon' }, h(Icon, { name: 'spark', size: 20 })),
              h('h3', null, t('emptyChatTitle')),
              h('p', null, t('emptyChatDesc')),
              h('div', { className: 'dsr-mode-hint' }, mode === 'reread' ? t('emptyChatReread') : t('emptyChatLearning'))
            )
            : h('div', { className: 'dsr-chat-list' },
              messages.map(message => h(MessageBubble, { key: message.id, message, t, docId, onAhead, onToast }))
            )
        ),
        h('div', { className: 'dsr-composer' },
          h('div', { className: 'dsr-composer-box' },
            quote !== null ? h('div', { className: 'dsr-quote-chip' },
              h('span', { className: 'dsr-quote-label' }, t('quoteLabel')),
              quote.text || t('quoteRegion'),
              h('button', { type: 'button', className: 'dsr-quote-remove', onClick: onClearQuote, title: t('removeQuote'), 'aria-label': t('removeQuote') }, h(Icon, { name: 'close', size: 11 }))
            ) : null,
            h('textarea', {
              ref: inputRef,
              value: draft,
              onChange: event => setDraft(event.target.value),
              onKeyDown,
              placeholder: quote !== null ? t('askWithQuote') : t('askPlaceholder'),
              rows: 1,
              'aria-label': t('askPlaceholder'),
              disabled: busy,
            }),
            h('div', { className: 'dsr-composer-row' },
              h('span', { className: 'dsr-composer-hint' }, t('composerHint')),
              busy
                ? h('button', { type: 'button', className: 'dsr-send', onClick: onStop, title: t('stop'), 'aria-label': t('stop') }, h(Icon, { name: 'stop', size: 13 }))
                : h('button', { type: 'button', className: 'dsr-send', onClick: submit, disabled: draft.trim() === '', title: t('send'), 'aria-label': t('send') }, h(Icon, { name: 'send', size: 13 }))
            )
          )
        )
      )
    }

    const TranslationCard = React.memo(function TranslationCard({ item, t, docId, onCopy, onRetranslate }) {
      return h('div', { className: 'dsr-trans-card' },
        h('div', { className: 'dsr-trans-card-head' },
          h(Icon, { name: 'translate', size: 12 }),
          h('span', null, item.pageLabel || t('translation')),
          h('span', { className: 'dsr-lang-badge' }, languageLabel(item.targetLanguage, t))
        ),
        h('div', { className: 'dsr-trans-card-body' },
          h('div', { className: 'dsr-trans-source' }, item.source),
          h(ReasoningBlock, {
            text: item.reasoning,
            pending: item.status === 'streaming',
            t,
            onToast: onCopy,
          }),
          item.text !== ''
            ? h('div', { className: 'dsr-trans-result' }, item.text)
            : null,
          item.status === 'streaming' ? h('div', { className: 'dsr-trans-status' }, h(Spinner, null), t('translating')) : null,
          item.status === 'error' ? h('div', { className: 'dsr-error-box' }, item.error || t('translationFailed')) : null,
          item.status === 'aborted' ? h('div', { className: 'dsr-error-box' }, t('answerStopped')) : null,
          h(ContextBlock, {
            docId,
            contextId: item.contextId,
            t,
            onToast: onCopy,
            compact: true,
            live: item.status === 'streaming',
          }),
          item.text !== '' || item.status === 'error'
            ? h('div', { className: 'dsr-trans-actions' },
              item.status === 'error'
                ? h('button', { type: 'button', className: 'dsr-mini-btn', onClick: () => onRetranslate(item) }, t('retranslate'))
                : null,
              item.text !== ''
                ? h(CopyButton, { text: item.text, t, onToast: text => onCopy(text) })
                : null
            )
            : null
        )
      )
    })

    function TranslationBody({ t, targetLanguage, setTargetLanguage, translations, onClear, onCopy, onRetranslate, scrollRef, docId }) {
      return h(React.Fragment, null,
        h('div', { className: 'dsr-translate-head' },
          h('label', { htmlFor: 'dsr-target-lang' }, t('targetLanguage')),
          h('select', {
            id: 'dsr-target-lang',
            className: 'dsr-select',
            value: targetLanguage,
            onChange: event => setTargetLanguage(event.target.value),
          }, TARGET_LANGUAGES.map(([value, zhLabel, enLabel]) => h('option', { key: value, value }, t('source') === 'Source' ? enLabel : zhLabel)))
        ),
        h('div', { className: 'dsr-side-scroll', ref: scrollRef },
          translations.length === 0
            ? h('div', { className: 'dsr-empty-chat' },
              h('div', { className: 'dsr-empty-chat-icon' }, h(Icon, { name: 'translate', size: 20 })),
              h('h3', null, t('emptyTranslateTitle')),
              h('p', null, t('emptyTranslateDesc'))
            )
            : h('div', { className: 'dsr-translate-list' },
              translations.map(item => h(TranslationCard, {
                key: item.id,
                item,
                t,
                docId,
                onCopy,
                onRetranslate,
              }))
            )
        ),
        translations.length > 0
          ? h('div', { style: { padding: '0 12px 10px', display: 'flex', justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'dsr-mini-btn', onClick: onClear }, t('clearTranslations'))
          )
          : null
      )
    }

    function languageLabel(code, t) {
      const entry = TARGET_LANGUAGES.find(item => item[0] === code)
      if (entry === undefined) return code
      return t('source') === 'Source' ? entry[2] : entry[1]
    }

    function SidePanel({
      doc, t, mode, setMode, panelTab, setPanelTab, messages, busy, onSend, onStop,
      quote, onClearQuote, onClearChat, onAhead, translations, targetLanguage, setTargetLanguage,
      onClearTranslations, onTranslateAgain, onToast, onClose, modelAvailable, positionLabel, chatOpen,
    }) {
      const chatScroll = useRef(null)
      const transScroll = useRef(null)
      return h('aside', { className: 'dsr-side', 'aria-label': t('chatTitle') },
        h('div', { className: 'dsr-side-head' },
          h('div', { className: 'dsr-side-title' },
            panelTab === 'chat' ? t('chatTitle') : t('translateTitle'),
            h('small', null, panelTab === 'chat' ? positionLabel : t('translateSub'))
          ),
          panelTab === 'chat' && messages.length > 0
            ? h('button', { type: 'button', className: 'dsr-icon-btn', onClick: onClearChat, title: t('newChat'), 'aria-label': t('newChat') }, h(Icon, { name: 'refresh', size: 14 }))
            : null,
          h('button', { type: 'button', className: 'dsr-icon-btn', onClick: onClose, title: t('closePanel'), 'aria-label': t('closePanel') }, h(Icon, { name: 'panel', size: 15 }))
        ),
        h('div', { className: 'dsr-tabs', role: 'tablist' },
          h('button', { type: 'button', role: 'tab', 'aria-selected': panelTab === 'chat', className: cls('dsr-tab', panelTab === 'chat' && 'on'), onClick: () => setPanelTab('chat') },
            h(Icon, { name: 'chat', size: 13 }), t('chat'),
            messages.length > 0 ? h('span', { className: 'dsr-count' }, messages.length > 99 ? '99+' : messages.length) : null
          ),
          h('button', { type: 'button', role: 'tab', 'aria-selected': panelTab === 'translate', className: cls('dsr-tab', panelTab === 'translate' && 'on'), onClick: () => setPanelTab('translate') },
            h(Icon, { name: 'translate', size: 13 }), t('translation'),
            translations.length > 0 ? h('span', { className: 'dsr-count' }, translations.length) : null
          )
        ),
        panelTab === 'chat'
          ? h(React.Fragment, null,
            !modelAvailable
              ? h('div', { className: 'dsr-inline-error', style: { margin: '10px 14px 0' } }, h(Icon, { name: 'alert', size: 12 }), h('span', null, t('modelMissing')))
              : null,
            h(ChatBody, {
              t, mode, setMode, messages, busy, onSend, onStop, quote, onClearQuote,
              onClear: onClearChat, onAhead, scrollRef: chatScroll,
              docId: doc?.id ?? '', onToast,
            })
          )
          : h(TranslationBody, {
            t, targetLanguage, setTargetLanguage, translations,
            onClear: onClearTranslations,
            onCopy: onToast,
            onRetranslate: onTranslateAgain,
            scrollRef: transScroll,
            docId: doc?.id ?? '',
          })
      )
    }

    // ── top bar / hero ───────────────────────────────────────────────────────

    function TopBar({ doc, t, chatOpen, setChatOpen, onOpen, onToc, onBack, progress, activePage, pages, onSearch, onDiagnostics }) {
      const searchable = doc !== null && ((doc.blocks?.length ?? 0) > 0 || (doc.toc?.length ?? 0) > 0)
      return h('header', { className: 'dsr-header' },
        h('div', { className: 'dsr-brand' },
          h('div', { className: 'dsr-brand-mark' }, h(Icon, { name: 'book', size: 18 })),
          h('div', { className: 'dsr-brand-text' },
            h('span', { className: 'dsr-brand-name' }, t('appName')),
            h('span', { className: 'dsr-brand-tag' }, t('appTag'))
          )
        ),
        h('div', { className: 'dsr-header-main' },
          h('div', { className: 'dsr-doc-title' }, doc?.title ?? t('appName')),
          h('div', { className: 'dsr-doc-meta' },
            doc !== null
              ? h(React.Fragment, null,
                h(FileBadge, { extension: doc.extension }),
                h('span', null, pages > 0 ? tr(t, 'pdfPages', { n: pages }) : formatBytes(doc.size)),
                doc.extraction === 'pending'
                  ? h('span', { className: 'dsr-extracting' }, h(Spinner, null), h('span', null, t('extractingText')))
                  : null,
                h('span', { className: 'dsr-doc-path', title: doc.path }, doc.path)
              )
              : h('span', null, t('supported'))
          )
        ),
        h('div', { className: 'dsr-header-actions' },
          doc !== null
            ? h('button', {
              type: 'button',
              className: 'dsr-icon-btn',
              title: searchable ? t('search') : t('searchNoText'),
              'aria-label': t('search'),
              disabled: !searchable,
              onClick: onSearch,
            }, h(Icon, { name: 'search', size: 15 }))
            : null,
          doc !== null && doc.canPreview && doc.toc?.length > 0
            ? h('button', { type: 'button', className: 'dsr-icon-btn', title: t('toc'), 'aria-label': t('toc'), onClick: onToc }, h(Icon, { name: 'list', size: 15 }))
            : null,
          doc !== null
            ? h('button', {
              type: 'button',
              className: cls('dsr-icon-btn', chatOpen && 'is-active'),
              title: chatOpen ? t('closePanel') : t('openPanel'),
              'aria-label': chatOpen ? t('closePanel') : t('openPanel'),
              onClick: () => setChatOpen(value => !value),
            }, h(Icon, { name: 'chat', size: 15 }))
            : null,
          h('button', { type: 'button', className: 'dsr-icon-btn', onClick: onDiagnostics, title: t('diagnostics'), 'aria-label': t('diagnostics') },
            h(Icon, { name: 'info', size: 15 })
          ),
          h('button', { type: 'button', className: 'dsr-icon-btn', onClick: onBack, title: t('backToChat'), 'aria-label': t('backToChat') },
            h('span', { style: { display: 'flex', transform: 'rotate(180deg)' } }, h(Icon, { name: 'chevron', size: 15 }))
          ),
          h('button', { type: 'button', className: 'dsr-btn dsr-btn-primary', onClick: onOpen, title: t('openDoc') },
            h(Icon, { name: 'folder', size: 14 }),
            h('span', null, t('openDoc'))
          )
        ),
        h('div', { className: 'dsr-progress-track', 'aria-hidden': true }, h('div', { className: 'dsr-progress-fill', style: { width: `${progress}%` } })),
        pages > 0 ? h('span', { className: 'dsr-sr-only' }, tr(t, 'pageOf', { current: activePage + 1, total: pages })) : null
      )
    }

    function OriginalUnavailable({ doc, t, onOpen }) {
      return h('div', { className: 'dsr-reader-col' },
        h('div', { className: 'dsr-scroll' },
          doc.warnings?.length > 0
            ? h('div', { className: 'dsr-warnings' }, doc.warnings.map((warning, index) => h('div', { key: index, className: 'dsr-warning' }, h(Icon, { name: 'alert', size: 13 }), h('span', null, warning))))
            : null,
          h('div', { className: 'dsr-empty-doc' },
            h('div', { className: 'dsr-empty-doc-icon' }, h(Icon, { name: 'file', size: 24 })),
            h('h2', null, t('originalOnlyTitle')),
            h('p', null, t('originalOnlyDesc')),
            h('button', { type: 'button', className: 'dsr-btn dsr-btn-primary', onClick: onOpen },
              h(Icon, { name: 'folder', size: 14 }),
              t('openDoc')
            )
          )
        )
      )
    }

    function SearchDialog({ doc, t, onJump, onClose }) {
      const [query, setQuery] = useState('')
      const [active, setActive] = useState(0)
      const panelRef = useRef(null)
      const inputRef = useRef(null)
      useModalFocus(true, onClose, panelRef, inputRef)
      const results = useMemo(() => searchBlocks(doc, query), [doc, query])
      const searchable = doc.blocks.length > 0 || (doc.toc?.length ?? 0) > 0
      const choose = index => {
        const result = results[index]
        if (result === undefined) return
        setActive(index)
        onJump(result.blockId)
      }
      const meta = !searchable
        ? t('searchNoText')
        : query.trim() === ''
          ? t('searchEmpty')
          : results.length === 0
            ? t('searchNoResult')
            : `${tr(t, 'searchResults', { n: results.length })}${results.length >= SEARCH_RESULT_LIMIT ? ` · ${t('searchMore')}` : ''}`
      return h('div', {
        className: 'dsr-search-layer',
        onMouseDown: event => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', { ref: panelRef, className: 'dsr-search', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('search') },
          h('div', { className: 'dsr-search-head' },
            h(Icon, { name: 'search', size: 14 }),
            h('input', {
              ref: inputRef,
              className: 'dsr-search-input',
              value: query,
              onChange: event => {
                setQuery(event.target.value)
                setActive(0)
              },
              onKeyDown: event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (results.length === 0) return
                  choose(active % results.length)
                  setActive(value => (value + 1) % results.length)
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive(value => results.length === 0 ? 0 : Math.min(results.length - 1, value + 1))
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive(value => Math.max(0, value - 1))
                }
              },
              placeholder: t('searchPlaceholder'),
              'aria-label': t('searchPlaceholder'),
              spellCheck: false,
              autoComplete: 'off',
            }),
            h('button', { type: 'button', className: 'dsr-icon-btn', onClick: onClose, title: t('close'), 'aria-label': t('close') }, h(Icon, { name: 'close', size: 13 }))
          ),
          h('div', { className: 'dsr-search-meta' }, meta),
          results.length > 0
            ? h('div', { className: 'dsr-search-list' },
              results.map((result, index) => h('button', {
                type: 'button',
                key: `${result.blockId}-${index}`,
                className: cls('dsr-search-result', index === active && 'is-active'),
                'aria-current': index === active ? 'true' : undefined,
                onClick: () => choose(index),
              },
                h('span', { className: 'dsr-search-snippet' }, result.prefix, h('mark', null, result.match), result.suffix),
                h('span', { className: 'dsr-search-page' }, result.label)
              )))
            : null
        )
      )
    }

    function Diagnostics({ open, onClose, t, boot, doc, engine, problems, onToast }) {
      const panelRef = useRef(null)
      useModalFocus(open, onClose, panelRef)
      if (!open) return null
      const entries = []
      const add = (label, value) => {
        if (value === undefined || value === null || String(value) === '') return
        entries.push([label, String(value)])
      }
      add(t('diagVersion'), boot?.version || pluginVersion || '—')
      add(t('diagEngine'), engine === 'pdfium' ? t('pdfiumEngine') : engine === 'pdfjs' ? t('pdfjsEngine') : '—')
      add('PDF.js', boot?.pdfjs?.module ?? '—')
      add(t('diagModel'), boot === null ? undefined : (boot.model ? formatModel(boot.model) : t('diagNone')))
      add(t('diagOffice'), boot === null ? undefined : (boot.officeAvailable ? '✓' : '—'))
      if (doc !== null) {
        add(t('diagPages'), doc.pages.length)
        add(t('diagBlocks'), doc.blocks.length)
        add(t('diagToc'), doc.toc?.length ?? 0)
        add(t('diagExtraction'), doc.extraction ?? '')
        add(t('diagPath'), doc.path)
      }
      add(t('diagPlatform'), `${navigator.platform || 'unknown'} · dpr ${window.devicePixelRatio || 1}`)
      add(t('diagProblems'), problems.length > 0 ? problems.join(' | ') : t('diagNone'))
      const copy = () => {
        const text = [
          'Study Reader diagnostics',
          ...entries.map(([label, value]) => `${label}: ${value}`),
          `UA: ${navigator.userAgent}`,
        ].join('\n')
        void copyText(text).then(ok => onToast?.(ok ? t('diagCopied') : t('copyFailed')))
      }
      return h('div', {
        className: 'dsr-modal-layer',
        onMouseDown: event => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', {
          ref: panelRef,
          className: 'dsr-modal dsr-modal-narrow',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dsr-diag-title',
        },
          h('div', { className: 'dsr-modal-head' },
            h('div', null,
              h('h2', { id: 'dsr-diag-title' }, t('diagnostics')),
              h('p', null, `${t('appName')} · ${boot?.version || pluginVersion || '—'}`)
            ),
            h('button', { type: 'button', className: 'dsr-icon-btn', onClick: onClose, title: t('close'), 'aria-label': t('close') }, h(Icon, { name: 'close', size: 16 }))
          ),
          h('div', { className: 'dsr-diag-body' },
            entries.map(([label, value]) => h('div', { className: 'dsr-diag-row', key: label },
              h('span', { className: 'dsr-diag-label' }, label),
              h('span', { className: 'dsr-diag-value', title: value }, value)
            ))
          ),
          h('div', { className: 'dsr-modal-foot' },
            h('button', { type: 'button', className: 'dsr-btn', onClick: copy }, h(Icon, { name: 'copy', size: 13 }), t('diagCopy')),
            h('button', { type: 'button', className: 'dsr-btn dsr-btn-primary', onClick: onClose }, t('close'))
          )
        )
      )
    }

    function Hero({ t, onOpen, recent, onOpenRecent, loadingPath, boot, onRestore }) {      return h('div', { className: 'dsr-scroll' },
        h('div', { className: 'dsr-hero' },
          h('div', { className: 'dsr-hero-kicker' }, h(Icon, { name: 'spark', size: 13 }), t('appName')),
          h('h1', null, t('welcomeTitle')),
          h('p', { className: 'lead' }, t('welcomeSub')),
          h('div', { className: 'dsr-hero-actions' },
            h('button', { type: 'button', className: 'dsr-btn dsr-btn-primary', onClick: onOpen, disabled: loadingPath !== null },
              h(Icon, { name: 'folder', size: 15 }), t('getStarted')),
            boot?.recentPath
              ? h('button', { type: 'button', className: 'dsr-restore', onClick: onRestore }, t('restoreLast'))
              : null
          ),
          h('div', { className: 'dsr-hero-grid' },
            h('div', { className: 'dsr-hero-card' },
              h('div', { className: 'dsr-hero-card-icon' }, h(Icon, { name: 'book', size: 15 })),
              h('h3', null, t('featureReadTitle')),
              h('p', null, t('featureReadDesc'))
            ),
            h('div', { className: 'dsr-hero-card' },
              h('div', { className: 'dsr-hero-card-icon' }, h(Icon, { name: 'translate', size: 15 })),
              h('h3', null, t('featureTranslateTitle')),
              h('p', null, t('featureTranslateDesc'))
            ),
            h('div', { className: 'dsr-hero-card' },
              h('div', { className: 'dsr-hero-card-icon' }, h(Icon, { name: 'spark', size: 15 })),
              h('h3', null, t('featureModesTitle')),
              h('p', null, t('featureModesDesc'))
            )
          ),
          h('p', { className: 'dsr-supported' }, t('supported')),
          recent.length > 0
            ? h('div', { className: 'dsr-hero-recent' },
              h('h3', null, t('recent')),
              h('div', { className: 'dsr-hero-recent-list' },
                recent.slice(0, 5).map(entry => h('button', {
                  type: 'button',
                  key: entry.path,
                  className: 'dsr-hero-recent-row',
                  onClick: () => onOpenRecent(entry.path),
                  title: entry.path,
                },
                  h(FileBadge, { extension: entry.extension }),
                  h('span', { className: 'dsr-file-main' },
                    h('span', { className: 'dsr-file-name' }, entry.name),
                    h('span', { className: 'dsr-file-sub' }, entry.path)
                  ),
                  h(Icon, { name: 'chevron', size: 13 })
                ))
              )
            )
            : null
        )
      )
    }

    // ── selection toolbar ────────────────────────────────────────────────────

    function SelectionBar({ selection, t, targetLanguage, setTargetLanguage, onTranslate, onAsk, onExplain }) {
      const [lang, setLang] = useState(targetLanguage)
      useEffect(() => { setLang(targetLanguage) }, [targetLanguage])
      const top = selection.rect.top > 82 ? selection.rect.top - 44 : selection.rect.bottom + 10
      const left = Math.min(Math.max(selection.rect.left + selection.rect.width / 2, 150), window.innerWidth - 150)
      const keepSelection = event => event.preventDefault()
      return h('div', {
        className: 'dsr-selection',
        style: { top, left, transform: 'translateX(-50%)' },
        role: 'toolbar',
        'aria-label': t('selectionTranslate'),
      },
        h('button', { type: 'button', className: 'dsr-selection-btn primary', onMouseDown: keepSelection, onClick: () => onTranslate(lang) },
          h(Icon, { name: 'translate', size: 13 }), t('selectionTranslate')),
        h('select', {
          value: lang,
          'aria-label': t('targetLanguage'),
          onChange: event => {
            setLang(event.target.value)
            setTargetLanguage(event.target.value)
          },
        }, TARGET_LANGUAGES.map(([value, zhLabel, enLabel]) => h('option', { key: value, value }, t('source') === 'Source' ? enLabel : zhLabel))),
        h('span', { className: 'dsr-selection-sep', 'aria-hidden': true }),
        h('button', { type: 'button', className: 'dsr-selection-btn', onMouseDown: keepSelection, onClick: onAsk },
          h(Icon, { name: 'chat', size: 13 }), t('selectionAsk')),
        h('button', { type: 'button', className: 'dsr-selection-btn', onMouseDown: keepSelection, onClick: onExplain },
          h(Icon, { name: 'spark', size: 13 }), t('selectionExplain'))
      )
    }

    // ── continuous original view ─────────────────────────────────────────────

    const CONTINUOUS_PAGE_MAX_WIDTH = 1200
    const CONTINUOUS_PAGE_MAX_PIXELS = 9_000_000
    const PDFIUM_SUPERSAMPLE = 2
    // Give the page under the reading line a head start before neighbours
    // start fetching/rendering. A jump to an unvisited page should not queue
    // behind the pages above and below it.
    const CONTINUOUS_NEIGHBOUR_DELAY = 600
    // Pages this close to the reading position stay mounted and rendered even
    // after they leave the viewport, so flipping one page back or forward
    // reuses the existing canvas and text layer instead of rebuilding them.
    // Every retained page holds one full-resolution page canvas, so this is a
    // deliberate memory/revisit trade-off rather than a scroll prefetch.
    const CONTINUOUS_NEARBY_PAGES = 2

    function pageHostFor(node) {
      let element = node
      if (element !== null && element !== undefined && element.nodeType !== 1) element = element.parentElement
      if (element === null || element === undefined || typeof element.closest !== 'function') return null
      return element.closest('.dsr-pdf-page-block')
    }

    // One page inside the continuous flow. Pages are mounted as placeholders and
    // only rasterized while the IntersectionObserver marks them near the
    // viewport, so a long PDF does not allocate dozens of full-page canvases.
    const ContinuousPage = React.memo(function ContinuousPage({
      pdfApi, doc, pageNumber, pageWidth, defaultHeight, active, current, registerPage, onEngine, t,
    }) {
      const hostRef = useRef(null)
      const canvasRef = useRef(null)
      const textLayerRef = useRef(null)
      const renderTaskRef = useRef(null)
      const textLayerApiRef = useRef(null)
      const renderedRef = useRef(false)
      // Scheduling state kept outside the render effect so that a page turning
      // current can start immediately without cancelling the work already done
      // for a neighbour.
      const startRenderRef = useRef(null)
      const pendingTimerRef = useRef(0)
      const startedRef = useRef(null)
      const currentRef = useRef(current)
      currentRef.current = current
      const docRef = useRef(doc)
      docRef.current = doc
      const [size, setSize] = useState(null)
      const [rendering, setRendering] = useState(false)
      const [error, setError] = useState('')
      const label = tr(t, 'pdfPageLabel', { n: pageNumber })
      const height = size !== null && Math.abs(size.width - pageWidth) < 1 ? size.height : defaultHeight

      useEffect(() => {
        registerPage(pageNumber, hostRef.current)
        return () => registerPage(pageNumber, null)
      }, [pageNumber, registerPage])

      useEffect(() => {
        renderedRef.current = false
      }, [pdfApi, pageWidth])

      useEffect(() => {
        if (!active) {
          renderedRef.current = false
          startRenderRef.current = null
          return undefined
        }
        if (pdfApi === null || pageWidth <= 0) return undefined
        if (renderedRef.current) return undefined
        let cancelled = false
        let timer = 0
        let imageController = null
        // Only a page that actually put pixels on its canvas is marked done.
        // A run that lost its canvas mid-flight must stay retryable.
        let painted = false
        // Identity token rather than a boolean: a cancelled render can finish
        // after the next one starts, and it must not clear the new run's flag.
        const runToken = {}
        const run = async () => {
          if (startedRef.current === runToken) return
          startedRef.current = runToken
          if (pendingTimerRef.current !== 0) {
            window.clearTimeout(pendingTimerRef.current)
            pendingTimerRef.current = 0
          }
          setRendering(true)
          setError('')
          try {
            const page = await pdfApi.pdf.getPage(pageNumber)
            if (cancelled) return
            const base = page.getViewport({ scale: 1 })
            const viewport = page.getViewport({ scale: pageWidth / base.width })
            const canvas = canvasRef.current
            const textLayerElement = textLayerRef.current
            if (canvas === null || textLayerElement === null) return
            imageController = new AbortController()
            const image = await fetchPageImage(docRef.current, pageNumber, pageWidth, imageController.signal)
            if (cancelled) return
            onEngine?.(image !== null ? 'pdfium' : 'pdfjs')
            textLayerElement.replaceChildren()
            textLayerElement.style.setProperty('--scale-factor', String(viewport.scale))
            textLayerElement.style.setProperty('--total-scale-factor', String(viewport.scale))
            if (image !== null) {
              await paintPageImage(canvas, image, viewport)
              painted = true
              setSize({ width: viewport.width, height: viewport.height })
            } else {
              let ratio = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1))
              while (viewport.width * viewport.height * ratio * ratio > CONTINUOUS_PAGE_MAX_PIXELS && ratio > 1) {
                ratio = Math.max(1, ratio * 0.85)
              }
              canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
              canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
              canvas.style.width = `${viewport.width}px`
              canvas.style.height = `${viewport.height}px`
              const context = canvas.getContext('2d', { alpha: false })
              if (context === null) throw new Error('浏览器无法创建 PDF 画布。')
              context.save()
              context.fillStyle = '#ffffff'
              context.fillRect(0, 0, canvas.width, canvas.height)
              context.restore()
              setSize({ width: viewport.width, height: viewport.height })
              const renderTask = page.render({
                canvasContext: context,
                viewport,
                background: '#ffffff',
                transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
              })
              renderTaskRef.current = renderTask
              await renderTask.promise
              if (cancelled) return
              painted = true
            }
            const textContent = await page.getTextContent()
            if (cancelled) return
            const textLayer = new pdfApi.pdfjs.TextLayer({
              textContentSource: textContent,
              container: textLayerElement,
              viewport,
            })
            textLayerElement.style.width = `${viewport.width}px`
            textLayerElement.style.height = `${viewport.height}px`
            textLayerApiRef.current = textLayer
            await textLayer.render()
          } catch (renderError) {
            if (cancelled) return
            if (renderError?.name === 'RenderingCancelledException') return
            setError(renderError instanceof Error ? renderError.message : String(renderError))
          } finally {
            if (startedRef.current === runToken) startedRef.current = null
            if (!cancelled) {
              if (painted) renderedRef.current = true
              setRendering(false)
            }
          }
        }
        // The page under the reading position gets the renderer first. Pages
        // already on screen as neighbours wait briefly so a jump to an
        // unvisited page does not queue behind the pages around it.
        startRenderRef.current = run
        if (currentRef.current) {
          void run()
        } else {
          timer = window.setTimeout(() => { void run() }, CONTINUOUS_NEIGHBOUR_DELAY)
          pendingTimerRef.current = timer
        }
        return () => {
          cancelled = true
          startRenderRef.current = null
          if (startedRef.current === runToken) startedRef.current = null
          if (timer !== 0) window.clearTimeout(timer)
          pendingTimerRef.current = 0
          try { imageController?.abort() } catch { /* ignore */ }
          try { renderTaskRef.current?.cancel() } catch { /* ignore */ }
          try { textLayerApiRef.current?.cancel() } catch { /* ignore */ }
          renderTaskRef.current = null
          textLayerApiRef.current = null
        }
      }, [active, pdfApi, pageNumber, pageWidth])

      // A queued neighbour that turns into the page under the reading position
      // starts at once. The render effect itself is left alone, so the canvas
      // and text layer of the page just left behind are not torn down.
      useEffect(() => {
        if (!current || !active || renderedRef.current) return
        startRenderRef.current?.()
      }, [current, active])

      return h('div', {
        ref: hostRef,
        className: cls('dsr-pdf-page-block', current && 'is-current'),
        'data-page': pageNumber,
        style: { width: `${pageWidth}px` },
      },
        h('div', { className: 'dsr-pdf-page-no' }, label),
        h('div', {
          className: 'dsr-pdf-page',
          'data-page': pageNumber,
          style: { width: `${pageWidth}px`, height: `${height}px` },
        },
          active
            ? h(React.Fragment, null,
              h('canvas', { ref: canvasRef, className: 'dsr-pdf-canvas', 'aria-hidden': true }),
              h('div', { ref: textLayerRef, className: 'dsr-pdf-textLayer' }),
              error !== ''
                ? h('div', { className: 'dsr-pdf-page-placeholder' }, h(Icon, { name: 'alert', size: 13 }), h('span', null, error))
                : rendering || size === null
                  ? h('div', { className: 'dsr-pdf-page-placeholder' }, h(Spinner, null), h('span', null, t('pdfLoadingPage')))
                  : null
            )
            : h('div', { className: 'dsr-pdf-page-placeholder' }, h('span', null, label))
        )
      )
    })

    const ContinuousPdf = React.memo(function ContinuousPdf({ pdfApi, width, doc, pageCount, pageNumber, t, onSelect, onPageChange, onPositionBlock, onEngine, scrollRef }) {
      const pageWidth = Math.min(width, CONTINUOUS_PAGE_MAX_WIDTH)
      const [defaultHeight, setDefaultHeight] = useState(() => Math.round(pageWidth * 1.414))
      const [activePages, setActivePages] = useState(() => new Set())
      const pageElementsRef = useRef(new Map())
      const observerRef = useRef(null)
      const reportedPageRef = useRef(0)
      const lastPageRef = useRef(pageNumber)
      const docRef = useRef(doc)
      const onSelectRef = useRef(onSelect)
      const onPageChangeRef = useRef(onPageChange)
      const onPositionBlockRef = useRef(onPositionBlock)
      docRef.current = doc
      onSelectRef.current = onSelect
      onPageChangeRef.current = onPageChange
      onPositionBlockRef.current = onPositionBlock

      useEffect(() => {
        const previous = lastPageRef.current
        lastPageRef.current = pageNumber
        const jumped = Math.abs(pageNumber - previous) > 1
        setActivePages(prev => {
          if (!jumped && prev.has(pageNumber)) return prev
          const next = jumped ? new Set() : new Set(prev)
          next.add(pageNumber)
          return next
        })
      }, [pageNumber])

      // Warm up the current page as soon as the pager/TOC selects it, before
      // the scroll settles and before any neighbouring page starts. PDFs are
      // rasterized by the host, so the text layer is the only PDF.js work on
      // the critical path: prefetching the operator list would decode every
      // full-page scan image and stall the shared worker instead.
      useEffect(() => {
        if (pdfApi === null || pageNumber <= 0) return
        const hostRasterized = docRef.current?.extension === 'pdf'
        void (async () => {
          try {
            const page = await pdfApi.pdf.getPage(pageNumber)
            if (hostRasterized) await page.getTextContent()
            else await page.getOperatorList()
          } catch { /* the page may already be gone */ }
        })()
      }, [pdfApi, pageNumber])

      useEffect(() => {
        let cancelled = false
        setDefaultHeight(Math.round(pageWidth * 1.414))
        void (async () => {
          try {
            const first = await pdfApi.pdf.getPage(1)
            if (cancelled) return
            const viewport = first.getViewport({ scale: 1 })
            if (viewport.width > 0) setDefaultHeight(Math.round(pageWidth * viewport.height / viewport.width))
          } catch { /* keep the A4 fallback */ }
        })()
        return () => { cancelled = true }
      }, [pdfApi, pageWidth])

      const registerPage = useCallback((number, element) => {
        const previous = pageElementsRef.current.get(number)
        if (previous === element) return
        if (previous !== undefined && observerRef.current !== null) {
          try { observerRef.current.unobserve(previous) } catch { /* ignore */ }
        }
        if (element === null || element === undefined) {
          pageElementsRef.current.delete(number)
        } else {
          pageElementsRef.current.set(number, element)
          try { observerRef.current?.observe(element) } catch { /* ignore */ }
        }
      }, [])

      useEffect(() => {
        const root = scrollRef.current
        if (root === null || root === undefined) return undefined
        if (typeof IntersectionObserver === 'undefined') {
          const all = new Set()
          for (let number = 1; number <= pageCount; number += 1) all.add(number)
          setActivePages(all)
          return undefined
        }
        const observer = new IntersectionObserver(entries => {
          setActivePages(previous => {
            let changed = false
            const next = new Set(previous)
            for (const entry of entries) {
              const number = Number(entry.target.dataset.page)
              if (!Number.isInteger(number)) continue
              if (entry.isIntersecting) {
                if (!next.has(number)) {
                  next.add(number)
                  changed = true
                }
              } else if (next.delete(number)) {
                changed = true
              }
            }
            return changed ? next : previous
          })
        }, { root, rootMargin: '600px 0px 600px 0px', threshold: 0 })
        observerRef.current = observer
        for (const element of pageElementsRef.current.values()) observer.observe(element)
        return () => {
          observer.disconnect()
          observerRef.current = null
        }
      }, [scrollRef, pageCount])

      // Scroll the container when the pager (or a mode switch) selects a page.
      // reportedPageRef prevents a programmatic scroll from bouncing back into
      // onPageChange.
      useEffect(() => {
        const container = scrollRef.current
        if (container === null || container === undefined) return
        const element = pageElementsRef.current.get(pageNumber)
        if (element === undefined) return
        if (reportedPageRef.current === pageNumber) return
        const top = element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 10
        container.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
        reportedPageRef.current = pageNumber
      }, [pageNumber, scrollRef, pageCount])

      useEffect(() => {
        const container = scrollRef.current
        if (container === null || container === undefined) return undefined
        let frame = 0
        const update = () => {
          frame = 0
          const line = container.getBoundingClientRect().top + 36
          let current = 1
          for (let number = 1; number <= pageCount; number += 1) {
            const element = pageElementsRef.current.get(number)
            if (element === undefined) continue
            const rect = element.getBoundingClientRect()
            if (rect.top <= line) current = number
            else break
          }
          // A short final page cannot reach the reading line; make the bottom
          // of the scroll container count as the last page explicitly.
          if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) current = pageCount
          if (current === reportedPageRef.current) return
          reportedPageRef.current = current
          onSelectRef.current?.(null)
          try { window.getSelection()?.removeAllRanges() } catch { /* ignore */ }
          onPageChangeRef.current?.(current)
          const block = blockForPdfPage(docRef.current, current, pageCount, '')
          if (block !== undefined) onPositionBlockRef.current?.(block.id)
        }
        const onScroll = () => {
          if (frame === 0) frame = requestAnimationFrame(update)
        }
        container.addEventListener('scroll', onScroll, { passive: true })
        frame = requestAnimationFrame(update)
        return () => {
          container.removeEventListener('scroll', onScroll)
          if (frame !== 0) cancelAnimationFrame(frame)
        }
      }, [scrollRef, pageCount])

      useEffect(() => {
        const onChange = () => {
          const selection = window.getSelection()
          if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
            const focused = document.activeElement
            if (focused !== null && typeof focused.closest === 'function' && focused.closest('.dsr-selection') !== null) return
            onSelectRef.current?.(null)
            return
          }
          const range = selection.getRangeAt(0)
          const startElement = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement
          if (startElement !== null && startElement !== undefined && typeof startElement.closest === 'function' && startElement.closest('.dsr-selection') !== null) return
          if (startElement === null || startElement === undefined || typeof startElement.closest !== 'function' || startElement.closest('.dsr-pdf-textLayer') === null) {
            onSelectRef.current?.(null)
            return
          }
          const host = pageHostFor(range.startContainer)
          if (host === null) {
            onSelectRef.current?.(null)
            return
          }
          const page = Number(host.dataset.page)
          if (!Number.isInteger(page)) return
          const text = selection.toString().replace(/\u00a0/g, ' ').trim()
          if (text.length < 2) {
            onSelectRef.current?.(null)
            return
          }
          const rect = range.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) return
          const block = blockForPdfPage(docRef.current, page, pageCount, text)
          if (block === undefined) {
            onSelectRef.current?.(null)
            return
          }
          onSelectRef.current?.({
            text: text.slice(0, MAX_SELECTION),
            blockId: block.id,
            page: block.page,
            pdfPage: page,
            crop: cropForRect(host.querySelector('.dsr-pdf-page'), rect),
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom },
            truncated: text.length > MAX_SELECTION,
            source: 'original',
          })
        }
        document.addEventListener('selectionchange', onChange)
        return () => document.removeEventListener('selectionchange', onChange)
      }, [pageCount])

      const readingPage = Math.min(Math.max(pageNumber, 1), Math.max(pageCount, 1))
      const nearbyFrom = readingPage - CONTINUOUS_NEARBY_PAGES
      const nearbyTo = readingPage + CONTINUOUS_NEARBY_PAGES

      return h('div', { className: 'dsr-pdf-flow' },
        Array.from({ length: pageCount }, (_, index) => {
          const number = index + 1
          return h(ContinuousPage, {
            key: number,
            pdfApi,
            doc,
            pageNumber: number,
            pageWidth,
            defaultHeight,
            active: activePages.has(number) || (number >= nearbyFrom && number <= nearbyTo),
            current: number === pageNumber,
            registerPage,
            onEngine,
            t,
          })
        })
      )
    })

    // ── original view ────────────────────────────────────────────────────────

    function OriginalView({ doc, t, pdfjsInfo, onSelect, onPositionBlock, onPageChange, jumpRequest, onEngine }) {
      const [status, setStatus] = useState('loading')
      const [error, setError] = useState('')
      const [pdfApi, setPdfApi] = useState(null)
      const [pageNumber, setPageNumber] = useState(1)
      const [pageCount, setPageCount] = useState(0)
      const [width, setWidth] = useState(0)
      const [pageSize, setPageSize] = useState({ width: 0, height: 0 })
      const [rendering, setRendering] = useState(false)
      const [pageDraft, setPageDraft] = useState('1')
      const [engine, setEngine] = useState('')
      const [mode, setMode] = useState(() => readStore('originalMode', 'single') === 'continuous' ? 'continuous' : 'single')
      const stageRef = useRef(null)
      const scrollRef = useRef(null)
      const canvasRef = useRef(null)
      const textLayerRef = useRef(null)
      const renderTaskRef = useRef(null)
      const loadingTaskRef = useRef(null)
      const textLayerApiRef = useRef(null)
      const onSelectRef = useRef(onSelect)
      const onPositionBlockRef = useRef(onPositionBlock)
      const onPageChangeRef = useRef(onPageChange)
      const jumpTokenRef = useRef(0)
      const tRef = useRef(t)
      const docRef = useRef(doc)
      const onEngineRef = useRef(onEngine)
      onSelectRef.current = onSelect
      onPositionBlockRef.current = onPositionBlock
      onPageChangeRef.current = onPageChange
      tRef.current = t
      docRef.current = doc
      onEngineRef.current = onEngine

      // Surface the active renderer to the panel-level diagnostics.
      useEffect(() => {
        onEngineRef.current?.(engine)
      }, [engine])

      useEffect(() => {
        if (mode === 'continuous') setPageDraft(String(pageNumber))
      }, [mode, pageNumber])

      useEffect(() => {
        if (status !== 'ready' || pageCount <= 0) return
        onPageChangeRef.current?.(pageNumber, pageCount)
      }, [status, pageNumber, pageCount])

      useEffect(() => {
        if (status !== 'ready' || pageCount <= 0 || doc.pages.length === 0) return
        const block = blockForPdfPage(doc, pageNumber, pageCount, '')
        if (block !== undefined) onPositionBlockRef.current?.(block.id)
      }, [doc.pages.length, status, pageNumber, pageCount])

      useEffect(() => {
        if (jumpRequest === null || jumpRequest === undefined) return
        if (status !== 'ready' || pageCount <= 0) return
        if (jumpRequest.token === jumpTokenRef.current) return
        jumpTokenRef.current = jumpRequest.token
        const target = pdfPageForBlock(doc, jumpRequest.blockId, pageCount)
        if (target === undefined) return
        onSelectRef.current?.(null)
        setPageNumber(target)
        setPageDraft(String(target))
      }, [jumpRequest, status, pageCount, doc])

      const handleContinuousPage = useCallback(next => {
        setPageNumber(next)
        setPageDraft(String(next))
      }, [])

      const switchMode = next => {
        if (next === mode) return
        onSelectRef.current?.(null)
        try { window.getSelection()?.removeAllRanges() } catch { /* ignore */ }
        setMode(next)
        writeStore('originalMode', next)
      }

      useEffect(() => {
        let cancelled = false
        let pdfDocument = null
        let fetchController = null
        onSelectRef.current?.(null)
        setStatus('loading')
        setError('')
        setPdfApi(null)
        setPageCount(0)
        setPageNumber(1)
        setPageDraft('1')
        setPageSize({ width: 0, height: 0 })
        setRendering(false)
        setEngine('')
        void (async () => {
          try {
            if (pdfjsInfo === undefined || pdfjsInfo === null) {
              throw new Error(tRef.current('pdfjsUnavailable'))
            }
            const pdfjs = await loadPdfjs(pdfjsInfo)
            if (cancelled) return
            const previewUrl = `${APP_BASE}/preview?id=${encodeURIComponent(doc.id)}`
            const common = {
              cMapUrl: vendorUrl(pdfjsInfo.cMapUrl),
              cMapPacked: true,
              standardFontDataUrl: vendorUrl(pdfjsInfo.standardFontDataUrl),
              wasmUrl: vendorUrl(pdfjsInfo.wasmUrl),
              iccUrl: vendorUrl(pdfjsInfo.iccUrl),
              isEvalSupported: false,
              useSystemFonts: true,
              verbosity: 0,
            }
            let loaded = null
            if (doc.extension === 'pdf') {
              // PDFium renders the page canvas; PDF.js only supplies the text
              // layer. Load the PDF once as data so PDF.js does not spend
              // seconds walking huge tail ranges of scanned documents.
              fetchController = new AbortController()
              const response = await fetch(previewUrl, {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: fetchController.signal,
              })
              if (!response.ok) {
                const body = await response.json().catch(() => undefined)
                throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
              }
              const bytes = new Uint8Array(await response.arrayBuffer())
              if (cancelled) return
              const task = pdfjs.getDocument({ ...common, data: bytes })
              loadingTaskRef.current = task
              loaded = await task.promise
            } else {
              const task = pdfjs.getDocument({
                ...common,
                url: previewUrl,
                disableAutoFetch: true,
                rangeChunkSize: 262144,
              })
              loadingTaskRef.current = task
              loaded = await task.promise
            }
            loadingTaskRef.current = null
            pdfDocument = loaded
            if (cancelled) {
              try { void pdfDocument.destroy().catch(() => {}) } catch { /* ignore */ }
              pdfDocument = null
              return
            }
            setPdfApi({ pdfjs, pdf: pdfDocument })
            setPageCount(pdfDocument.numPages)
            setStatus('ready')
            const first = blockForPdfPage(docRef.current, 1, pdfDocument.numPages, '')
            if (first !== undefined) onPositionBlockRef.current?.(first.id)
          } catch (loadError) {
            if (cancelled) return
            const message = loadError instanceof Error ? loadError.message : String(loadError)
            const password = loadError?.name === 'PasswordException'
              || message === 'password-protected'
              || /password/i.test(message)
            setError(password ? tRef.current('pdfPassword') : message === 'pdfjs-unavailable' ? tRef.current('pdfjsUnavailable') : message)
            setStatus('error')
          }
        })()
        return () => {
          cancelled = true
          try { fetchController?.abort() } catch { /* ignore */ }
          try { renderTaskRef.current?.cancel() } catch { /* ignore */ }
          try { textLayerApiRef.current?.cancel() } catch { /* ignore */ }
          try { loadingTaskRef.current?.destroy()?.catch?.(() => {}) } catch { /* ignore */ }
          renderTaskRef.current = null
          textLayerApiRef.current = null
          loadingTaskRef.current = null
          if (pdfDocument !== null) {
            try { void pdfDocument.destroy().catch(() => {}) } catch { /* ignore */ }
          }
        }
      }, [doc.id, pdfjsInfo?.module])

      useEffect(() => {
        if (status !== 'ready') return undefined
        const element = stageRef.current
        if (element === null) return undefined
        const measure = () => {
          const available = Math.max(260, element.clientWidth - 8)
          // Fit the page to the reading area. The cap only guards against
          // absurdly wide windows; it must stay high enough that ordinary
          // desktop panels render the page at full size.
          const next = Math.min(1440, available)
          // ResizeObserver also fires when the rendered page height changes.
          // Only treat a real width change as a re-render trigger.
          setWidth(previous => Math.abs(previous - next) < 8 ? previous : next)
        }
        measure()
        if (typeof ResizeObserver === 'undefined') {
          window.addEventListener('resize', measure)
          return () => window.removeEventListener('resize', measure)
        }
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
      }, [status, mode])

      useEffect(() => {
        if (status !== 'ready' || pdfApi === null || width <= 0 || mode !== 'single') return undefined
        let cancelled = false
        let imageController = null
        setRendering(true)
        setError('')
        const run = async () => {
          try {
            const page = await pdfApi.pdf.getPage(pageNumber)
            if (cancelled) return
            const base = page.getViewport({ scale: 1 })
            const scale = width / base.width
            const viewport = page.getViewport({ scale })
            const canvas = canvasRef.current
            const textLayerElement = textLayerRef.current
            if (canvas === null || textLayerElement === null) return
            imageController = new AbortController()
            const image = await fetchPageImage(docRef.current, pageNumber, width, imageController.signal)
            if (cancelled) return
            setEngine(image !== null ? 'pdfium' : 'pdfjs')
            textLayerElement.replaceChildren()
            textLayerElement.style.setProperty('--scale-factor', String(viewport.scale))
            textLayerElement.style.setProperty('--total-scale-factor', String(viewport.scale))
            if (image !== null) {
              await paintPageImage(canvas, image, viewport)
              setPageSize({ width: viewport.width, height: viewport.height })
            } else {
              // Supersample on ordinary 1x displays and render at native
              // density on HiDPI ones (both capped at 2x). Under-sampling the
              // reading surface makes every glyph look washed out.
              let ratio = Math.min(2, Math.max(1.5, window.devicePixelRatio || 1))
              // Bound the canvas backing store so a pathological page or a
              // 4K display cannot exhaust the renderer process. A single A4
              // page at 1440 CSS px wide and 2x is ~11.7 MP, below this cap.
              const maxPixels = 12_000_000
              while (viewport.width * viewport.height * ratio * ratio > maxPixels && ratio > 1) {
                ratio = Math.max(1, ratio * 0.85)
              }
              canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
              canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
              canvas.style.width = `${viewport.width}px`
              canvas.style.height = `${viewport.height}px`
              const context = canvas.getContext('2d', { alpha: false })
              if (context === null) throw new Error('浏览器无法创建 PDF 画布。')
              // With alpha disabled the backing store starts black; paint the
              // paper first so pages with transparent backgrounds stay white.
              context.save()
              context.fillStyle = '#ffffff'
              context.fillRect(0, 0, canvas.width, canvas.height)
              context.restore()
              const renderTask = page.render({
                canvasContext: context,
                viewport,
                background: '#ffffff',
                transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
              })
              renderTaskRef.current = renderTask
              await renderTask.promise
              if (cancelled) return
              setPageSize({ width: viewport.width, height: viewport.height })
            }
            const textContent = await page.getTextContent()
            if (cancelled) return
            const textLayer = new pdfApi.pdfjs.TextLayer({
              textContentSource: textContent,
              container: textLayerElement,
              viewport,
            })
            // Pin the text layer to the exact canvas box even on engines that
            // do not support CSS round(); PDF.js only needs the CSS scale
            // variables for glyph sizing after that.
            textLayerElement.style.width = `${viewport.width}px`
            textLayerElement.style.height = `${viewport.height}px`
            textLayerApiRef.current = textLayer
            await textLayer.render()
            if (cancelled) return
            setPageSize({ width: viewport.width, height: viewport.height })
            setPageDraft(String(pageNumber))
          } catch (renderError) {
            if (cancelled) return
            if (renderError?.name === 'RenderingCancelledException') return
            setError(renderError instanceof Error ? renderError.message : String(renderError))
          } finally {
            if (!cancelled) setRendering(false)
          }
        }
        void run()
        return () => {
          cancelled = true
          try { imageController?.abort() } catch { /* ignore */ }
          try { renderTaskRef.current?.cancel() } catch { /* ignore */ }
          try { textLayerApiRef.current?.cancel() } catch { /* ignore */ }
          renderTaskRef.current = null
          textLayerApiRef.current = null
        }
      }, [status, pdfApi, pageNumber, width, mode])

      useEffect(() => {
        if (status !== 'ready' || mode !== 'single') return
        scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
      }, [status, pageNumber, mode])

      useEffect(() => {
        if (status !== 'ready' || pageCount === 0 || mode !== 'single') return
        onSelectRef.current?.(null)
        const block = blockForPdfPage(docRef.current, pageNumber, pageCount, '')
        if (block !== undefined) onPositionBlockRef.current?.(block.id)
      }, [status, pageNumber, pageCount, mode])

      useEffect(() => {
        if (status !== 'ready' || mode !== 'single') return undefined
        const layer = textLayerRef.current
        if (layer === null) return undefined
        const onChange = () => {
          const selection = window.getSelection()
          if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
            const focused = document.activeElement
            if (focused !== null && typeof focused.closest === 'function' && focused.closest('.dsr-selection') !== null) return
            onSelectRef.current?.(null)
            return
          }
          const range = selection.getRangeAt(0)
          if (!layer.contains(range.commonAncestorContainer)) {
            onSelectRef.current?.(null)
            return
          }
          const text = selection.toString().replace(/\u00a0/g, ' ').trim()
          if (text.length < 2) {
            onSelectRef.current?.(null)
            return
          }
          const rect = range.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) return
          const block = blockForPdfPage(docRef.current, pageNumber, pageCount, text)
          if (block === undefined) {
            onSelectRef.current?.(null)
            return
          }
          onSelectRef.current?.({
            text: text.slice(0, MAX_SELECTION),
            blockId: block.id,
            page: block.page,
            pdfPage: pageNumber,
            crop: cropForRect(textLayerRef.current?.closest('.dsr-pdf-page'), rect),
            rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height, bottom: rect.bottom },
            truncated: text.length > MAX_SELECTION,
            source: 'original',
          })
        }
        document.addEventListener('selectionchange', onChange)
        return () => document.removeEventListener('selectionchange', onChange)
      }, [status, pageNumber, pageCount, mode])

      const goPage = next => {
        const target = Math.min(pageCount, Math.max(1, Number(next) || 1))
        if (target === pageNumber) {
          setPageDraft(String(pageNumber))
          return
        }
        onSelectRef.current?.(null)
        try { window.getSelection()?.removeAllRanges() } catch { /* ignore */ }
        setPageNumber(target)
      }

      const handleRegion = useCallback(({ pageNumber: pdfPage, rect, crop }) => {
        const block = blockForPdfPage(docRef.current, pdfPage, pageCount, '')
        if (block === undefined) return
        onSelectRef.current?.({
          text: '',
          blockId: block.id,
          page: block.page,
          pdfPage,
          crop,
          rect,
          source: 'region',
        })
      }, [pageCount])

      useRegionSelection(scrollRef, status === 'ready', handleRegion)

      const commitPageDraft = () => {
        const next = Number(pageDraft)
        if (Number.isInteger(next) && next >= 1 && next <= pageCount) goPage(next)
        else setPageDraft(String(pageNumber))
      }

      const fallbackUrl = `${APP_BASE}/preview?id=${encodeURIComponent(doc.id)}`
      return h('div', { className: 'dsr-original' },
        h('div', { className: 'dsr-original-bar' },
          h(Icon, { name: 'file', size: 12 }),
          h('span', { className: 'dsr-original-hint' }, t('pdfSelectionHint')),
          engine === ''
            ? null
            : h('span', {
              className: cls('dsr-engine', engine === 'pdfjs' && 'is-fallback'),
              title: engine === 'pdfium' ? t('pdfiumEngine') : t('pdfjsEngine'),
            }, engine === 'pdfium' ? 'PDFium' : 'PDF.js'),
          h('div', { className: 'dsr-pdf-mode', role: 'group', 'aria-label': t('pageMode') },
            h('button', {
              type: 'button',
              className: cls('dsr-seg-btn', mode === 'single' && 'on'),
              'aria-pressed': mode === 'single',
              onClick: () => switchMode('single'),
            }, t('singlePage')),
            h('button', {
              type: 'button',
              className: cls('dsr-seg-btn', mode === 'continuous' && 'on'),
              'aria-pressed': mode === 'continuous',
              onClick: () => switchMode('continuous'),
            }, t('continuousPages'))
          ),
          h('div', { className: 'dsr-pdf-pager' },
            h('button', {
              type: 'button',
              className: 'dsr-icon-btn',
              disabled: status !== 'ready' || pageNumber <= 1,
              onClick: () => goPage(pageNumber - 1),
              title: t('prevPage'),
              'aria-label': t('prevPage'),
            }, h('span', { style: { display: 'flex', transform: 'rotate(180deg)' } }, h(Icon, { name: 'chevron', size: 13 }))),
            h('input', {
              className: 'dsr-pdf-page-input',
              inputMode: 'numeric',
              value: pageDraft,
              onChange: event => setPageDraft(event.target.value.replace(/[^\d]/g, '')),
              onKeyDown: event => { if (event.key === 'Enter') commitPageDraft() },
              'aria-label': t('pageInput'),
              disabled: status !== 'ready',
            }),
            h('span', { className: 'dsr-pdf-count' }, `/ ${pageCount || '—'}`),
            h('button', {
              type: 'button',
              className: 'dsr-icon-btn',
              disabled: status !== 'ready' || pageNumber >= pageCount,
              onClick: () => goPage(pageNumber + 1),
              title: t('nextPage'),
              'aria-label': t('nextPage'),
            }, h(Icon, { name: 'chevron', size: 13 }))
          ),
          h('a', { className: 'dsr-btn', href: fallbackUrl, target: '_blank', rel: 'noreferrer noopener' }, t('originalNewTab'))
        ),
        engine === 'pdfjs'
          ? h('div', { className: 'dsr-original-warnings' },
            h('div', { className: 'dsr-warning' }, h(Icon, { name: 'alert', size: 12 }), h('span', null, tr(t, 'pdfCompatWarning', { version: pluginVersion || '?' }))))
          : null,
        status === 'loading'
          ? h('div', { className: 'dsr-original-loading' }, h(Spinner, null), h('span', null, t('originalLoading')))
          : status === 'error'
            ? h(React.Fragment, null,
              h('div', { className: 'dsr-pdf-fallback', style: { margin: '14px auto' } },
                h('h3', null, t('pdfRenderFailed')),
                h('p', null, error),
                h('a', { className: 'dsr-btn', href: fallbackUrl, target: '_blank', rel: 'noreferrer noopener' }, t('originalNewTab'))
              ),
              // Keep a readable original even when the selectable PDF.js
              // layer cannot load (for example, a blocked dynamic import).
              h('iframe', {
                className: 'dsr-native-frame',
                src: fallbackUrl,
                title: doc.name,
              })
            )
            : h('div', { className: 'dsr-pdf-scroll', ref: scrollRef },
              mode === 'single' && error !== ''
                ? h('div', { className: 'dsr-inline-error', style: { margin: '0 auto 14px', maxWidth: 760 } }, h(Icon, { name: 'alert', size: 13 }), h('span', null, error))
                : null,
              mode === 'single'
                ? h('div', { className: 'dsr-pdf-stage', ref: stageRef },
                  width > 0
                    ? h('div', {
                      className: 'dsr-pdf-page',
                      'data-page': pageNumber,
                      style: {
                        width: `${pageSize.width > 0 ? pageSize.width : width}px`,
                        height: `${pageSize.height > 0 ? pageSize.height : Math.round(width * 1.4)}px`,
                      },
                    },
                      h('canvas', { ref: canvasRef, className: 'dsr-pdf-canvas', 'aria-hidden': true }),
                      h('div', { ref: textLayerRef, className: 'dsr-pdf-textLayer' }),
                      rendering || pageSize.width === 0
                        ? h('div', { className: 'dsr-pdf-busy' }, h(Spinner, null), t('pdfLoadingPage'))
                        : null
                    )
                    : h('div', { className: 'dsr-original-loading' }, h(Spinner, null), h('span', null, t('pdfLoadingPage')))
                )
                : h('div', { className: 'dsr-pdf-flow', ref: stageRef },
                  width > 0
                    ? h(ContinuousPdf, {
                      key: doc.id,
                      pdfApi,
                      width,
                      doc,
                      pageCount,
                      pageNumber,
                      t,
                      onSelect,
                      onPageChange: handleContinuousPage,
                      onPositionBlock,
                      onEngine: setEngine,
                      scrollRef,
                    })
                    : h('div', { className: 'dsr-original-loading' }, h(Spinner, null), h('span', null, t('pdfLoadingPage')))
                )
            )
      )
    }

    // ── main page ────────────────────────────────────────────────────────────

    // Turn the flat outline list into rows: chapter rows stay visible, their
    // descendants are emitted only while that chapter is expanded. Documents
    // without a chapter level (for example slide decks) stay a flat list.
    function buildTocPlan(toc, expanded) {
      const nodes = []
      if (toc.length === 0) return { chapters: 0, nodes }
      const levelOf = item => Math.min(3, Math.max(1, Number(item?.level) || 1))
      const starts = []
      for (let index = 0; index < toc.length; index += 1) {
        if (levelOf(toc[index]) === 1) starts.push(index)
      }
      const pushItem = (item, index) => nodes.push({ kind: 'item', item, index, level: levelOf(item) })
      if (starts.length === 0) {
        for (let index = 0; index < toc.length; index += 1) pushItem(toc[index], index)
        return { chapters: 0, nodes }
      }
      // A few outlines start with entries above the first chapter; keep those
      // visible instead of hiding them under a chapter that does not own them.
      for (let index = 0; index < starts[0]; index += 1) pushItem(toc[index], index)
      starts.forEach((start, ordinal) => {
        const end = ordinal + 1 < starts.length ? starts[ordinal + 1] : toc.length
        const children = end - start - 1
        const open = expanded.has(start)
        nodes.push({ kind: 'chapter', item: toc[start], index: start, level: 1, children, open })
        if (children > 0 && open) {
          for (let index = start + 1; index < end; index += 1) pushItem(toc[index], index)
        }
      })
      return { chapters: starts.length, nodes }
    }

    function StudyShell(props) {
      const { t } = useI18n(props.ctx)
      return h(StudyBoundary, { t }, h(StudyPage, props))
    }

    function StudyPage({ ctx }) {
      const { t, lang } = useI18n(ctx)
      const [boot, setBoot] = useState(null)
      const [bootError, setBootError] = useState('')
      const [doc, setDoc] = useState(null)
      const [openingPath, setOpeningPath] = useState(null)
      const [openError, setOpenError] = useState('')
      const [browserOpen, setBrowserOpen] = useState(false)
      const [recent, setRecent] = useState(() => {
        const value = readStore('recent', [])
        return Array.isArray(value) ? value.filter(entry => entry !== null && typeof entry === 'object' && typeof entry.path === 'string') : []
      })
      const [mode, setMode] = useState(() => readStore('mode', 'learn') === 'reread' ? 'reread' : 'learn')
      const [targetLanguage, setTargetLanguage] = useState(() => readStore('targetLanguage', ''))
      const [chatOpen, setChatOpen] = useState(() => {
        const stored = readStore('chatOpen', null)
        return typeof stored === 'boolean' ? stored : (typeof window !== 'undefined' ? window.innerWidth > 1180 : true)
      })
      const [panelTab, setPanelTab] = useState('chat')
      const [messages, setMessages] = useState([])
      const [busy, setBusy] = useState(false)
      const [pendingQuote, setPendingQuote] = useState(null)
      const [translations, setTranslations] = useState([])
      const [translationBusy, setTranslationBusy] = useState(false)
      const [selection, setSelection] = useState(null)
      const [activePage, setActivePage] = useState(0)
      const [pdfPageCount, setPdfPageCount] = useState(0)
      const [jumpRequest, setJumpRequest] = useState(null)
      const [positionBlock, setPositionBlock] = useState(0)
      const [progress, setProgress] = useState(0)
      const [tocOpen, setTocOpen] = useState(false)
      const [expandedToc, setExpandedToc] = useState(() => new Set())
      const [searchOpen, setSearchOpen] = useState(false)
      const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
      const [engine, setEngine] = useState('')
      const [toast, setToast] = useState('')
      const askAbortRef = useRef(null)
      const translationAbortRef = useRef(null)
      const restoredRef = useRef(false)
      const chatDocRef = useRef(null)
      const translationDocRef = useRef(null)
      const openingRef = useRef(null)
      const docRef = useRef(null)
      const tocRef = useRef(null)

      useEffect(() => { docRef.current = doc }, [doc])

      // A new document starts with every chapter collapsed.
      useEffect(() => {
        setExpandedToc(new Set())
        setSearchOpen(false)
        setEngine('')
      }, [doc?.id])

      useModalFocus(tocOpen, () => setTocOpen(false), tocRef)

      const toggleTocChapter = useCallback(index => {
        setExpandedToc(previous => {
          const next = new Set(previous)
          if (next.has(index)) next.delete(index)
          else next.add(index)
          return next
        })
      }, [])

      const tocPlan = useMemo(
        () => buildTocPlan(doc?.toc ?? [], expandedToc),
        [doc?.toc, expandedToc],
      )

      const showToast = useCallback(message => {
        setToast(message)
        window.setTimeout(() => setToast(current => current === message ? '' : current), 2400)
      }, [])

      const rememberRecent = useCallback(nextDoc => {
        const entry = {
          path: nextDoc.path,
          name: nextDoc.name,
          extension: nextDoc.extension,
          size: nextDoc.size,
          time: Date.now(),
        }
        setRecent(previous => {
          const next = [entry, ...previous.filter(item => item.path !== entry.path)].slice(0, 12)
          writeStore('recent', next)
          return next
        })
      }, [])

      const openPath = useCallback(async (path, options = {}) => {
        if (openingRef.current !== null) return
        openingRef.current = path
        setOpeningPath(path)
        setOpenError('')
        try {
          askAbortRef.current?.abort()
          translationAbortRef.current?.abort()
          const body = await (async () => {
            const response = await apiPost('/open', { path })
            return response.json()
          })()
          if (body?.ok !== true || body.doc === undefined) throw new Error(body?.error?.message ?? t('parseError'))
          const nextDoc = body.doc
          setDoc(nextDoc)
          setActivePage(0)
          setPdfPageCount(0)
          setJumpRequest(null)
          setPositionBlock(nextDoc.blocks[0]?.id ?? 0)
          setProgress(0)
          setSelection(null)
          setPendingQuote(null)
          setBrowserOpen(false)
          setTocOpen(false)
          writeStore('current', nextDoc.path)
          rememberRecent(nextDoc)
          chatDocRef.current = nextDoc.path
          translationDocRef.current = nextDoc.path
          const storedMessages = readStore(`chat:${nextDoc.path}`, [])
          setMessages(Array.isArray(storedMessages)
            ? storedMessages
              .filter(message => message !== null && typeof message === 'object' && typeof message.role === 'string')
              .map(message => message.pending === true ? { ...message, pending: false, aborted: true } : message)
            : [])
          const storedTranslations = readStore(`translations:${nextDoc.path}`, [])
          setTranslations(Array.isArray(storedTranslations)
            ? storedTranslations
              .filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string')
              .map(item => item.status === 'streaming' ? { ...item, status: 'aborted' } : item)
            : [])
          if (typeof window !== 'undefined' && window.innerWidth <= 1080) setChatOpen(false)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (options.restore === true) {
            setOpenError('')
            showToast(t('restoreFailed'))
            removeStore('current')
          } else {
            setOpenError(message)
            setBrowserOpen(true)
          }
        } finally {
          openingRef.current = null
          setOpeningPath(null)
        }
      }, [rememberRecent, showToast, t])

      useEffect(() => {
        if (doc === null || doc.extraction !== 'pending') return undefined
        let alive = true
        void (async () => {
          try {
            const response = await apiPost('/extract', { docId: doc.id })
            const body = await response.json().catch(() => undefined)
            if (!alive) return
            if (body?.ok !== true || body.doc === undefined) {
              throw new Error(body?.error?.message ?? t('extractFailed'))
            }
            setDoc(previous => previous !== null && previous.id === body.doc.id ? body.doc : previous)
          } catch (error) {
            if (!alive) return
            const message = error instanceof Error ? error.message : String(error)
            setDoc(previous => previous !== null && previous.id === doc.id
              ? { ...previous, extraction: 'error', warnings: [...(previous.warnings ?? []), `${t('extractFailed')}${message}`] }
              : previous)
          }
        })()
        return () => { alive = false }
      }, [doc?.id, doc?.extraction, t])

      useEffect(() => {
        let alive = true
        void (async () => {
          try {
            const body = await apiGet('/bootstrap')
            if (!alive) return
            setBoot(body)
            pluginVersion = typeof body.version === 'string' ? body.version : ''
            if (targetLanguage === '') {
              const next = body.defaults?.defaultTargetLanguage ?? 'zh-CN'
              setTargetLanguage(next)
              writeStore('targetLanguage', next)
            }
            if (!restoredRef.current) {
              restoredRef.current = true
              const current = readStore('current', '')
              if (typeof current === 'string' && current !== '' && docRef.current === null) {
                void openPath(current, { restore: true })
              }
            }
          } catch (error) {
            if (alive) setBootError(error instanceof Error ? error.message : String(error))
          }
        })()
        return () => { alive = false }
        // Bootstrap only once; openPath stabilizes on its own state dependencies.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        writeStore('chatOpen', chatOpen)
      }, [chatOpen])

      useEffect(() => {
        if (doc === null || chatDocRef.current !== doc.path) return undefined
        const timer = window.setTimeout(() => {
          const trimmed = messages.slice(-40)
          if (trimmed.length === 0) removeStore(`chat:${doc.path}`)
          else writeStore(`chat:${doc.path}`, trimmed)
        }, 220)
        return () => window.clearTimeout(timer)
      }, [doc, messages])

      useEffect(() => {
        if (doc === null || translationDocRef.current !== doc.path) return undefined
        const timer = window.setTimeout(() => {
          if (translations.length === 0) removeStore(`translations:${doc.path}`)
          else writeStore(`translations:${doc.path}`, translations.slice(0, 20))
        }, 220)
        return () => window.clearTimeout(timer)
      }, [doc, translations])

      useEffect(() => () => {
        try { askAbortRef.current?.abort() } catch { /* request already settled */ }
        try { translationAbortRef.current?.abort() } catch { /* request already settled */ }
      }, [])

      useEffect(() => {
        const onKey = event => {
          if (event.key !== 'Escape') return
          setSelection(null)
          setTocOpen(false)
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [])

      const onPdfSelection = useCallback(selection => {
        setSelection(selection)
        if (selection !== null) {
          setPositionBlock(selection.blockId)
        }
      }, [])

      const onPdfPosition = useCallback(blockId => {
        setPositionBlock(blockId)
      }, [])

      const onPdfPage = useCallback((page, total) => {
        const safePage = Math.max(1, Number(page) || 1)
        const safeTotal = Math.max(0, Number(total) || 0)
        setActivePage(safePage - 1)
        setPdfPageCount(safeTotal)
        setProgress(safeTotal <= 1
          ? 100
          : Math.min(100, Math.max(0, ((safePage - 1) / (safeTotal - 1)) * 100)))
      }, [])

      const setModePersisted = useCallback(next => {
        setMode(next)
        writeStore('mode', next)
      }, [])

      const setTargetLanguagePersisted = useCallback(next => {
        setTargetLanguage(next)
        writeStore('targetLanguage', next)
      }, [])

      const setChatOpenPersisted = useCallback(updater => {
        setChatOpen(updater)
      }, [])

      const currentBlock = doc?.blocks?.[positionBlock] ?? doc?.blocks?.[0]
      const currentHeading = currentBlock !== undefined && doc !== null
        ? [...(doc.toc ?? [])].reverse().find(item => item.blockId <= currentBlock.id)
        : undefined
      const positionLabel = currentBlock !== undefined
        ? `${doc.pages[currentBlock.page]?.label ?? ''}${currentHeading === undefined ? '' : ` · ${currentHeading.title}`}`
        : ''

      const sendQuestion = useCallback(async (question, quote = null, options = {}) => {
        if (doc === null || busy) return
        const clean = String(question).trim()
        if (clean === '') return
        const history = messages
          .filter(message => message.pending !== true && message.error === undefined && message.aborted !== true)
          .slice(-10)
          .map(message => ({ role: message.role, content: message.text }))
        const userMessage = {
          id: uid(),
          role: 'user',
          text: clean,
          quote: quote?.text || (quote?.crop ? t('quoteRegion') : null),
          time: Date.now(),
          mode,
        }
        const assistantId = uid()
        const assistantMessage = {
          id: assistantId,
          role: 'assistant',
          text: '',
          reasoning: '',
          contextId: '',
          pending: true,
          mode,
          status: '',
          time: Date.now(),
        }
        setMessages(previous => [...previous, userMessage, assistantMessage])
        setPendingQuote(null)
        setBusy(true)
        setPanelTab('chat')
        setChatOpenPersisted(true)
        const controller = new AbortController()
        askAbortRef.current = controller
        const blockId = quote?.blockId ?? positionBlock
        let streamError = null
        // DeepSeek emits one character per delta. Coalesce deltas into one
        // React update per frame rather than re-rendering the Markdown tree
        // hundreds of times for a single answer.
        let pendingText = ''
        let pendingReasoning = ''
        let frameHandle = 0
        let reasoningTimer = 0
        const flushText = () => {
          if (pendingText === '' && pendingReasoning === '') return
          const chunk = pendingText
          const thought = pendingReasoning
          pendingText = ''
          pendingReasoning = ''
          setMessages(previous => previous.map(message => message.id === assistantId
            ? {
              ...message,
              text: message.text + chunk,
              reasoning: appendReasoning(message.reasoning, thought),
            }
            : message))
        }
        const scheduleFlush = () => {
          if (pendingText !== '') {
            if (reasoningTimer !== 0) {
              window.clearTimeout(reasoningTimer)
              reasoningTimer = 0
            }
            if (frameHandle !== 0) return
            frameHandle = window.requestAnimationFrame(() => {
              frameHandle = 0
              flushText()
            })
            return
          }
          // Reasoning-only frames are throttled: a long chain of thought
          // would otherwise re-render the whole message at 60 fps.
          if (reasoningTimer !== 0) return
          reasoningTimer = window.setTimeout(() => {
            reasoningTimer = 0
            flushText()
          }, 120)
        }
        const stopFlush = () => {
          if (frameHandle !== 0) {
            window.cancelAnimationFrame(frameHandle)
            frameHandle = 0
          }
          if (reasoningTimer !== 0) {
            window.clearTimeout(reasoningTimer)
            reasoningTimer = 0
          }
          flushText()
        }
        try {
          await streamPost('/ask', {
            docId: doc.id,
            question: clean,
            mode,
            blockId,
            selection: quote?.text ?? '',
            selectionCrop: quote?.crop ?? null,
            selectionPage: quote?.pdfPage ?? null,
            history,
            overview: options.overview === true,
          }, controller.signal, frame => {
            if (frame.type === 'meta') {
              setMessages(previous => previous.map(message => message.id === assistantId
                ? {
                  ...message,
                  contextId: typeof frame.contextId === 'string' ? frame.contextId : '',
                  provider: frame.provider,
                  model: frame.model,
                }
                : message))
            } else if (frame.type === 'reasoning') {
              if (typeof frame.text === 'string') {
                pendingReasoning += frame.text
                scheduleFlush()
              }
            } else if (frame.type === 'delta') {
              pendingText += frame.text
              scheduleFlush()
            } else if (frame.type === 'status') {
              setMessages(previous => previous.map(message => message.id === assistantId
                ? { ...message, status: frame.text }
                : message))
            } else if (frame.type === 'pages') {
              setMessages(previous => previous.map(message => message.id === assistantId
                ? { ...message, pages: Array.isArray(frame.pages) ? frame.pages : [] }
                : message))
            } else if (frame.type === 'ahead') {
              stopFlush()
              setMessages(previous => previous.map(message => message.id === assistantId
                ? { ...message, ahead: { blockId: frame.blockId, page: frame.page, label: frame.label } }
                : message))
            } else if (frame.type === 'done') {
              stopFlush()
              setMessages(previous => previous.map(message => message.id === assistantId
                ? { ...message, pending: false, model: frame.model, provider: frame.provider }
                : message))
            } else if (frame.type === 'error') {
              stopFlush()
              streamError = frame.message
              setMessages(previous => previous.map(message => message.id === assistantId
                ? { ...message, pending: false, error: frame.message }
                : message))
            } else if (frame.type === 'aborted') {
              stopFlush()
              setMessages(previous => previous.map(message => message.id === assistantId
                ? { ...message, pending: false, aborted: true }
                : message))
            }
          })
          stopFlush()
          if (streamError === null) {
            setMessages(previous => previous.map(message => message.id === assistantId && message.pending
              ? { ...message, pending: false, text: message.text || t('noAnswer') }
              : message))
          }
        } catch (error) {
          stopFlush()
          if (controller.signal.aborted) {
            setMessages(previous => previous.map(message => message.id === assistantId
              ? { ...message, pending: false, aborted: true }
              : message))
          } else {
            const message = error instanceof Error ? error.message : String(error)
            setMessages(previous => previous.map(item => item.id === assistantId
              ? { ...item, pending: false, error: message }
              : item))
          }
        } finally {
          stopFlush()
          if (askAbortRef.current === controller) askAbortRef.current = null
          setBusy(false)
        }
      }, [busy, doc, messages, mode, positionBlock, setChatOpenPersisted, t])

      const stopQuestion = useCallback(() => {
        askAbortRef.current?.abort()
      }, [])

      const askFromSelection = useCallback(() => {
        if (selection === null) return
        setPendingQuote({
          text: selection.text,
          blockId: selection.blockId,
          page: selection.page,
          pdfPage: selection.pdfPage,
          crop: selection.crop,
        })
        setChatOpenPersisted(true)
        setPanelTab('chat')
        setSelection(null)
      }, [selection, setChatOpenPersisted])

      const explainSelection = useCallback(() => {
        if (selection === null || doc === null) return
        const quote = {
          text: selection.text,
          blockId: selection.blockId,
          page: selection.page,
          pdfPage: selection.pdfPage,
          crop: selection.crop,
        }
        setSelection(null)
        void sendQuestion(lang === 'en'
          ? 'Please explain what this passage means in the context of the document.'
          : '请解释这段内容在上下文中的含义，以及它为什么重要。', quote)
      }, [doc, lang, selection, sendQuestion])

      const translateSelection = useCallback(async (target, selected = selection) => {
        if (doc === null || selected === null) return
        setSelection(null)
        setPanelTab('translate')
        setChatOpenPersisted(true)
        translationAbortRef.current?.abort()
        const id = uid()
        const pageLabel = doc.pages[selected.page]?.label ?? ''
        const entry = {
          id,
          source: selected.text || t('quoteRegion'),
          targetLanguage: target || targetLanguage,
          text: '',
          reasoning: '',
          contextId: '',
          status: 'streaming',
          blockId: selected.blockId,
          pageLabel,
          time: Date.now(),
        }
        setTranslations(previous => [entry, ...previous].slice(0, 20))
        setTranslationBusy(true)
        const controller = new AbortController()
        translationAbortRef.current = controller
        let pendingText = ''
        let pendingReasoning = ''
        let frameHandle = 0
        let reasoningTimer = 0
        const flushText = () => {
          if (pendingText === '' && pendingReasoning === '') return
          const chunk = pendingText
          const thought = pendingReasoning
          pendingText = ''
          pendingReasoning = ''
          setTranslations(previous => previous.map(item => item.id === id
            ? {
              ...item,
              text: item.text + chunk,
              reasoning: appendReasoning(item.reasoning, thought),
            }
            : item))
        }
        const scheduleFlush = () => {
          if (pendingText !== '') {
            if (reasoningTimer !== 0) {
              window.clearTimeout(reasoningTimer)
              reasoningTimer = 0
            }
            if (frameHandle !== 0) return
            frameHandle = window.requestAnimationFrame(() => {
              frameHandle = 0
              flushText()
            })
            return
          }
          // Reasoning-only frames are throttled: a long chain of thought
          // would otherwise re-render the whole message at 60 fps.
          if (reasoningTimer !== 0) return
          reasoningTimer = window.setTimeout(() => {
            reasoningTimer = 0
            flushText()
          }, 120)
        }
        const stopFlush = () => {
          if (frameHandle !== 0) {
            window.cancelAnimationFrame(frameHandle)
            frameHandle = 0
          }
          if (reasoningTimer !== 0) {
            window.clearTimeout(reasoningTimer)
            reasoningTimer = 0
          }
          flushText()
        }
        try {
          await streamPost('/translate', {
            docId: doc.id,
            selection: selected.text,
            selectionCrop: selected.crop ?? null,
            selectionPage: selected.pdfPage ?? null,
            blockId: selected.blockId,
            targetLanguage: target || targetLanguage,
          }, controller.signal, frame => {
            if (frame.type === 'meta') {
              setTranslations(previous => previous.map(item => item.id === id
                ? {
                  ...item,
                  contextId: typeof frame.contextId === 'string' ? frame.contextId : '',
                  targetLanguage: typeof frame.targetLanguage === 'string' ? frame.targetLanguage : item.targetLanguage,
                }
                : item))
            } else if (frame.type === 'reasoning') {
              if (typeof frame.text === 'string') {
                pendingReasoning += frame.text
                scheduleFlush()
              }
            } else if (frame.type === 'delta') {
              pendingText += frame.text
              scheduleFlush()
            } else if (frame.type === 'done') {
              stopFlush()
              setTranslations(previous => previous.map(item => item.id === id ? { ...item, status: 'done' } : item))
            } else if (frame.type === 'error') {
              stopFlush()
              setTranslations(previous => previous.map(item => item.id === id ? { ...item, status: 'error', error: frame.message } : item))
            } else if (frame.type === 'aborted') {
              stopFlush()
              setTranslations(previous => previous.map(item => item.id === id ? { ...item, status: 'aborted' } : item))
            }
          })
          stopFlush()
          setTranslations(previous => previous.map(item => item.id === id && item.status === 'streaming'
            ? { ...item, status: 'done' }
            : item))
        } catch (error) {
          stopFlush()
          if (controller.signal.aborted) {
            setTranslations(previous => previous.map(item => item.id === id ? { ...item, status: 'aborted' } : item))
          } else {
            setTranslations(previous => previous.map(item => item.id === id
              ? { ...item, status: 'error', error: error instanceof Error ? error.message : String(error) }
              : item))
          }
        } finally {
          stopFlush()
          if (translationAbortRef.current === controller) translationAbortRef.current = null
          setTranslationBusy(false)
        }
      }, [doc, selection, setChatOpenPersisted, targetLanguage])

      const retranslate = useCallback(item => {
        if (doc === null) return
        setTranslations(previous => previous.filter(entry => entry.id !== item.id))
        void translateSelection(item.targetLanguage, { text: item.source, blockId: item.blockId, page: doc.blocks[item.blockId]?.page ?? 0 })
      }, [doc, translateSelection])

      const clearChat = useCallback(() => {
        if (doc === null) return
        if (messages.length > 0 && !window.confirm(t('clearChatConfirm'))) return
        askAbortRef.current?.abort()
        setMessages([])
        removeStore(`chat:${doc.path}`)
        showToast(t('clearChat'))
      }, [doc, messages.length, showToast, t])

      const clearTranslations = useCallback(() => {
        translationAbortRef.current?.abort()
        setTranslations([])
        if (doc !== null) removeStore(`translations:${doc.path}`)
      }, [doc])

      const scrollToBlock = useCallback(blockId => {
        setTocOpen(false)
        setSelection(null)
        setPositionBlock(blockId)
        setJumpRequest(previous => ({ blockId, token: (previous?.token ?? 0) + 1 }))
      }, [])

      const chatVisible = doc !== null && chatOpen

      const problems = []
      if (bootError !== '') problems.push(bootError)
      if (openError !== '') problems.push(openError)
      if (doc?.extractionError) problems.push(doc.extractionError)
      if (engine === 'pdfjs') problems.push(t('diagNoPdfium'))

      return h('div', { className: 'dsr-root' },
        h(TopBar, {
          doc,
          t,
          chatOpen,
          setChatOpen: setChatOpenPersisted,
          onOpen: () => { setOpenError(''); setBrowserOpen(true) },
          onBack: () => {
            try {
              ctx.get('layout')?.selectPanel(null)
            } catch (error) {
              console.error('[study-reader] could not return to the conversation:', error)
            }
          },
          onToc: () => {
            setSearchOpen(false)
            setTocOpen(value => !value)
          },
          onSearch: () => {
            setTocOpen(false)
            setSearchOpen(value => !value)
          },
          onDiagnostics: () => {
            setTocOpen(false)
            setSearchOpen(false)
            setDiagnosticsOpen(true)
          },
          progress,
          activePage,
          pages: pdfPageCount,
        }),
        h('div', { className: 'dsr-body' },
          bootError !== ''
            ? h('div', { className: 'dsr-warning', style: { position: 'absolute', top: 10, left: 16, right: 16, zIndex: 9 } }, h(Icon, { name: 'alert', size: 13 }), h('span', null, bootError))
            : null,
          doc === null
            ? h(Hero, {
              t,
              onOpen: () => { setOpenError(''); setBrowserOpen(true) },
              recent,
              onOpenRecent: path => void openPath(path),
              loadingPath: openingPath,
              boot: boot === null ? null : { ...boot, recentPath: readStore('current', '') },
              onRestore: () => {
                const current = readStore('current', '')
                if (typeof current === 'string' && current !== '') void openPath(current, { restore: true })
              },
            })
            : doc.canPreview
              ? h('div', { className: 'dsr-reader-col' },
                doc.warnings?.length > 0
                  ? h('div', { className: 'dsr-original-warnings' }, doc.warnings.map((warning, index) => h('div', { key: index, className: 'dsr-warning' }, h(Icon, { name: 'alert', size: 12 }), h('span', null, warning))))
                  : null,
                h(OriginalView, {
                  key: doc.id,
                  doc,
                  t,
                  pdfjsInfo: boot?.pdfjs,
                  onEngine: setEngine,
                  onSelect: onPdfSelection,
                  onPositionBlock: onPdfPosition,
                  onPageChange: onPdfPage,
                  jumpRequest,
                })
              )
              : h(OriginalUnavailable, {
                doc,
                t,
                onOpen: () => { setOpenError(''); setBrowserOpen(true) },
              }),
          chatVisible
            ? h(SidePanel, {
              doc, t, mode, setMode: setModePersisted, panelTab, setPanelTab,
              messages, busy, onSend: sendQuestion, onStop: stopQuestion,
              quote: pendingQuote, onClearQuote: () => setPendingQuote(null),
              onClearChat: clearChat,
              onAhead: scrollToBlock,
              translations, targetLanguage, setTargetLanguage: setTargetLanguagePersisted,
              onClearTranslations: clearTranslations, onTranslateAgain: retranslate,
              onToast: showToast,
              onClose: () => setChatOpenPersisted(false),
              modelAvailable: boot?.modelAvailable !== false,
              positionLabel: positionLabel || t('currentPosition'),
            })
            : null,
          chatVisible ? h('div', { className: 'dsr-scrim', onClick: () => setChatOpenPersisted(false) }) : null,
          openingPath !== null
            ? h('div', { className: 'dsr-overlay-loading' },
              h(Spinner, null),
              h('strong', null, t('loadingDoc')),
              h('span', null, openingPath))
            : null
        ),
        tocOpen && doc !== null
          ? h('div', { className: 'dsr-toc-layer', onClick: () => setTocOpen(false) },
            h('div', {
              ref: tocRef,
              className: 'dsr-toc',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': t('toc'),
              onClick: event => event.stopPropagation(),
            },
              h('div', { className: 'dsr-toc-head' },
                h('span', { className: 'dsr-toc-heading' },
                  h('span', null, t('toc')),
                  tocPlan.chapters > 0
                    ? h('span', { className: 'dsr-toc-sub' }, tr(t, 'tocChapterCount', { n: tocPlan.chapters }))
                    : null
                ),
                h('button', {
                  type: 'button',
                  className: 'dsr-toc-brief',
                  disabled: busy,
                  title: t('tocOverview'),
                  onClick: () => {
                    setTocOpen(false)
                    void sendQuestion(t('overviewQuestion'), null, { overview: true })
                  },
                }, t('tocOverview')),
                h('button', { type: 'button', className: 'dsr-icon-btn', onClick: () => setTocOpen(false), title: t('close'), 'aria-label': t('close') }, h(Icon, { name: 'close', size: 13 }))
              ),
              h('div', { className: 'dsr-toc-list' },
                tocPlan.nodes.length === 0
                  ? h('div', { className: 'dsr-toc-empty' }, t('noToc'))
                  : tocPlan.nodes.map(node => {
                    const item = node.item
                    const pageLabel = doc.pages[item.page]?.label ?? ''
                    if (node.kind === 'chapter') {
                      return h('div', {
                        key: `c-${node.index}-${item.blockId}-${item.title}`,
                        className: cls('dsr-toc-row', node.open && 'is-open'),
                      },
                        node.children > 0
                          ? h('button', {
                            type: 'button',
                            className: 'dsr-toc-caret',
                            'aria-expanded': node.open,
                            'aria-label': node.open ? t('tocCollapse') : t('tocExpand'),
                            title: node.open ? t('tocCollapse') : t('tocExpand'),
                            onClick: () => toggleTocChapter(node.index),
                          }, h(Icon, { name: 'chevron', size: 11 }))
                          : h('span', { className: 'dsr-toc-caret is-empty', 'aria-hidden': true }),
                        h('button', {
                          type: 'button',
                          className: 'dsr-toc-item dsr-toc-chapter',
                          title: item.title,
                          onClick: () => scrollToBlock(item.blockId),
                        },
                          h('span', { className: 'dsr-toc-label' }, item.title),
                          h('span', { className: 'dsr-toc-page' }, pageLabel)
                        )
                      )
                    }
                    return h('button', {
                      type: 'button',
                      key: `i-${node.index}-${item.blockId}-${item.title}`,
                      className: 'dsr-toc-item',
                      'data-level': node.level,
                      style: { paddingLeft: `${8 + (node.level - 1) * 12}px` },
                      title: item.title,
                      onClick: () => scrollToBlock(item.blockId),
                    },
                      h('span', { className: 'dsr-toc-label' }, item.title),
                      h('span', { className: 'dsr-toc-page' }, pageLabel)
                    )
                  })
              )
            )
          )
          : null,
        searchOpen && doc !== null
          ? h(SearchDialog, { doc, t, onJump: scrollToBlock, onClose: () => setSearchOpen(false) })
          : null,
        h(Diagnostics, {
          open: diagnosticsOpen,
          onClose: () => setDiagnosticsOpen(false),
          t,
          boot,
          doc,
          engine,
          problems,
          onToast: showToast,
        }),
        selection !== null
          ? h(SelectionBar, {
            selection,
            t,
            targetLanguage: targetLanguage || boot?.defaults?.defaultTargetLanguage || 'zh-CN',
            setTargetLanguage: setTargetLanguagePersisted,
            onTranslate: target => void translateSelection(target),
            onAsk: askFromSelection,
            onExplain: explainSelection,
          })
          : null,
        browserOpen
          ? h(FileBrowser, {
            t,
            defaultDir: boot?.defaultDir ?? '',
            homeDir: boot?.homeDir ?? '',
            workspaces: boot?.workspaces ?? [],
            recent,
            onClose: () => { setBrowserOpen(false); setOpenError('') },
            onOpenPath: path => void openPath(path),
            openingPath,
            openError,
          })
          : null,
        toast !== '' ? h('div', { className: 'dsr-toast', role: 'status', 'aria-live': 'polite' }, toast) : null,
        selection?.truncated ? h('div', { className: 'dsr-toast', role: 'status', 'aria-live': 'polite' }, t('selectionTooLong')) : null
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // The stylesheet lives for the plugin lifetime, not for one selected
        // main panel. This avoids a large style node being inserted/removed
        // while the host switches between main panels.
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.studyReader = 'styles'
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'study-reader: styles')

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => panelLabel(ctx),
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          inject: () => ({}),
        }, props => h(StudyBoundary, { ctx }, h(StudyShell, { ...props, ctx }))))
      },
    }
  },
})


