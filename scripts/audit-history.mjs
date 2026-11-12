import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Read-only Git audit. Never prints matching values, full metadata or file bodies.
// Exit 0 means the scan completed, not that every finding is safe to publish.
const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..')
function git(...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed (${result.status ?? 'spawn error'})`)
  return result.stdout
}
const rules = [
  ['private-key-pem', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['provider-token', /\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{15,})\b/g],
  ['credential-assignment', /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization)\b["']?\s*[:=]\s*["'`][^"'`\r\n]{4,}["'`]/gi],
  ['bearer-literal', /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi],
  ['url-userinfo', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi],
  ['personal-absolute-path', /(?:[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\s"'`<>]+|\/(?:home|Users)\/[^\s"'`<>]+)/g],
  ['email-address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
]
const findings = []
function scan(value, object, kind, paths = []) {
  for (const [rule, regex] of rules) {
    regex.lastIndex = 0
    const matches = [...value.matchAll(regex)]
    if (!matches.length) continue
    const lines = [...new Set(matches.map(match => value.slice(0, match.index).split('\n').length))]
    findings.push({ object, kind, rule, paths, count: matches.length, lines })
  }
}
const head = git('rev-parse', 'HEAD').trim()
const refs = git('for-each-ref', '--format=%(refname)%00%(objectname)%00%(objecttype)').trim().split('\n').filter(Boolean).map(line => {
  const [name, object, type] = line.split('\0'); return { name, object, type }
})
const commits = git('rev-list', '--all').trim().split('\n').filter(Boolean)
const blobPaths = new Map(), identities = new Map()
let treeEntries = 0
for (const commit of commits) {
  const raw = git('cat-file', 'commit', commit)
  scan(raw, commit, 'commit-metadata-and-message')
  for (const role of ['author', 'committer']) {
    const line = raw.match(new RegExp(`^${role} (.*)$`, 'm'))?.[1] ?? ''
    const identity = line.replace(/ \d+ [+-]\d{4}$/, '')
    const known = identities.get(identity) ?? { authorCommits: 0, committerCommits: 0 }
    known[role === 'author' ? 'authorCommits' : 'committerCommits']++
    identities.set(identity, known)
  }
  for (const entry of git('ls-tree', '-r', '-z', commit).split('\0').filter(Boolean)) {
    treeEntries++
    const tab = entry.indexOf('\t'), metadata = entry.slice(0, tab), path = entry.slice(tab + 1)
    const [, type, hash] = metadata.split(' ')
    if (type !== 'blob') continue
    if (!blobPaths.has(hash)) blobPaths.set(hash, new Set())
    blobPaths.get(hash).add(path)
  }
}
const tagObjects = refs.filter(ref => ref.type === 'tag')
const tagIdentities = new Map()
for (const tag of tagObjects) {
  const raw = git('cat-file', 'tag', tag.object)
  scan(raw, tag.object, 'tag-metadata-and-message')
  const identity = (raw.match(/^tagger (.*)$/m)?.[1] ?? '').replace(/ \d+ [+-]\d{4}$/, '')
  tagIdentities.set(identity, (tagIdentities.get(identity) ?? 0) + 1)
}
let bytes = 0, binaryBlobs = 0
for (const [hash, pathsSet] of blobPaths) {
  const paths = [...pathsSet].sort()
  const body = git('cat-file', 'blob', hash)
  bytes += Buffer.byteLength(body)
  if (body.includes('\0')) binaryBlobs++
  // Scan decoded bytes even for binary blobs; this is not binary format parsing.
  scan(body, hash, 'historical-blob', paths)
  const sensitive = paths.filter(path => /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_(?:rsa|ed25519)|credentials?(?:\..*)?|secrets?(?:\..*)?)$|\.(?:pem|p12|pfx|key|pdf|docx?|pptx?|xlsx?|sqlite|db)$/i.test(path))
  if (sensitive.length) findings.push({ object: hash, kind: 'historical-blob', rule: 'sensitive-filename-or-user-document', paths: sensitive, count: sensitive.length, lines: [] })
}
const identitySummary = [...identities].map(([identity, counts], index) => ({
  id: index + 1, ...counts,
  classification: /^(?:local|Study Reader) <local@machine>$/.test(identity) ? 'known-local-placeholder' : 'review-identity',
  // Identity is deliberately omitted; inspect it locally if review is required.
}))
console.log(JSON.stringify({ head, scope: 'All commits reachable from refs returned by git --all; annotated tag objects; no reflogs/unreachable objects, worktree or external files.',
  refs, counts: { refs: refs.length, commits: commits.length, annotatedTags: tagObjects.length, uniqueBlobs: blobPaths.size, treeEntries, decodedBlobBytes: bytes, binaryBlobs },
  identities: identitySummary, tagIdentities: [...tagIdentities].map(([identity, tags], index) => ({ id: index + 1, tags, classification: /^(?:local|Study Reader) <local@machine>$/.test(identity) ? 'known-local-placeholder' : 'review-identity' })), findings,
  limits: ['Regex heuristics can miss secrets or flag examples.', 'No network credential validation, entropy detector, archive extraction, binary parsing or external secret scanner.', 'Matching values and raw identities are never printed.', 'A successful exit means completed scan, not a security guarantee.'] }, null, 2))
