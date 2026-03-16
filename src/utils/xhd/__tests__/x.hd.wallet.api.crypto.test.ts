import { describe, it, expect } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import * as bip39 from '@scure/bip39'
import {
  XHDWalletAPI,
  KeyContext,
  BIP32DerivationType,
  harden,
} from '../x.hd.wallet.api.crypto'
import { fromSeed } from '../bip32-ed25519'
import { crypto_scalarmult_ed25519_base_noclamp } from '../sumo.facade'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const TEST_SEED = Buffer.from(bip39.mnemonicToSeedSync(TEST_MNEMONIC))

describe('harden', () => {
  it('harden(0) = 0x80000000', () => {
    expect(harden(0)).toBe(0x80000000)
  })

  it('harden(44) = 0x8000002C', () => {
    expect(harden(44)).toBe(0x8000002c)
  })

  it('harden(283) = 0x8000011B', () => {
    expect(harden(283)).toBe(0x8000011b)
  })
})

describe('XHDWalletAPI.keyGen', () => {
  const api = new XHDWalletAPI()

  it('returns a 32-byte public key', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const pubKey = await api.keyGen(rootKey, KeyContext.Address, 0, 0)
    expect(pubKey.length).toBe(32)
  })

  it('produces deterministic output', async () => {
    const rootKeyA = fromSeed(TEST_SEED)
    const rootKeyB = fromSeed(TEST_SEED)
    const a = await api.keyGen(rootKeyA, KeyContext.Address, 0, 0)
    const b = await api.keyGen(rootKeyB, KeyContext.Address, 0, 0)
    expect(a).toEqual(b)
  })

  it('different accounts produce different keys', async () => {
    const rootKeyA = fromSeed(TEST_SEED)
    const rootKeyB = fromSeed(TEST_SEED)
    const keyAcct0 = await api.keyGen(rootKeyA, KeyContext.Address, 0, 0)
    const keyAcct1 = await api.keyGen(rootKeyB, KeyContext.Address, 1, 0)
    expect(keyAcct0).not.toEqual(keyAcct1)
  })

  it('different key indexes produce different keys', async () => {
    const rootKeyA = fromSeed(TEST_SEED)
    const rootKeyB = fromSeed(TEST_SEED)
    const keyIdx0 = await api.keyGen(rootKeyA, KeyContext.Address, 0, 0)
    const keyIdx1 = await api.keyGen(rootKeyB, KeyContext.Address, 0, 1)
    expect(keyIdx0).not.toEqual(keyIdx1)
  })

  it('different contexts produce different keys', async () => {
    const rootKeyA = fromSeed(TEST_SEED)
    const rootKeyB = fromSeed(TEST_SEED)
    const addrKey = await api.keyGen(rootKeyA, KeyContext.Address, 0, 0)
    const idKey = await api.keyGen(rootKeyB, KeyContext.Identity, 0, 0)
    expect(addrKey).not.toEqual(idKey)
  })

  it('public key is a valid Ed25519 point', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const pubKey = await api.keyGen(rootKey, KeyContext.Address, 0, 0)
    // Should not throw if valid
    expect(() => ed25519.Point.fromBytes(pubKey)).not.toThrow()
  })
})

describe('XHDWalletAPI.signAlgoTransaction (sign/verify roundtrip)', () => {
  const api = new XHDWalletAPI()

  it('produces a valid 64-byte signature', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const message = new TextEncoder().encode('test message')
    const sig = await api.signAlgoTransaction(
      rootKey,
      KeyContext.Address,
      0,
      0,
      message,
    )
    expect(sig.length).toBe(64)
  })

  it('signature verifies against the derived public key', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const pubKey = await api.keyGen(
      fromSeed(TEST_SEED),
      KeyContext.Address,
      0,
      0,
    )
    const message = new TextEncoder().encode('Hello Algorand')

    const sig = await api.signAlgoTransaction(
      rootKey,
      KeyContext.Address,
      0,
      0,
      message,
    )

    // Verify using noble/curves ed25519
    const isValid = ed25519.verify(sig, message, pubKey)
    expect(isValid).toBe(true)
  })

  it('signature does NOT verify with wrong message', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const pubKey = await api.keyGen(
      fromSeed(TEST_SEED),
      KeyContext.Address,
      0,
      0,
    )
    const message = new TextEncoder().encode('original')
    const wrongMessage = new TextEncoder().encode('tampered')

    const sig = await api.signAlgoTransaction(
      rootKey,
      KeyContext.Address,
      0,
      0,
      message,
    )

    const isValid = ed25519.verify(sig, wrongMessage, pubKey)
    expect(isValid).toBe(false)
  })

  it('signature does NOT verify with wrong public key', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const wrongPubKey = await api.keyGen(
      fromSeed(TEST_SEED),
      KeyContext.Address,
      1,
      0,
    )
    const message = new TextEncoder().encode('Hello')

    const sig = await api.signAlgoTransaction(
      rootKey,
      KeyContext.Address,
      0,
      0,
      message,
    )

    const isValid = ed25519.verify(sig, message, wrongPubKey)
    expect(isValid).toBe(false)
  })

  it('produces deterministic signatures', async () => {
    const message = new TextEncoder().encode('deterministic')
    const sigA = await api.signAlgoTransaction(
      fromSeed(TEST_SEED),
      KeyContext.Address,
      0,
      0,
      message,
    )
    const sigB = await api.signAlgoTransaction(
      fromSeed(TEST_SEED),
      KeyContext.Address,
      0,
      0,
      message,
    )
    expect(sigA).toEqual(sigB)
  })
})

describe('XHDWalletAPI.deriveKey', () => {
  const api = new XHDWalletAPI()

  it('private key derivation returns 96 bytes', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const result = await api.deriveKey(
      rootKey,
      [harden(44), harden(283), harden(0), 0, 0],
      true,
      BIP32DerivationType.Peikert,
    )
    expect(result.length).toBe(96)
  })

  it('public key derivation returns 64 bytes (pub + chainCode)', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const result = await api.deriveKey(
      rootKey,
      [harden(44), harden(283), harden(0), 0, 0],
      false,
      BIP32DerivationType.Peikert,
    )
    expect(result.length).toBe(64)
  })

  it('public key from deriveKey matches keyGen output', async () => {
    const rootKeyA = fromSeed(TEST_SEED)
    const rootKeyB = fromSeed(TEST_SEED)

    const pubFromDeriveKey = (
      await api.deriveKey(
        rootKeyA,
        [harden(44), harden(283), harden(0), 0, 0],
        false,
        BIP32DerivationType.Peikert,
      )
    ).slice(0, 32)

    const pubFromKeyGen = await api.keyGen(
      rootKeyB,
      KeyContext.Address,
      0,
      0,
      BIP32DerivationType.Peikert,
    )

    expect(pubFromDeriveKey).toEqual(pubFromKeyGen)
  })

  it('private key scalar matches public key via base point multiplication', async () => {
    const rootKey = fromSeed(TEST_SEED)
    const privExtended = await api.deriveKey(
      rootKey,
      [harden(44), harden(283), harden(0), 0, 0],
      true,
      BIP32DerivationType.Peikert,
    )
    const scalar = privExtended.slice(0, 32)
    const pubFromScalar = crypto_scalarmult_ed25519_base_noclamp(scalar)

    const pubFromKeyGen = await api.keyGen(
      fromSeed(TEST_SEED),
      KeyContext.Address,
      0,
      0,
    )

    expect(pubFromScalar).toEqual(pubFromKeyGen)
  })
})
