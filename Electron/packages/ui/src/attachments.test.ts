import { describe, expect, it } from 'vitest'
import { ATTACHMENT_DISPLAY_NOTE, chatImagesFromAttachments, stripAttachmentPathsForDisplay } from './attachments'

describe('chatImagesFromAttachments', () => {
  it('maps PromptAttachment bytes onto transcript images and skips empty payloads', () => {
    expect(chatImagesFromAttachments()).toBeUndefined()
    expect(chatImagesFromAttachments([])).toBeUndefined()
    expect(chatImagesFromAttachments([{ dataBase64: '', mimeType: 'image/png', name: 'empty.png' }])).toBeUndefined()
    expect(chatImagesFromAttachments([
      { dataBase64: 'abc', mimeType: 'image/png', name: 'shot.png' },
      { dataBase64: 'def', mimeType: '', name: 'fallback.jpg' },
    ])).toEqual([
      { data: 'abc', mimeType: 'image/png' },
      { data: 'def', mimeType: 'image/png' },
    ])
  })
})

describe('stripAttachmentPathsForDisplay', () => {
  it('keeps the user prose and drops a single-file footnote', () => {
    const text = `看图\n\nAttached image file: /Users/me/proj/.pi/attachments/a.png\n${ATTACHMENT_DISPLAY_NOTE}`
    expect(stripAttachmentPathsForDisplay(text)).toBe('看图')
  })

  it('drops a multi-file footnote', () => {
    const text = `两张图\n\nAttached image files:\n- /tmp/one.png\n- /tmp/two.jpg\n${ATTACHMENT_DISPLAY_NOTE}`
    expect(stripAttachmentPathsForDisplay(text)).toBe('两张图')
  })

  it('yields empty text for an image-only annotated prompt', () => {
    const text = `\nAttached image file: /tmp/a.png\n${ATTACHMENT_DISPLAY_NOTE}`
    expect(stripAttachmentPathsForDisplay(text)).toBe('')
  })

  it('keeps an OCR caption that follows the footnote', () => {
    const text = `看图\n\nAttached image file: /Users/me/proj/.pi/attachments/a.png\n${ATTACHMENT_DISPLAY_NOTE}\n\n[图片已自动转为文字，当前模型不支持直接查看图片]\n图片1：\n[图片中的文字]\nOCR 出来的内容`
    expect(stripAttachmentPathsForDisplay(text)).toBe('看图\n\n[图片已自动转为文字，当前模型不支持直接查看图片]\n图片1：\n[图片中的文字]\nOCR 出来的内容')
  })

  it('leaves ordinary text and mid-message “Attached” prose alone', () => {
    expect(stripAttachmentPathsForDisplay('普通文本')).toBe('普通文本')
    const mid = 'Please see Attached notes in the doc.\nMore text.'
    expect(stripAttachmentPathsForDisplay(mid)).toBe(mid)
  })
})
