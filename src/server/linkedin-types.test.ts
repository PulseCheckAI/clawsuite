import { describe, it, expect } from 'vitest'
import {
  AccountIdSchema,
  PublishPayloadSchema,
  type PublishPayload,
} from './linkedin-types'

describe('AccountIdSchema', () => {
  it('accepts thiago, mary, pulsecheck', () => {
    expect(AccountIdSchema.parse('thiago')).toBe('thiago')
    expect(AccountIdSchema.parse('mary')).toBe('mary')
    expect(AccountIdSchema.parse('pulsecheck')).toBe('pulsecheck')
  })

  it('rejects unknown accounts', () => {
    expect(() => AccountIdSchema.parse('other')).toThrow()
  })
})

describe('PublishPayloadSchema', () => {
  it('accepts a minimal text post (personal)', () => {
    const payload: PublishPayload = {
      text: 'Hello LinkedIn',
      scheduled_at_utc: '2026-06-02T14:30:00.000Z',
      account_type: 'personal',
      visibility: 'PUBLIC',
    }
    const parsed = PublishPayloadSchema.parse(payload)
    expect(parsed.text).toBe(payload.text)
    expect(parsed.account_type).toBe('personal')
  })

  it('defaults visibility to PUBLIC', () => {
    const parsed = PublishPayloadSchema.parse({
      text: 'Hi',
      scheduled_at_utc: '2026-06-02T14:30:00.000Z',
      account_type: 'personal',
    })
    expect(parsed.visibility).toBe('PUBLIC')
  })

  it('rejects text >3000 chars on personal', () => {
    expect(() =>
      PublishPayloadSchema.parse({
        text: 'x'.repeat(3001),
        scheduled_at_utc: '2026-06-02T14:30:00.000Z',
        account_type: 'personal',
      }),
    ).toThrow()
  })

  it('rejects text >700 chars on company', () => {
    expect(() =>
      PublishPayloadSchema.parse({
        text: 'x'.repeat(701),
        scheduled_at_utc: '2026-06-02T14:30:00.000Z',
        account_type: 'company',
      }),
    ).toThrow()
  })

  it('rejects media and carousel_pdf together', () => {
    expect(() =>
      PublishPayloadSchema.parse({
        text: 'Hi',
        scheduled_at_utc: '2026-06-02T14:30:00.000Z',
        account_type: 'personal',
        media: [{ path: 'a.jpg', mime: 'image/jpeg' }],
        carousel_pdf: { path: 'a.pdf', page_count: 5 },
      }),
    ).toThrow(/mutually exclusive/)
  })

  it('rejects carousel_pdf >300 pages', () => {
    expect(() =>
      PublishPayloadSchema.parse({
        text: 'Hi',
        scheduled_at_utc: '2026-06-02T14:30:00.000Z',
        account_type: 'personal',
        carousel_pdf: { path: 'a.pdf', page_count: 301 },
      }),
    ).toThrow()
  })

  it('rejects first_comment >1250 chars', () => {
    expect(() =>
      PublishPayloadSchema.parse({
        text: 'Hi',
        scheduled_at_utc: '2026-06-02T14:30:00.000Z',
        account_type: 'personal',
        first_comment: 'x'.repeat(1251),
      }),
    ).toThrow()
  })

  it('rejects non-ISO scheduled_at_utc', () => {
    expect(() =>
      PublishPayloadSchema.parse({
        text: 'Hi',
        scheduled_at_utc: '2026-06-02 14:30',
        account_type: 'personal',
      }),
    ).toThrow()
  })
})
