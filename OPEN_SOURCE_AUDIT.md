# Pre-open-source Git history audit

Audit date: 2026-11-12 (Asia/Shanghai). Read-only audit; no history rewrite, Git configuration change, credential validation or publication was performed.

**Result:** No matches were found by the configured sensitive-data rules in the audited reachable history. No personal author/committer/tagger identity was identified; all identities were classified as existing local placeholders. This is a bounded heuristic result, not a guarantee that the repository contains no sensitive information.

## Snapshot and scope

| Item | Audited value |
|---|---|
| HEAD | `0ee8278e2dcbe19b599848cc68450e92bbc1c715` |
| Reachable refs | 11: one branch and ten release tags |
| Reachable commits | 13 |
| Annotated tag objects | 3 |
| Unique historical blobs | 111 |
| File entries across commit trees | 510 |
| Decoded blob bytes scanned | 3,739,901 |
| Blobs containing NUL bytes | 0 |

All commits reachable through the current refs were enumerated using `git rev-list --all`. Each commit's raw metadata and message, every unique blob from its recursive tree, and all three annotated tags' raw metadata/messages were scanned. Paths were checked for credential file names and user-document extensions. Lightweight release tags point to commits already included in the commit scan.

Annotated tag objects scanned:

- `v1.16.0`: `c47484c297732e872f2cc30d20d770012ed03e77`
- `v1.16.1`: `df36cbf323a60a1fef6ebf2d544fdc93d0fa2dca`
- `v1.16.2`: `db031c4c6274659f164bbb161cd3d628fcb1dc5d`

## Findings and identities

The following rules returned **zero findings**: private-key PEM headers, recognizable provider tokens, quoted credential assignments, literal bearer credentials, URL userinfo, personal home-directory absolute paths (including escaped Windows paths), email addresses, and sensitive credential/user-document filenames.

The author and committer checks each found two known local placeholder identities: one used by 12 commits and one by one commit. The three annotated tags use one known local placeholder tagger identity. Raw identity strings are intentionally omitted from this report and the script output. No unknown identity requires review at this snapshot.

No candidate credential was found that needed classification as a real secret versus a dummy/test credential. Test fixtures are still scanned, not excluded. Generic non-home test paths and application variables do not by themselves establish sensitive data.

## Reproduce

From the repository root, run the [history scanner](<scripts/audit-history.mjs>):

```sh
node scripts/audit-history.mjs
```

The script reads Git objects using Git subprocesses and prints sanitized JSON: counts, object hashes, historical paths, matching rule names and line numbers. It never prints matching values, file bodies or raw identities. Exit code 0 means the scan completed, not that every result is safe to publish. Re-run after additional commits or tag/ref changes; this report is tied to the HEAD and ref snapshot above.

## Limits

- Scope excludes unreachable objects, reflogs, untracked/ignored working files, local Git configuration, external document/annotation/chat storage, and remote refs that have not been fetched. Publishing only the audited refs does not publish local reflogs, but inspect any additional refs before pushing them.
- Rules are regex heuristics, not an exhaustive secret scanner, entropy detector or manual review of every source line. Unusual token formats, unquoted assignments, obfuscation, unsupported personal path layouts and sensitive prose can be missed.
- Binary contents are scanned as decoded text only; archives, images and binary formats are not parsed. This snapshot contained no NUL-bearing blobs.
- No credentials were sent to a provider for validation. No claim is made about third-party dependency archives or future changes.
- No history or identity rewrite is recommended on the basis of the current zero-match result. A separate publication decision must still consider licenses, installation instructions and privacy documentation.
