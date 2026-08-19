#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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

function listDeb(path) {
  return execFileSync('dpkg-deb', ['-c', path], { encoding: 'utf8' })
}

const debs = artifacts('.deb')
if (debs.length === 0) fail('linux deb artifact missing')
const deb = debs.find(path => /amd64|x64|x86_64/.test(path)) ?? debs[0]
if (!/amd64|x64|x86_64/.test(deb)) fail(`deb is not x64: ${deb}`)
console.log(`deb OK: ${deb} (${assertSized(deb)} bytes)`)
const listing = listDeb(deb)
for (const name of requiredRuntimeFiles) {
  if (!listing.includes(name)) fail(`deb missing vault runtime file: ${name}`)
}
for (const name of forbiddenPlaintext) {
  if (listing.includes(name)) fail(`deb contains sibling plaintext key: ${name}`)
}
if (!listing.includes('pipiui-runtime')) fail('deb missing pipiui-runtime tree')

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
