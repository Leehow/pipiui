/**
 * Prepare website download files in a local release directory. Publish immutable
 * payloads first and replace the channel file last. See docs/agents/packaging.md.
 */
import { createHash, createPublicKey, verify, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { OFFICIAL_EXTENSION_PUBLIC_KEY } from '../packages/pi-backend/src/official-extension-key.ts'

const baseUrl = 'https://pipi.aichattrpg.com/downloads'
async function digest(path, algorithm = 'sha512') {
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('base64')
}

async function atomicJson(path, value) {
  const tmp = path + '.' + randomUUID()
  try {
    await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
    await rename(tmp, path)
  } finally { await rm(tmp, { force: true }) }
}

async function publishPayload(source, dest) {
  if (resolve(source) === resolve(dest)) return
  const tmp = dest + '.' + randomUUID()
  try {
    await copyFile(source, tmp)
    try { await link(tmp, dest) } catch (e) {
      if (e.code !== 'EEXIST' || await digest(dest) !== await digest(tmp)) throw new Error('发布文件已存在且无法复用：' + dest, { cause: e })
    }
  } finally { await rm(tmp, { force: true }) }
}

const [kind, output, input, version, edition, arch] = process.argv.slice(2)
if (!output || !input || !['desktop', 'extension'].includes(kind)) {
  throw new Error('Usage: prepare-official-update.mjs desktop OUT INSTALLER VERSION coding|base x64|arm64  |  extension OUT BUNDLED_EXTENSION_DIR')
}
await mkdir(output, { recursive: true })
if (kind === 'desktop') {
  const suffix = extname(input).slice(1).toLowerCase()
  const osSuffix = { exe: '', zip: '-mac', deb: '-linux', appimage: '-linux' }[suffix]
  if (!semver.valid(version) || !['coding', 'base'].includes(edition) || !['arm64', 'x64'].includes(arch) || osSuffix === undefined) throw new Error('无效的软件版本、架构、发行版或安装包格式')
  const channel = `pipiui-${edition}-${arch}-${suffix}`
  const filename = `${channel}-${version}.${suffix === 'appimage' ? 'AppImage' : suffix}`
  const channelPath = join(output, channel + osSuffix + (osSuffix === '-linux' && arch !== 'x64' ? '-' + arch : '') + '.yml')
  let prior
  try { prior = JSON.parse(await readFile(channelPath, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (prior && semver.gt(prior.version, version)) throw new Error('拒绝回退官网更新频道')
  const path = join(output, filename)
  await publishPayload(input, path)
  const sha512 = await digest(path)
  await atomicJson(channelPath, { version, files: [{ url: filename, sha512, size: (await stat(path)).size }], path: filename, sha512, releaseDate: new Date().toISOString() })
  console.log(filename, basename(channelPath))
} else {
  const manifest = JSON.parse(await readFile(join(input, 'pipiui-extension.json'), 'utf8'))
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id) || !semver.valid(manifest.version)) throw new Error('无效的插件 ID 或版本')
  if (!manifest.hostApi) throw new Error('独立更新的插件必须声明 hostApi 兼容版本')
  const staging = await mkdtemp(join(tmpdir(), 'pipiui-official-package-'))
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL('./pack-extension-release.mjs', import.meta.url)),
      input, '--version', manifest.version, '--base-url', baseUrl, '--out', staging,
      '--signing-key', process.env.PIPIUI_EXTENSION_SIGNING_KEY_FILE || join(homedir(), '.config/pipiui-release/extension-ed25519.pem')], { stdio: 'inherit' })
    const artifact = `${manifest.id}-${manifest.version}.tar.gz`
    const index = `${manifest.id}-${manifest.version}-assets.json`
    const generated = JSON.parse(await readFile(join(staging, manifest.id + '-assets.json'), 'utf8'))
    const spki = process.env.PIPIUI_EXTENSION_UPDATE_PUBLIC_KEY || OFFICIAL_EXTENSION_PUBLIC_KEY
    const publicKey = createPublicKey({ format: 'der', type: 'spki', key: Buffer.from(spki, 'base64') })
    const signature = Buffer.from(Object.values(generated.assets)[0].signature, 'base64')
    if (!verify(null, await readFile(join(staging, artifact)), publicKey, signature)) throw new Error('签名与客户端发布公钥不匹配')
    await publishPayload(join(staging, artifact), join(output, artifact))
    await publishPayload(join(staging, manifest.id + '-assets.json'), join(output, index))
    const versions = {}
    for (const name of await readdir(output)) {
      if (!name.endsWith('-assets.json')) continue
      const row = JSON.parse(await readFile(join(output, name), 'utf8'))
      const ending = '-' + row.version + '-assets.json'
      if (!semver.valid(row.version) || !name.endsWith(ending)) continue
      const id = name.slice(0, -ending.length)
      if (!Object.hasOwn(versions, id) || semver.gt(row.version, versions[id])) versions[id] = row.version
    }
    await atomicJson(join(output, 'pipiui-extensions.json'), { schemaVersion: 1, versions })
    console.log(artifact, index, 'pipiui-extensions.json')
  } finally { await rm(staging, { recursive: true, force: true }) }
}
