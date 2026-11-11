// Read-only test against the running reader. Does not alter source or config.
const base = 'http://127.0.0.1:62754/api/dsh-study'
const id = '2d6099fd2d55d97ba6308e0e'
async function page(n, w) {
  const start = performance.now()
  const response = await fetch(`${base}/page?id=${id}&n=${n}&w=${w}`)
  const bytes = await response.arrayBuffer()
  const ms = Math.round(performance.now() - start)
  const result = { n, w, status: response.status, ms, width: response.headers.get('x-page-width'), height: response.headers.get('x-page-height'), bytes: bytes.byteLength }
  if (!response.ok) result.error = new TextDecoder().decode(bytes)
  return result
}
for (const pages of [[1,2,3,4,5], [92,93,94,95,96], [150,151,152,153,154]]) {
  const start = performance.now()
  const heartbeat = fetch(`${base}/bootstrap`).then(async r => ({ status: r.status, ms: Math.round(performance.now() - start), version: (await r.json()).version }))
  const results = await Promise.all(pages.map(n => page(n, 2384)))
  console.log(JSON.stringify({ results, heartbeat: await heartbeat }))
}
