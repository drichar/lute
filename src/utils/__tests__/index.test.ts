vi.mock('@/dbLute', () => ({
  set: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(),
  keys: vi.fn(),
  del: vi.fn(),
}))

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatAddr,
  decodeField,
  ipfs2http,
  stringToBigint,
  bigintToString,
  b64url,
  deepClone,
  expireDays,
  waitFor,
} from '@/utils'

describe('formatAddr', () => {
  it('truncates a standard 58-char Algorand address', () => {
    const addr = 'VCMJKWOY5P5P7SKMZFFOCEROPJCZLG36LTLQWFP3DY3LNMZIXE665BNQQY'
    expect(formatAddr(addr)).toBe('VCMJKW...5BNQQY')
  })

  it('returns empty string for undefined', () => {
    expect(formatAddr(undefined)).toBe('')
  })

  it('handles empty string', () => {
    expect(formatAddr('')).toBe('')
  })
})

describe('decodeField', () => {
  it('decodes Uint8Array to utf-8 string by default', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111])
    expect(decodeField(bytes)).toBe('Hello')
  })

  it('decodes Uint8Array to base64', () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111])
    expect(decodeField(bytes, 'base64')).toBe('SGVsbG8=')
  })

  it('decodes Uint8Array to hex', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    expect(decodeField(bytes, 'hex')).toBe('deadbeef')
  })
})

describe('ipfs2http', () => {
  it('replaces ipfs:// with gateway URL', () => {
    expect(ipfs2http('ipfs://QmTest123')).toBe(
      'https://ipfs.algonode.dev/ipfs/QmTest123',
    )
  })

  it('does not modify https:// URLs', () => {
    expect(ipfs2http('https://example.com/image.png')).toBe(
      'https://example.com/image.png',
    )
  })

  it('does not modify URLs without ipfs:// prefix', () => {
    expect(ipfs2http('http://example.com')).toBe('http://example.com')
  })
})

describe('stringToBigint', () => {
  it('converts "1.5" with 6 decimals to 1500000n', () => {
    expect(stringToBigint('1.5', 6)).toBe(1_500_000n)
  })

  it('converts "0.000001" with 6 decimals to 1n', () => {
    expect(stringToBigint('0.000001', 6)).toBe(1n)
  })

  it('converts whole number "100" with 6 decimals', () => {
    expect(stringToBigint('100', 6)).toBe(100_000_000n)
  })

  it('handles leading dot ".5" with 6 decimals', () => {
    expect(stringToBigint('.5', 6)).toBe(500_000n)
  })

  it('truncates excess decimal digits', () => {
    expect(stringToBigint('1.123456789', 6)).toBe(1_123_456n)
  })

  it('handles zero decimals', () => {
    expect(stringToBigint('42', 0)).toBe(42n)
  })

  it('pads short decimal parts', () => {
    expect(stringToBigint('1.1', 6)).toBe(1_100_000n)
  })

  it('converts "0" correctly', () => {
    expect(stringToBigint('0', 6)).toBe(0n)
  })
})

describe('bigintToString', () => {
  it('formats 1500000n with 6 decimals to "1.5" in plain mode', () => {
    expect(bigintToString(1_500_000n, 6, true)).toBe('1.5')
  })

  it('strips trailing zeros', () => {
    expect(bigintToString(1_100_000n, 6, true)).toBe('1.1')
  })

  it('returns whole number when no decimal part', () => {
    expect(bigintToString(1_000_000n, 6, true)).toBe('1')
  })

  it('returns "0" for zero', () => {
    expect(bigintToString(0n, 6, true)).toBe('0')
  })

  it('handles decimals=0', () => {
    expect(bigintToString(42n, 0, true)).toBe('42')
  })

  it('throws for negative decimals', () => {
    expect(() => bigintToString(1n, -1, true)).toThrow('Invalid Decimals')
  })

  it('throws for decimals > 19', () => {
    expect(() => bigintToString(1n, 20, true)).toThrow('Invalid Decimals')
  })

  it('rounds when round parameter is provided', () => {
    // 1.555555 rounded to 2 decimal places
    const result = bigintToString(1_555_555n, 6, true, 2)
    expect(result).toBe('1.56')
  })

  it('handles rounding that carries over to integer part', () => {
    // 0.999950 rounded to 4 decimal places -> 1.0 -> "1"
    const result = bigintToString(999_950n, 6, true, 4)
    expect(result).toBe('1')
  })

  it('formats large numbers with locale separator when plain=false', () => {
    // 1,000,000.5 in locale format - just check it contains the decimal part
    const result = bigintToString(1_000_000_500_000n, 6, false)
    expect(result).toContain('5')
  })
})

describe('b64url', () => {
  it('replaces + with -', () => {
    expect(b64url('abc+def')).toBe('abc-def')
  })

  it('replaces / with _', () => {
    expect(b64url('abc/def')).toBe('abc_def')
  })

  it('removes = padding', () => {
    expect(b64url('abc==')).toBe('abc')
  })

  it('handles all replacements together', () => {
    expect(b64url('a+b/c=')).toBe('a-b_c')
  })

  it('leaves URL-safe strings unchanged', () => {
    expect(b64url('abcdef')).toBe('abcdef')
  })
})

describe('deepClone', () => {
  it('returns primitives unchanged', () => {
    expect(deepClone(42)).toBe(42)
    expect(deepClone('hello')).toBe('hello')
    expect(deepClone(null)).toBe(null)
    expect(deepClone(undefined)).toBe(undefined)
    expect(deepClone(true)).toBe(true)
  })

  it('deep clones arrays', () => {
    const original = [1, [2, 3], [4, [5]]]
    const cloned = deepClone(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned[1]).not.toBe(original[1])
  })

  it('deep clones objects', () => {
    const original = { a: 1, b: { c: 2, d: { e: 3 } } }
    const cloned = deepClone(original)
    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned.b).not.toBe(original.b)
    expect(cloned.b.d).not.toBe(original.b.d)
  })

  it('mutations to clone do not affect original', () => {
    const original = { a: [1, 2], b: { c: 3 } }
    const cloned = deepClone(original)
    cloned.a.push(99)
    cloned.b.c = 999
    expect(original.a).toEqual([1, 2])
    expect(original.b.c).toBe(3)
  })
})

describe('expireDays', () => {
  it('returns undefined for undefined input', () => {
    expect(expireDays(undefined)).toBeUndefined()
  })

  it('returns positive days for future date', () => {
    const future = new Date()
    future.setDate(future.getDate() + 10)
    expect(expireDays(future.toISOString())).toBe(10)
  })

  it('returns negative days for past date', () => {
    const past = new Date()
    past.setDate(past.getDate() - 5)
    expect(expireDays(past.toISOString())).toBe(-5)
  })

  it('returns 0 for today', () => {
    const now = new Date()
    expect(expireDays(now.toISOString())).toBe(0)
  })
})

describe('waitFor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the specified milliseconds', async () => {
    const promise = waitFor(100)
    vi.advanceTimersByTime(100)
    await expect(promise).resolves.toBeUndefined()
  })
})
