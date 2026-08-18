import { describe, expect, it, vi } from 'vitest'
import { documentsOpenedInjection } from '@pipi/host-api'
import { consumeFileDropEvent, documentsDroppedAnnouncement, filterSupportedDocumentPaths, ignoreComposerFileDrag, supportedDocumentPathsFromFiles } from './document-drop'

describe('document drop helpers', () => {
  it('keeps supported extensions and drops folders / unknown types', () => {
    expect(filterSupportedDocumentPaths([
      '/work/a.md',
      '/work/folder',
      '/work/notes.txt',
      '/work/skip.js',
      '/work/deck.pptx',
      '/work/a.md',
      '  ',
    ])).toEqual(['/work/a.md', '/work/notes.txt', '/work/deck.pptx'])
  })

  it('builds one Chinese announcement for every dropped path', () => {
    expect(documentsDroppedAnnouncement(['/abs/one.md', '/abs/two.txt'])).toBe(
      '[文档面板] 用户拖拽打开了文档：/abs/one.md、/abs/two.txt。文件在磁盘上，可读取与编辑；面板会自动刷新。'
    )
  })

  it('resolves File paths through the preload bridge and ignores failures', () => {
    const files = [{ name: 'a.md' }, { name: 'b.bin' }, { name: 'c.txt' }] as unknown as File[]
    const paths = supportedDocumentPathsFromFiles(files, file => {
      if (file.name === 'b.bin') throw new Error('no path')
      return `/tmp/${file.name}`
    })
    expect(paths).toEqual(['/tmp/a.md', '/tmp/c.txt'])
  })

  it('consumes a panel file drop and marks composer file drags as ignored', () => {
    const panel = { preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { dropEffect: 'none' } }
    consumeFileDropEvent(panel)
    expect(panel.preventDefault).toHaveBeenCalled()
    expect(panel.stopPropagation).toHaveBeenCalled()
    expect(panel.dataTransfer.dropEffect).toBe('copy')

    const composer = { preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { dropEffect: 'copy' } }
    ignoreComposerFileDrag(composer)
    expect(composer.preventDefault).toHaveBeenCalled()
    expect(composer.stopPropagation).toHaveBeenCalled()
    expect(composer.dataTransfer.dropEffect).toBe('none')
  })

  it('includes readable text or a binary read hint in the opened-document injection', () => {
    expect(documentsOpenedInjection([
      { path: '/abs/notes.md', kind: 'markdown', excerpt: '# 幼儿姓名\n测试' },
      { path: '/abs/form.doc', kind: 'word', binary: true, size: 4096 },
    ])).toBe([
      '[文档面板] 用户打开了文档：/abs/notes.md\n--- 文档内容 ---\n# 幼儿姓名\n测试',
      '[文档面板] 用户打开了文档：/abs/form.doc。文件已在右侧面板打开（word，约 4KB）；请用 read 工具读取该路径以查看正文。',
    ].join('\n\n'))
  })
})
