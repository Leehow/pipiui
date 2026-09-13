#!/usr/bin/env node
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describeFailure, scanCommandLines } from './scan-command-lines.mjs'

export const MAX_GLIBC = { major: 2, minor: 35 }

const GLIBC_RE = /GLIBC_(\d+\.\d+(?:\.\d+)?)/g

export function parseGlibcVersions(text) {
  const found = new Set()
  const source = String(text ?? '')
  for (const match of source.matchAll(GLIBC_RE)) {
    found.add(match[1])
  }
  return [...found].sort()
}

function parseVersion(version) {
  const parts = String(version).split('.').map((part) => Number.parseInt(part, 10))
  return {
    major: Number.isFinite(parts[0]) ? parts[0] : 0,
    minor: Number.isFinite(parts[1]) ? parts[1] : 0,
    patch: Number.isFinite(parts[2]) ? parts[2] : 0
  }
}

export function versionNewerThanMax(version) {
  const parsed = parseVersion(version)
  if (parsed.major !== MAX_GLIBC.major) return parsed.major > MAX_GLIBC.major
  return parsed.minor > MAX_GLIBC.minor
}

export function findTooNew(versions) {
  return [...versions].filter((version) => versionNewerThanMax(version))
}

function collectPtyNodes(root, acc = []) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries) {
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      collectPtyNodes(full, acc)
      continue
    }
    if (entry.isFile() && entry.name === 'pty.node') acc.push(full)
  }
  return acc
}

/**
 * node-pty ships prebuilt `pty.node` for darwin and win32 alongside the Linux
 * build, and electron-builder copies the whole package into the Linux app. A
 * Mach-O or PE binary has no glibc requirement to check, so it is skipped —
 * readelf failing on one is not a packaging defect. A file that IS an ELF but
 * cannot be read still fails loudly.
 */
export function isElf(file) {
  let fd
  try {
    fd = openSync(file, 'r')
    const magic = Buffer.alloc(4)
    const read = readSync(fd, magic, 0, 4, 0)
    return read === 4 && magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Stream the symbol dump instead of buffering it. A symbol table has no size
 * bound, and spawnSync's 1 MB maxBuffer reports an overflow the same way it
 * reports a missing tool — an ENOBUFS on readelf would silently fall through to
 * objdump and then be blamed on "readelf/objdump unavailable".
 */
async function dumpGlibcVersions(file) {
  const versions = new Set()
  const collect = (line) => {
    for (const version of parseGlibcVersions(line)) versions.add(version)
  }
  const readelf = await scanCommandLines('readelf', ['-V', file], collect)
  if (readelf.code === 0) return [...versions].sort()
  versions.clear()
  const objdump = await scanCommandLines('objdump', ['-T', file], collect)
  if (objdump.code === 0) return [...versions].sort()
  throw new Error(
    `failed to inspect ${file}: readelf: ${describeFailure('readelf', readelf)}; ` +
    `objdump: ${describeFailure('objdump', objdump)}`
  )
}

function parseSearchArg(argv) {
  const index = argv.indexOf('--search')
  if (index < 0) return undefined
  const next = argv[index + 1]
  if (!next || next.startsWith('--')) throw new Error('--search requires a directory')
  return next
}

async function main(argv = process.argv.slice(2)) {
  const search = parseSearchArg(argv)
  if (!search) {
    console.error('usage: node scripts/check-linux-pty-glibc.mjs --search <dir>')
    process.exitCode = 1
    return
  }
  const root = resolve(search)
  try {
    if (!statSync(root).isDirectory()) throw new Error('not a directory')
  } catch (error) {
    console.error(`search directory not found: ${root}`)
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
    return
  }
  const files = collectPtyNodes(root)
  if (files.length === 0) {
    console.error(`no pty.node found under ${root}`)
    process.exitCode = 1
    return
  }
  let failed = false
  let inspected = 0
  for (const file of files) {
    if (!isElf(file)) {
      console.log(`${file} skipped (not an ELF binary)`)
      continue
    }
    inspected += 1
    const versions = await dumpGlibcVersions(file)
    const tooNew = findTooNew(versions)
    if (tooNew.length > 0) {
      failed = true
      console.error(`${file} requires glibc newer than ${MAX_GLIBC.major}.${MAX_GLIBC.minor}: ${tooNew.join(', ')}`)
    } else {
      console.log(`${file} ok (${versions.join(', ') || 'no GLIBC_* symbols'})`)
    }
  }
  if (inspected === 0) {
    console.error(`no ELF pty.node found under ${root}; a Linux package must carry one`)
    failed = true
  }
  if (failed) process.exitCode = 1
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)
if (isDirectRun) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
