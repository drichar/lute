import { describe, it, expect } from 'vitest'
import * as bip39 from '@scure/bip39'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  fromSeed,
  trunc_256_minus_g_bits,
  deriveChildNodePrivate,
  deriveChildNodePublic,
} from '../bip32-ed25519'
import { harden } from '../x.hd.wallet.api.crypto'

// Well-known BIP39 test mnemonic
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_SEED = Buffer.from(bip39.mnemonicToSeedSync(TEST_MNEMONIC))

describe('fromSeed', () => {
  it('returns a 96-byte extended root key', () => {
    const rootKey = fromSeed(TEST_SEED)
    expect(rootKey.length).toBe(96)
  })

  it('applies correct clamping to kL', () => {
    const rootKey = fromSeed(TEST_SEED)
    const kL = rootKey.slice(0, 32)

    // Lowest 3 bits of first byte are cleared
    expect(kL[0]! & 0b00000111).toBe(0)
    // Highest bit of last byte is cleared
    expect(kL[31]! & 0b10000000).toBe(0)
    // Second highest bit of last byte is set
    expect(kL[31]! & 0b01000000).toBe(0b01000000)
  })

  it('produces deterministic output', () => {
    const a = fromSeed(TEST_SEED)
    const b = fromSeed(TEST_SEED)
    expect(a).toEqual(b)
  })

  it('produces different keys for different seeds', () => {
    const otherMnemonic =
      'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'
    const otherSeed = Buffer.from(bip39.mnemonicToSeedSync(otherMnemonic))
    const a = fromSeed(TEST_SEED)
    const b = fromSeed(otherSeed)
    expect(a).not.toEqual(b)
  })
})

describe('trunc_256_minus_g_bits', () => {
  it('returns array unchanged when g=0', () => {
    const arr = new Uint8Array([0xff, 0xff, 0xff, 0xff])
    const result = trunc_256_minus_g_bits(arr, 0)
    expect(result).toEqual(arr)
  })

  it('zeros last byte when g=8', () => {
    const arr = new Uint8Array([0xff, 0xff, 0xff, 0xff])
    const result = trunc_256_minus_g_bits(arr, 8)
    expect(result).toEqual(new Uint8Array([0xff, 0xff, 0xff, 0x00]))
  })

  it('zeros last byte + top bit of second-to-last when g=9', () => {
    const arr = new Uint8Array([0xff, 0xff, 0xff, 0xff])
    const result = trunc_256_minus_g_bits(arr, 9)
    expect(result[3]).toBe(0x00) // last byte zeroed
    expect(result[2]).toBe(0x7f) // top bit of second-to-last cleared
  })

  it('zeros all bytes when g=256', () => {
    const arr = new Uint8Array(32).fill(0xff)
    const result = trunc_256_minus_g_bits(arr, 256)
    expect(result).toEqual(new Uint8Array(32))
  })

  it('throws for g < 0', () => {
    const arr = new Uint8Array(32)
    expect(() => trunc_256_minus_g_bits(arr, -1)).toThrow()
  })

  it('throws for g > 256', () => {
    const arr = new Uint8Array(32)
    expect(() => trunc_256_minus_g_bits(arr, 257)).toThrow()
  })

  it('does not mutate the original array', () => {
    const arr = new Uint8Array([0xff, 0xff])
    const original = new Uint8Array(arr)
    trunc_256_minus_g_bits(arr, 8)
    expect(arr).toEqual(original)
  })
})

describe('deriveChildNodePrivate', () => {
  it('returns a 96-byte extended key for non-hardened derivation', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const child = await deriveChildNodePrivate(rootKey, 0)
    expect(child.length).toBe(96)
  })

  it('returns a 96-byte extended key for hardened derivation', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const child = await deriveChildNodePrivate(rootKey, harden(44))
    expect(child.length).toBe(96)
  })

  it('produces deterministic output', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const a = await deriveChildNodePrivate(rootKey, 0)
    const b = await deriveChildNodePrivate(rootKey, 0)
    expect(a).toEqual(b)
  })

  it('produces different keys for different indexes', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const a = await deriveChildNodePrivate(rootKey, 0)
    const b = await deriveChildNodePrivate(rootKey, 1)
    expect(a).not.toEqual(b)
  })

  it('produces different keys for hardened vs non-hardened', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const nonHardened = await deriveChildNodePrivate(rootKey, 0)
    const hardened = await deriveChildNodePrivate(rootKey, harden(0))
    expect(nonHardened).not.toEqual(hardened)
  })
})

describe('deriveChildNodePublic', () => {
  it('returns a 64-byte extended public key', async () => {
    const rootKey = fromSeed(TEST_SEED)
    // First derive a private child to get an extended key we can derive public from
    const childPrivate = await deriveChildNodePrivate(rootKey, harden(44))
    // Extract (pub, chainCode) from private key
    const { crypto_scalarmult_ed25519_base_noclamp } = await import(
      '../sumo.facade'
    )
    const pub = crypto_scalarmult_ed25519_base_noclamp(
      childPrivate.slice(0, 32),
    )
    const extPub = new Uint8Array(
      Buffer.concat([pub, childPrivate.slice(64, 96)]),
    )

    const childPub = await deriveChildNodePublic(extPub, 0)
    expect(childPub.length).toBe(64)
  })

  it('throws for hardened index > 0x80000000', async () => {
    const extPub = new Uint8Array(64)
    extPub.set(ed25519BasePoint(), 0)
    // The code checks `index > 0x80000000`, so harden(1) = 0x80000001 triggers it
    await expect(
      deriveChildNodePublic(extPub, harden(1)),
    ).rejects.toThrow('can not derive public key with harden')
  })

  it('produces deterministic output', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const childPrivate = await deriveChildNodePrivate(rootKey, harden(44))
    const { crypto_scalarmult_ed25519_base_noclamp } = await import(
      '../sumo.facade'
    )
    const pub = crypto_scalarmult_ed25519_base_noclamp(
      childPrivate.slice(0, 32),
    )
    const extPub = new Uint8Array(
      Buffer.concat([pub, childPrivate.slice(64, 96)]),
    )
    const a = await deriveChildNodePublic(extPub, 0)
    const b = await deriveChildNodePublic(extPub, 0)
    expect(a).toEqual(b)
  })
})

// Helper to get ed25519 base point bytes
function ed25519BasePoint(): Uint8Array {
  return ed25519.Point.BASE.toBytes()
}
