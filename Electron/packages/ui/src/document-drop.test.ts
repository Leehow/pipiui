import { describe, expect, it, vi } from 'vitest'
import { documentsOpenedInjection } from '@pipi/host-api'
import { consumeFileDropEvent, DEFAULT_COMPOSER_DOCUMENT_PROMPT, documentsDroppedAnnouncement, fileDragHasFiles, filterSupportedDocumentPaths, ignoreComposerFileDrag, supportedDocumentPathsFromFiles } from './document-drop'

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
      '/work/form.docm',
      '/work/book.epub',
      '/work/table.csv',
      '/work/notes.odt',
    ])).toEqual(['/work/a.md', '/work/notes.txt', '/work/deck.pptx', '/work/form.docm', '/work/book.epub', '/work/table.csv', '/work/notes.odt'])
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

    const composer = { preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { dropEffect: 'copy', types: ['Files'] } }
    ignoreComposerFileDrag(composer)
    expect(composer.preventDefault).toHaveBeenCalled()
    expect(composer.stopPropagation).toHaveBeenCalled()
    expect(composer.dataTransfer.dropEffect).toBe('none')
    expect(fileDragHasFiles(composer)).toBe(true)
  })

  it('includes readable text or a local parse hint in the opened-document injection', () => {
    expect(documentsOpenedInjection([
      { path: '/abs/notes.md', kind: 'markdown', excerpt: '# 幼儿姓名\n测试' },
      { path: '/abs/form.doc', kind: 'word', binary: true, size: 4096 },
      { path: '/abs/scan.pdf', kind: 'pdf', binary: true, size: 2048 },
    ])).toBe([
      '[文档面板] 用户打开了文档：/abs/notes.md\n--- 文档内容 ---\n# 幼儿姓名\n测试',
      '[文档面板] 用户打开了文档：/abs/form.doc。文件已在右侧面板打开（word，约 4KB）；请用 pipiui_firecrawl_anydoc 工具本地解析该绝对路径（不要用 read）。转换在本地完成，不会上传。打开预览本身不会解析。',
      '[文档面板] 用户打开了文档：/abs/scan.pdf。文件已在右侧面板打开（pdf，约 2KB）；请用 pipiui_firecrawl_pdf 工具本地解析该绝对路径（不要用 read）。默认本地提取文字，不会上传；仅当页面需要 OCR 且已配置可选 OCR Key 时才会上传。打开预览本身不会解析。',
    ].join('\n\n'))
  })

  it('uses composer copy for input-box chips and never tells the model to use read', () => {
    expect(DEFAULT_COMPOSER_DOCUMENT_PROMPT).toBe('请分析这些文件的内容')
    const text = documentsOpenedInjection(
      [{ path: '/abs/form.docx', kind: 'word', binary: true, size: 2048 }],
      { source: 'composer' },
    )
    expect(text).toContain('[输入框] 用户附上了文档：/abs/form.docx')
    expect(text).toContain('pipiui_firecrawl_anydoc')
    expect(text).not.toContain('[文档面板]')
    expect(text).not.toContain('请用 read 工具')
  })
})
