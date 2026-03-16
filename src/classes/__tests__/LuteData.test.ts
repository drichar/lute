// Mock all external dependencies that LuteData imports
vi.mock('@/services/HdWallet', () => ({ default: {} }))
vi.mock('@/services/Seed', () => ({ default: {} }))
vi.mock('@/utils/signers', () => ({ hotSign: vi.fn() }))
vi.mock('@/dbLute', () => ({
  set: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(),
  keys: vi.fn(),
  del: vi.fn(),
}))
vi.mock('@ledgerhq/hw-transport-webhid', () => ({ default: {} }))
vi.mock('@ledgerhq/hw-transport-webusb', () => ({ default: {} }))
vi.mock('ledger-algorand-js', () => ({
  AlgorandApp: vi.fn(),
}))

// Mock sendOrPostMessage to capture errors instead of calling browser APIs
const capturedErrors: any[] = []
vi.mock('@/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils')>()
  return {
    ...actual,
    sendOrPostMessage: vi.fn((message: any) => {
      capturedErrors.push(message)
    }),
    selectDevice: vi.fn(),
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { canonify } from 'canonify'
import LuteData, {
  ERROR_INVALID,
  ERROR_FAILED_DECODING,
  ERROR_BAD_JSON,
  ERROR_FAILED_DOMAIN_AUTH,
  ERROR_INVALID_SCOPE,
} from '@/classes/LuteData'
import type { Siwa } from '@/types'

// Helper: create a valid SIWA object
function makeSiwa(overrides: Partial<Siwa> = {}): Siwa {
  return {
    domain: 'example.com',
    account_address:
      'VCMJKWOY5P5P7SKMZFFOCEROPJCZLG36LTLQWFP3DY3LNMZIXE665BNQQY',
    uri: 'https://example.com',
    version: '1',
    chain_id: '283',
    type: 'ed25519',
    ...overrides,
  }
}

// Helper: encode SIWA as canonical JSON -> base64
function encodeSiwa(siwa: Siwa): string {
  const canonical = canonify(siwa)!
  return Buffer.from(canonical).toString('base64')
}

// Helper: create authenticatorData with SHA-256 of domain in first 32 bytes
async function makeAuthData(domain: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', Buffer.from(domain))
  const authData = new Uint8Array(37)
  authData.set(new Uint8Array(hash), 0)
  return authData
}

beforeEach(() => {
  capturedErrors.length = 0
  // Stub window global so handleError's window.close() doesn't throw
  vi.stubGlobal('window', { close: vi.fn(), dispatchEvent: vi.fn() })
})

describe('LuteData constructor', () => {
  it('throws ERROR_INVALID if data is empty', () => {
    expect(
      () =>
        new LuteData(
          '',
          { encoding: 'base64', scope: 1 },
          new Uint8Array(32),
        ),
    ).toThrow(ERROR_INVALID)
  })

  it('throws ERROR_INVALID if metadata is missing', () => {
    expect(
      () => new LuteData('data', null as any, new Uint8Array(32)),
    ).toThrow(ERROR_INVALID)
  })

  it('throws ERROR_INVALID if authenticatorData is missing', () => {
    expect(
      () =>
        new LuteData('data', { encoding: 'base64', scope: 1 }, null as any),
    ).toThrow(ERROR_INVALID)
  })

  it('constructs successfully with valid parameters', () => {
    const ld = new LuteData(
      'data',
      { encoding: 'base64', scope: 1 },
      new Uint8Array(32),
    )
    expect(ld.data).toBe('data')
  })
})

describe('LuteData.validate', () => {
  it('validates a correct SIWA message', async () => {
    const siwa = makeSiwa()
    const data = encodeSiwa(siwa)
    const authData = await makeAuthData(siwa.domain)

    const ld = new LuteData(data, { encoding: 'base64', scope: 1 }, authData)
    await ld.validate()

    expect(ld.siwa).toBeDefined()
    expect(ld.siwa!.domain).toBe('example.com')
    expect(ld.siwa!.chain_id).toBe('283')
    expect(ld.siwa!.type).toBe('ed25519')
    expect(capturedErrors).toHaveLength(0)
  })

  it('validates SIWA with optional fields', async () => {
    const siwa = makeSiwa({
      statement: 'Sign in to Example',
      nonce: 'abc123',
      'issued-at': '2024-01-01T00:00:00Z',
      resources: ['https://example.com/tos'],
    })
    const data = encodeSiwa(siwa)
    const authData = await makeAuthData(siwa.domain)

    const ld = new LuteData(data, { encoding: 'base64', scope: 1 }, authData)
    await ld.validate()

    expect(ld.siwa).toBeDefined()
    expect(ld.siwa!.nonce).toBe('abc123')
    expect(ld.siwa!.resources).toEqual(['https://example.com/tos'])
  })

  it('sends error for unsupported encoding', async () => {
    const ld = new LuteData(
      'data',
      { encoding: 'utf-8' as any, scope: 1 },
      new Uint8Array(32),
    )
    await ld.validate()

    expect(capturedErrors).toHaveLength(1)
    expect(capturedErrors[0].code).toBe(ERROR_FAILED_DECODING.code)
  })

  it('sends error for invalid scope', async () => {
    const siwa = makeSiwa()
    const data = encodeSiwa(siwa)
    const authData = await makeAuthData(siwa.domain)

    const ld = new LuteData(data, { encoding: 'base64', scope: 99 as any }, authData)
    await ld.validate()

    expect(capturedErrors).toHaveLength(1)
    expect(capturedErrors[0].code).toBe(ERROR_INVALID_SCOPE.code)
  })

  it('sends error for invalid JSON structure', async () => {
    const invalidJson = Buffer.from('{"not": "siwa"}').toString('base64')
    const authData = await makeAuthData('example.com')

    const ld = new LuteData(
      invalidJson,
      { encoding: 'base64', scope: 1 },
      authData,
    )
    await ld.validate()

    expect(capturedErrors).toHaveLength(1)
    expect(capturedErrors[0].code).toBe(ERROR_BAD_JSON.code)
  })

  it('sends error for non-canonical JSON', async () => {
    const siwa = makeSiwa()
    // Create non-canonical JSON (keys in wrong order)
    const nonCanonical = JSON.stringify({
      version: siwa.version,
      domain: siwa.domain,
      account_address: siwa.account_address,
      uri: siwa.uri,
      chain_id: siwa.chain_id,
      type: siwa.type,
    })
    const data = Buffer.from(nonCanonical).toString('base64')
    const authData = await makeAuthData(siwa.domain)

    const ld = new LuteData(data, { encoding: 'base64', scope: 1 }, authData)
    await ld.validate()

    expect(capturedErrors).toHaveLength(1)
    expect(capturedErrors[0].code).toBe(ERROR_BAD_JSON.code)
  })

  it('sends error for wrong domain hash in authenticatorData', async () => {
    const siwa = makeSiwa({ domain: 'example.com' })
    const data = encodeSiwa(siwa)
    const authData = await makeAuthData('evil.com')

    const ld = new LuteData(data, { encoding: 'base64', scope: 1 }, authData)
    await ld.validate()

    expect(capturedErrors).toHaveLength(1)
    expect(capturedErrors[0].code).toBe(ERROR_FAILED_DOMAIN_AUTH.code)
  })
})

describe('LuteData.getMessage', () => {
  it('formats a basic SIWA message', async () => {
    const siwa = makeSiwa()
    const data = encodeSiwa(siwa)
    const authData = await makeAuthData(siwa.domain)

    const ld = new LuteData(data, { encoding: 'base64', scope: 1 }, authData)
    await ld.validate()

    const message = ld.getMessage()
    expect(message).toContain('URI: https://example.com')
    expect(message).toContain('Version: 1')
    expect(message).toContain('Chain ID: 283')
  })

  it('includes optional fields when present', async () => {
    const siwa = makeSiwa({
      nonce: 'test-nonce',
      'issued-at': '2024-01-01T00:00:00Z',
      resources: ['https://example.com/tos', 'https://example.com/privacy'],
    })
    const data = encodeSiwa(siwa)
    const authData = await makeAuthData(siwa.domain)

    const ld = new LuteData(data, { encoding: 'base64', scope: 1 }, authData)
    await ld.validate()

    const message = ld.getMessage()
    expect(message).toContain('Nonce: test-nonce')
    expect(message).toContain('Issued At: 2024-01-01T00:00:00Z')
    expect(message).toContain('Resources:')
    expect(message).toContain('- https://example.com/tos')
    expect(message).toContain('- https://example.com/privacy')
  })

  it('throws if called before validate', () => {
    const ld = new LuteData(
      'data',
      { encoding: 'base64', scope: 1 },
      new Uint8Array(32),
    )
    expect(() => ld.getMessage()).toThrow(ERROR_BAD_JSON)
  })
})

describe('LuteData error codes', () => {
  it('ERROR_INVALID has code 4300', () => {
    expect(ERROR_INVALID.code).toBe(4300)
  })

  it('ERROR_FAILED_DECODING has code 4602', () => {
    expect(ERROR_FAILED_DECODING.code).toBe(4602)
  })

  it('ERROR_BAD_JSON has code 4609', () => {
    expect(ERROR_BAD_JSON.code).toBe(4609)
  })

  it('ERROR_FAILED_DOMAIN_AUTH has code 4610', () => {
    expect(ERROR_FAILED_DOMAIN_AUTH.code).toBe(4610)
  })

  it('ERROR_INVALID_SCOPE has code 4600', () => {
    expect(ERROR_INVALID_SCOPE.code).toBe(4600)
  })
})
