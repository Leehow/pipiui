#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeFailure, scanCommandLines } from './scan-command-lines.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const buildDir = resolve(repoRoot, 'build')
const requiredRuntimeFiles = [
  'pipiui-secret-vault.ts',
  'secret-vault-core.ts',
]
const forbiddenPlaintext = [
  'secret-vault.key',
]

function fail(message) {
  console.error(message)
  process.exit(1)
}

function artifacts(suffix) {
  if (!existsSync(buildDir)) fail(`build directory missing: ${buildDir}`)
  return readdirSync(buildDir)
    .filter(name => name.endsWith(suffix))
    .map(name => join(buildDir, name))
}

function assertSized(path, minBytes = 1024) {
  const size = statSync(path).size
  if (size < minBytes) fail(`${path} is a stub (${size} bytes)`)
  return size
}

/**
 * Stream `dpkg-deb -c` and record which needles the listing mentions. A real
 * package lists ~31,500 entries (~3 MB), well past execFileSync's 1 MB
 * maxBuffer — buffering it killed this check with ENOBUFS before any assertion
 * ran. Every needle is a path fragment inside one entry line, so a line-by-line
 * scan sees exactly what a whole-listing `includes` would.
 */
async function listedNames(path, needles) {
  const found = new Set()
  const result = await scanCommandLines('dpkg-deb', ['-c', path], line => {
    for (const needle of needles) {
      if (!found.has(needle) && line.includes(needle)) found.add(needle)
    }
  })
  if (result.code !== 0) fail(`dpkg-deb -c failed on ${path}: ${describeFailure('dpkg-deb', result)}`)
  return found
}

const debs = artifacts('.deb')
if (debs.length === 0) fail('linux deb artifact missing')
const deb = debs.find(path => /amd64|x64|x86_64/.test(path)) ?? debs[0]
if (!/amd64|x64|x86_64/.test(deb)) fail(`deb is not x64: ${deb}`)
console.log(`deb OK: ${deb} (${assertSized(deb)} bytes)`)
const listed = await listedNames(deb, [...requiredRuntimeFiles, ...forbiddenPlaintext, 'pipiui-runtime'])
for (const name of requiredRuntimeFiles) {
  if (!listed.has(name)) fail(`deb missing vault runtime file: ${name}`)
}
for (const name of forbiddenPlaintext) {
  if (listed.has(name)) fail(`deb contains sibling plaintext key: ${name}`)
}
if (!listed.has('pipiui-runtime')) fail('deb missing pipiui-runtime tree')

const appImages = artifacts('.AppImage')
if (appImages.length === 0) fail('linux AppImage artifact missing')
const appImage = appImages[0]
console.log(`AppImage OK: ${appImage} (${assertSized(appImage)} bytes)`)
const fileInfo = execFileSync('file', ['-b', appImage], { encoding: 'utf8' })
if (!/x86-64|x86_64|Intel 80386|ELF 64-bit/.test(fileInfo) && !/AppImage/.test(fileInfo)) {
  fail(`AppImage architecture check failed: ${fileInfo.trim()}`)
}
if (/ARM|aarch64/.test(fileInfo) && !/x86-64|x86_64/.test(fileInfo)) {
  fail(`AppImage is not x64: ${fileInfo.trim()}`)
}
console.log('linux secret vault package smoke passed')
