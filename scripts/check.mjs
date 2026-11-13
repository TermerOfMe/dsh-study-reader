/**
 * Repository checks that do not need a browser:
 *   - the manifest and lockfile agree on one semver version;
 *   - runtime code reads that version instead of hardcoding it;
 *   - the files allow-list still ships every runtime artifact.
 *
 * Run with `npm run check` (also used by `npm run version:check`).
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = name => readFile(join(root, name), 'utf8')
const failures = []
const expect = (condition, message) => {
  if (!condition) failures.push(message)
}

const manifest = JSON.parse(await read('package.json'))
const lock = JSON.parse(await read('package-lock.json'))

expect(/^\d+\.\d+\.\d+$/.test(manifest.version ?? ''), 'package.json version must be semver')
expect(manifest.name === 'study-reader', 'public package name must be study-reader')
expect(manifest.private !== true, 'public package must not be private')
expect(lock.name === manifest.name && lock.packages?.['']?.name === manifest.name, 'lockfile package names differ')
const patch = await read('cordis.patch.yml')
expect(patch.includes(`name: '${manifest.name}'`), 'bundle patch must resolve the published package')
expect((await read('client.js')).includes(`id: '${manifest.name}'`), 'Client module id must match the published package')
expect(manifest.publishConfig?.registry === 'https://registry.npmjs.org/', 'publish registry must be npm official registry')
expect(lock.version === manifest.version, `package-lock version ${lock.version} != package.json ${manifest.version}`)
expect(lock.packages?.['']?.version === manifest.version, 'package-lock root entry version differs')

const host = await read('lib/app.js')
expect(host.includes('PLUGIN_VERSION'), 'lib/app.js must derive the version from package.json')
expect(!/version:\s*['"]\d+\.\d+\.\d+['"]/.test(host), 'lib/app.js must not hardcode a version literal')

const client = await read('client.js')
expect(!/加载\s*\d+\.\d+\.\d+/.test(client), 'client.js must interpolate the bootstrap version')
expect(!/version\s+\d+\.\d+\.\d+\s+is loaded/.test(client), 'client.js must interpolate the bootstrap version')
expect(client.includes('pluginVersion'), 'client.js must keep the bootstrap version for diagnostics')

const shipped = Array.isArray(manifest.files) ? manifest.files : []
for (const required of ['index.js', 'client.js', 'lib/**/*', 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'README.md', 'CHANGELOG.md', 'LICENSE']) {
  expect(shipped.includes(required), `package.json "files" is missing ${required}`)
}

if (failures.length > 0) {
  console.error('check failed:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log(`ok: version ${manifest.version}; manifest, lockfile and runtime references are consistent`)
