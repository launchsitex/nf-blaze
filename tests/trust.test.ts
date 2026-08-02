import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LARGE_CHANGE_FILES,
  LEVEL_THRESHOLDS,
  emptyTrust,
  levelForStreak,
  readTrust,
  recordDecision,
  shouldAutoApprove,
  trustFilePath
} from '../src/main/services/trust'

let root: string

beforeEach(() => {
  root = join(tmpdir(), `nf-trust-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('levelForStreak', () => {
  it('starts at zero — ask every time', () => {
    expect(levelForStreak(0)).toBe(0)
    expect(levelForStreak(LEVEL_THRESHOLDS[1] - 1)).toBe(0)
  })

  it('climbs with consecutive approvals', () => {
    expect(levelForStreak(LEVEL_THRESHOLDS[1])).toBe(1)
    expect(levelForStreak(LEVEL_THRESHOLDS[2])).toBe(2)
  })
})

describe('recordDecision', () => {
  it('builds a streak on approvals', () => {
    recordDecision(root, true)
    recordDecision(root, true)
    const state = recordDecision(root, true)
    expect(state.streak).toBe(3)
    expect(state.approved).toBe(3)
    expect(state.level).toBe(1)
  })

  it('resets the streak the moment the user rejects', () => {
    for (let i = 0; i < 12; i++) recordDecision(root, true)
    expect(readTrust(root).level).toBe(2)
    const after = recordDecision(root, false)
    expect(after.streak).toBe(0)
    expect(after.level).toBe(0)
    expect(after.rejected).toBe(1)
  })

  it('keeps lifetime counters across a reset', () => {
    recordDecision(root, true)
    recordDecision(root, false)
    recordDecision(root, true)
    const state = readTrust(root)
    expect(state.approved).toBe(2)
    expect(state.rejected).toBe(1)
  })

  it('persists to a transparent file inside the project', () => {
    recordDecision(root, true)
    expect(trustFilePath(root)).toContain('.nf-blaze')
    expect(readTrust(root).approved).toBe(1)
  })

  it('recovers from a corrupt file instead of throwing', () => {
    mkdirSync(join(root, '.nf-blaze'), { recursive: true })
    writeFileSync(trustFilePath(root), 'not json', 'utf8')
    expect(readTrust(root)).toEqual(expect.objectContaining({ streak: 0, level: 0 }))
  })

  it('treats a missing file as no trust yet', () => {
    expect(readTrust(root).level).toBe(emptyTrust().level)
  })
})

describe('shouldAutoApprove — reversibility-weighted', () => {
  it('never auto-approves at level 0', () => {
    expect(shouldAutoApprove({ level: 0, filesChanged: 1, hasRegressions: false })).toBe(false)
  })

  it('auto-approves a small clean change at level 1', () => {
    expect(shouldAutoApprove({ level: 1, filesChanged: 2, hasRegressions: false })).toBe(true)
  })

  it('never auto-approves when something that worked broke', () => {
    expect(shouldAutoApprove({ level: 2, filesChanged: 1, hasRegressions: true })).toBe(false)
  })

  it('never auto-approves a large change at level 1', () => {
    expect(
      shouldAutoApprove({ level: 1, filesChanged: LARGE_CHANGE_FILES, hasRegressions: false })
    ).toBe(false)
  })

  it('allows a bigger change only at the highest level', () => {
    expect(
      shouldAutoApprove({ level: 2, filesChanged: LARGE_CHANGE_FILES + 1, hasRegressions: false })
    ).toBe(true)
  })

  it('still asks for a very large change even at the highest level', () => {
    expect(
      shouldAutoApprove({
        level: 2,
        filesChanged: LARGE_CHANGE_FILES * 2,
        hasRegressions: false
      })
    ).toBe(false)
  })

  it('does nothing when no files changed', () => {
    expect(shouldAutoApprove({ level: 2, filesChanged: 0, hasRegressions: false })).toBe(false)
  })
})
