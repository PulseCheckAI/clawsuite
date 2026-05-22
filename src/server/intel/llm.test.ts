import { describe, expect, it } from 'vitest'
import { buildEnrichPrompt, parseEnrichResponse, toVectorLiteral } from './llm'

describe('toVectorLiteral', () => {
  it('formats a number array as a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, -0.3])).toBe('[0.1,0.2,-0.3]')
    expect(toVectorLiteral([])).toBe('[]')
  })
})

describe('buildEnrichPrompt', () => {
  it('includes title, body, and the interest profile', () => {
    const p = buildEnrichPrompt('My Title', 'Body text', 'restaurants')
    expect(p).toContain('My Title')
    expect(p).toContain('Body text')
    expect(p).toContain('restaurants')
    expect(p).toContain('STRICT JSON')
  })
})

describe('parseEnrichResponse', () => {
  it('parses valid JSON and clamps relevance + caps tags', () => {
    const r = parseEnrichResponse(
      '{"summary":" hi ","tags":["A","B","a","c","d","e","f","g","h"],"relevance":1.7}',
    )
    expect(r.summary).toBe('hi')
    expect(r.relevance).toBe(1) // clamped to 1.0
    expect(r.tags).toEqual(['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g']) // lowercased, capped at 8
  })
  it('returns nulls/empty on garbage', () => {
    expect(parseEnrichResponse('not json')).toEqual({
      summary: null,
      tags: [],
      relevance: null,
    })
  })
  it('handles missing fields', () => {
    expect(parseEnrichResponse('{"tags":["x"]}')).toEqual({
      summary: null,
      tags: ['x'],
      relevance: null,
    })
  })
})
