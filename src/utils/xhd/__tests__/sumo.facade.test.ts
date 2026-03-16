import { describe, it, expect } from 'vitest'
import { numberToBytesLE, bytesToNumberLE } from '@noble/curves/utils.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  crypto_scalarmult_ed25519_base_noclamp,
  crypto_core_ed25519_add,
  crypto_core_ed25519_scalar_add,
  crypto_core_ed25519_scalar_mul,
  crypto_core_ed25519_scalar_reduce,
} from '../sumo.facade'

describe('crypto_scalarmult_ed25519_base_noclamp', () => {
  it('produces the base point for scalar = 1', () => {
    const one = numberToBytesLE(1n, 32)
    const result = crypto_scalarmult_ed25519_base_noclamp(one)
    expect(result).toEqual(ed25519.Point.BASE.toBytes())
  })

  it('produces different results for different scalars', () => {
    const a = numberToBytesLE(2n, 32)
    const b = numberToBytesLE(3n, 32)
    const resultA = crypto_scalarmult_ed25519_base_noclamp(a)
    const resultB = crypto_scalarmult_ed25519_base_noclamp(b)
    expect(resultA).not.toEqual(resultB)
  })

  it('scalar * BASE matches noble/curves multiplication', () => {
    const scalar = 123456789n
    const scalarBytes = numberToBytesLE(scalar, 32)
    const result = crypto_scalarmult_ed25519_base_noclamp(scalarBytes)
    const expected = ed25519.Point.BASE.multiply(scalar).toBytes()
    expect(result).toEqual(expected)
  })

  it('throws for zero scalar', () => {
    const zero = new Uint8Array(32)
    expect(() => crypto_scalarmult_ed25519_base_noclamp(zero)).toThrow(
      'scalar is 0',
    )
  })

  it('throws for wrong-length scalar', () => {
    const short = new Uint8Array(16)
    short[0] = 1
    expect(() => crypto_scalarmult_ed25519_base_noclamp(short)).toThrow(
      'scalar must be 32 bytes',
    )
  })

  it('handles scalar multiplication deterministically', () => {
    const scalar = numberToBytesLE(42n, 32)
    const a = crypto_scalarmult_ed25519_base_noclamp(scalar)
    const b = crypto_scalarmult_ed25519_base_noclamp(scalar)
    expect(a).toEqual(b)
  })

  it('handles scalar >= curve order by reducing', () => {
    // Set scalar to curve order + 1, should reduce to 1 (base point)
    const order = ed25519.Point.Fn.ORDER
    const overflowScalar = numberToBytesLE(order + 1n, 32)
    const result = crypto_scalarmult_ed25519_base_noclamp(overflowScalar)
    // After reduction: (order + 1) mod order = 1, so result = BASE
    expect(result).toEqual(ed25519.Point.BASE.toBytes())
  })
})

describe('crypto_core_ed25519_add', () => {
  it('adds two known points correctly', () => {
    // BASE + BASE should equal 2*BASE
    const base = ed25519.Point.BASE.toBytes()
    const result = crypto_core_ed25519_add(base, base)
    const expected = ed25519.Point.BASE.multiply(2n).toBytes()
    expect(result).toEqual(expected)
  })

  it('is commutative: A + B = B + A', () => {
    const a = ed25519.Point.BASE.multiply(3n).toBytes()
    const b = ed25519.Point.BASE.multiply(7n).toBytes()
    const ab = crypto_core_ed25519_add(a, b)
    const ba = crypto_core_ed25519_add(b, a)
    expect(ab).toEqual(ba)
  })

  it('throws for invalid point bytes', () => {
    // All 0xff bytes is not a valid Ed25519 point
    const invalid = new Uint8Array(32).fill(0xff)
    const base = ed25519.Point.BASE.toBytes()
    expect(() => crypto_core_ed25519_add(invalid, base)).toThrow('invalid point')
  })
})

describe('crypto_core_ed25519_scalar_add', () => {
  it('adds 1 + 1 = 2', () => {
    const one = numberToBytesLE(1n, 32)
    const result = crypto_core_ed25519_scalar_add(one, one)
    expect(bytesToNumberLE(result)).toBe(2n)
  })

  it('wraps around modulo curve order', () => {
    const order = ed25519.Point.Fn.ORDER
    const orderMinusOne = numberToBytesLE(order - 1n, 32)
    const two = numberToBytesLE(2n, 32)
    const result = crypto_core_ed25519_scalar_add(orderMinusOne, two)
    // (order - 1 + 2) mod order = 1
    expect(bytesToNumberLE(result)).toBe(1n)
  })

  it('adding zero returns the original', () => {
    const five = numberToBytesLE(5n, 32)
    const zero = new Uint8Array(32)
    const result = crypto_core_ed25519_scalar_add(five, zero)
    expect(bytesToNumberLE(result)).toBe(5n)
  })
})

describe('crypto_core_ed25519_scalar_mul', () => {
  it('multiplies 3 * 7 = 21', () => {
    const three = numberToBytesLE(3n, 32)
    const seven = numberToBytesLE(7n, 32)
    const result = crypto_core_ed25519_scalar_mul(three, seven)
    expect(bytesToNumberLE(result)).toBe(21n)
  })

  it('multiplying by 1 returns the original', () => {
    const val = numberToBytesLE(12345n, 32)
    const one = numberToBytesLE(1n, 32)
    const result = crypto_core_ed25519_scalar_mul(val, one)
    expect(bytesToNumberLE(result)).toBe(12345n)
  })

  it('multiplying by 0 returns 0', () => {
    const val = numberToBytesLE(12345n, 32)
    const zero = new Uint8Array(32)
    const result = crypto_core_ed25519_scalar_mul(val, zero)
    expect(bytesToNumberLE(result)).toBe(0n)
  })
})

describe('crypto_core_ed25519_scalar_reduce', () => {
  it('reduces a 64-byte hash output to 32-byte scalar', () => {
    const input = new Uint8Array(64)
    input[0] = 0xff // some non-zero value
    const result = crypto_core_ed25519_scalar_reduce(input)
    expect(result.length).toBe(32)
    // Result should be < curve order
    expect(bytesToNumberLE(result)).toBeLessThan(ed25519.Point.Fn.ORDER)
  })

  it('value below order stays the same', () => {
    const small = numberToBytesLE(42n, 32)
    const result = crypto_core_ed25519_scalar_reduce(small)
    expect(bytesToNumberLE(result)).toBe(42n)
  })

  it('reduces value equal to order to 0', () => {
    const order = ed25519.Point.Fn.ORDER
    const orderBytes = numberToBytesLE(order, 64)
    const result = crypto_core_ed25519_scalar_reduce(orderBytes)
    expect(bytesToNumberLE(result)).toBe(0n)
  })
})
