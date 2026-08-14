import { describe, expect, it } from 'vitest'
import { chatImagesFromAttachments } from './attachments'

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
