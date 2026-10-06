import { describe, expect, it } from 'vitest'
import { isOwner } from './auth'

describe('isOwner', () => {
  it('lets the owner in', () => {
    expect(isOwner('me@example.com', 'me@example.com')).toBe(true)
  })

  it('ignores case in the address', () => {
    expect(isOwner('Me@Example.com', 'me@example.com')).toBe(true)
  })

  it('keeps someone else out', () => {
    expect(isOwner('you@example.com', 'me@example.com')).toBe(false)
  })

  it('keeps everyone out when no owner is set', () => {
    expect(isOwner('me@example.com', undefined)).toBe(false)
  })

  it('keeps out a login without an address', () => {
    expect(isOwner(null, 'me@example.com')).toBe(false)
  })
})
