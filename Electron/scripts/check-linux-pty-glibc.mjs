#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

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

function dumpSymbols(file) {
  const readelf = spawnSync('readelf', ['-V', file], { encoding: 'utf8' })
  if (readelf.status === 0) return `${readelf.stdout}\n${readelf.stderr}`
  const objdump = spawnSync('objdump', ['-T', file], { encoding: 'utf8' })
  if (objdump.status === 0) return `${objdump.stdout}\n${objdump.stderr}`
  const err = readelf.stderr || objdump.stderr || readelf.error?.message || objdump.error?.message
  throw new Error(`failed to inspect ${file}: ${err || 'readelf/objdump unavailable'}`)
}

function parseSearchArg(argv) {
  const index = argv.indexOf('--search')
  if (index < 0) return undefined
  const next = argv[index + 1]
  if (!next || next.startsWith('--')) throw new Error('--search requires a directory')
  return next
}

function main(argv = process.argv.slice(2)) {
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
    const text = dumpSymbols(file)
    const versions = parseGlibcVersions(text)
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
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
