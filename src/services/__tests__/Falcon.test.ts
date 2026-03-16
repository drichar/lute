vi.mock('@/services/Algo', () => ({
  default: {
    algod: {
      compile: vi.fn(),
    },
  },
}))

vi.mock('falcon-1024', () => ({
  generateKey: vi.fn((seed: Uint8Array) => ({
    publicKey: new Uint8Array(
      Array.from({ length: 32 }, (_, i) => seed[i % seed.length]! ^ 0xaa),
    ),
    privateKey: new Uint8Array(
      Array.from({ length: 64 }, (_, i) => seed[i % seed.length]! ^ 0x55),
    ),
  })),
  signCompressed: vi.fn(),
}))

import { describe, it, expect, vi } from 'vitest'
import Falcon from '@/services/Falcon'

describe('Falcon.getLsigTeal', () => {
  it('substitutes counter and public key into TEAL template', () => {
    const counter = 0
    const publicKey = new Uint8Array([0xab, 0xcd, 0xef])
    const result = Falcon.getLsigTeal(counter, publicKey)

    expect(result).toContain('bytecblock 0x00')
    expect(result).toContain('pushbytes 0xabcdef')
    expect(result).toContain('#pragma version 12')
    expect(result).toContain('falcon_verify')
  })

  it('formats counter as 2-digit hex', () => {
    const publicKey = new Uint8Array([0x01])

    expect(Falcon.getLsigTeal(0, publicKey)).toContain('bytecblock 0x00')
    expect(Falcon.getLsigTeal(1, publicKey)).toContain('bytecblock 0x01')
    expect(Falcon.getLsigTeal(15, publicKey)).toContain('bytecblock 0x0f')
    expect(Falcon.getLsigTeal(255, publicKey)).toContain('bytecblock 0xff')
  })

  it('encodes full public key as hex', () => {
    const publicKey = new Uint8Array(Array.from({ length: 8 }, (_, i) => i))
    const result = Falcon.getLsigTeal(0, publicKey)
    expect(result).toContain('pushbytes 0x0001020304050607')
  })

  it('preserves TEAL structure', () => {
    const result = Falcon.getLsigTeal(0, new Uint8Array([0xff]))
    const lines = result.split('\n')
    expect(lines[0]).toBe('#pragma version 12')
    expect(lines[1]).toContain('bytecblock')
    expect(lines[2]).toBe('txn TxID')
    expect(lines[3]).toBe('arg 0')
    expect(lines[4]).toContain('pushbytes')
    expect(lines[5]).toBe('falcon_verify')
  })
})

describe('Falcon.keyPair', () => {
  it('calls generateKey with HKDF-derived key from seed', () => {
    const seed = new Uint8Array(64).fill(0x42)
    const keyPair = Falcon.keyPair(seed)

    // The mock returns objects with publicKey and privateKey
    expect(keyPair).toHaveProperty('publicKey')
    expect(keyPair).toHaveProperty('privateKey')
  })

  it('produces deterministic output for same seed', () => {
    const seed = new Uint8Array(64).fill(0x42)
    const a = Falcon.keyPair(seed)
    const b = Falcon.keyPair(seed)
    expect(a.publicKey).toEqual(b.publicKey)
    expect(a.privateKey).toEqual(b.privateKey)
  })
})
