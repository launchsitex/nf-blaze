import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll, describe, expect, it, vi } from 'vitest'

// storage משתמש ב-app.getPath('userData') — מפנים לתיקייה זמנית
const dirs = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { tmpdir } = require('os') as typeof import('os')
  const { join } = require('path') as typeof import('path')
  return { data: mkdtempSync(join(tmpdir(), 'nf-chats-data-')) }
})

vi.mock('electron', () => ({
  app: { getPath: () => dirs.data }
}))

import {
  saveProject,
  loadChat,
  saveChat,
  loadChatsIndex,
  createChat,
  switchChat,
  deleteChat
} from '../src/main/services/storage'

const projDir = mkdtempSync(join(tmpdir(), 'nf-chats-proj-'))

afterAll(() => {
  rmSync(dirs.data, { recursive: true, force: true })
  rmSync(projDir, { recursive: true, force: true })
})

describe('multiple chats per project', () => {
  const now = new Date().toISOString()

  it('migrates the legacy chat.json into the first chat', () => {
    saveProject({
      id: 'p1',
      name: 'בדיקה',
      description: '',
      folderPath: projDir,
      createdAt: now,
      updatedAt: now,
      provider: 'anthropic',
      model: 'claude-opus-4-8'
    })
    mkdirSync(join(projDir, '.nf-blaze'), { recursive: true })
    writeFileSync(
      join(projDir, '.nf-blaze', 'chat.json'),
      JSON.stringify({
        projectId: 'p1',
        updatedAt: now,
        messages: [{ id: 'm1', role: 'user', content: 'בנה לי אתר', createdAt: now }]
      }),
      'utf-8'
    )

    const idx = loadChatsIndex('p1')
    expect(idx.chats.length).toBe(1)
    expect(idx.activeChatId).toBe(idx.chats[0]!.id)

    const session = loadChat('p1')
    expect(session.messages.length).toBe(1)
    expect(session.messages[0]!.content).toBe('בנה לי אתר')
    expect(session.chatId).toBe(idx.activeChatId)
  })

  it('creates a new chat, switches active, and keeps histories separate', () => {
    const firstId = loadChatsIndex('p1').activeChatId
    const meta = createChat('p1', undefined, [
      { id: 's1', role: 'assistant', content: 'סיכום קודם', createdAt: now }
    ])
    // הצ'אט החדש הפך לפעיל ומכיל את ה-seed
    const idx = loadChatsIndex('p1')
    expect(idx.activeChatId).toBe(meta.id)
    expect(loadChat('p1').messages.map((m) => m.content)).toEqual(['סיכום קודם'])

    // כתיבה לצ'אט הפעיל מקבלת כותרת אוטומטית מההודעה הראשונה של המשתמש
    const session = loadChat('p1')
    session.messages.push({ id: 'm2', role: 'user', content: 'תוסיף עמוד אודות', createdAt: now })
    saveChat(session)
    const title = loadChatsIndex('p1').chats.find((c) => c.id === meta.id)!.title
    expect(title).toContain('תוסיף עמוד אודות')

    // חזרה לצ'אט הראשון — ההיסטוריה המקורית נשמרה
    switchChat('p1', firstId)
    expect(loadChat('p1').messages.map((m) => m.content)).toEqual(['בנה לי אתר'])
  })

  it('deletes a chat but never the last one', () => {
    const idx = loadChatsIndex('p1')
    expect(idx.chats.length).toBe(2)
    const toDelete = idx.chats.find((c) => c.id !== idx.activeChatId)!
    const after = deleteChat('p1', toDelete.id)
    expect(after.chats.length).toBe(1)
    // מחיקת האחרון — נחסמת
    const still = deleteChat('p1', after.chats[0]!.id)
    expect(still.chats.length).toBe(1)
  })
})
