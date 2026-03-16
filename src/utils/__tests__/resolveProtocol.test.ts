import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveProtocol } from '@/utils/resolveProtocol'
import algosdk from 'algosdk'

// Generate a valid Algorand address for tests
const TEST_ACCOUNT = algosdk.generateAccount()
const TEST_ADDR = TEST_ACCOUNT.addr.toString()
const IPFS_GATEWAY = 'https://ipfs.algonode.dev/ipfs/'

describe('resolveProtocol', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('ipfs:// protocol', () => {
    it('replaces ipfs:// with gateway URL', async () => {
      const result = await resolveProtocol(
        'ipfs://QmTest123/image.png',
        TEST_ADDR,
      )
      expect(result).toBe(IPFS_GATEWAY + 'QmTest123/image.png')
    })
  })

  describe('https:// protocol', () => {
    it('returns https URL unchanged', async () => {
      const url = 'https://example.com/metadata.json'
      const result = await resolveProtocol(url, TEST_ADDR)
      expect(result).toBe(url)
    })
  })

  describe('#arc3 suffix', () => {
    it('strips #arc3 suffix and fetches metadata', async () => {
      const imageUrl = 'https://example.com/actual-image.png'
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve({ image: imageUrl }),
        }),
      )

      const result = await resolveProtocol(
        'https://example.com/metadata.json#arc3',
        TEST_ADDR,
      )
      expect(result).toBe(imageUrl)
      expect(fetch).toHaveBeenCalledWith('https://example.com/metadata.json')
    })

    it('resolves ipfs:// in fetched metadata image', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: () => Promise.resolve({ image: 'ipfs://QmImageCID' }),
        }),
      )

      const result = await resolveProtocol(
        'ipfs://QmMetaCID#arc3',
        TEST_ADDR,
      )
      expect(result).toBe(IPFS_GATEWAY + 'QmImageCID')
    })
  })

  describe('template-ipfs protocol', () => {
    it('constructs CID from reserve address with raw codec', async () => {
      const url =
        'template-ipfs://{ipfscid:1:raw:reserve:sha2-256}/image.png#arc3'

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: () =>
            Promise.resolve({ image: 'https://example.com/resolved.png' }),
        }),
      )

      const result = await resolveProtocol(url, TEST_ADDR)
      // Should have resolved to an IPFS gateway URL (since #arc3 is present,
      // it fetches metadata and returns the image field)
      expect(result).toBe('https://example.com/resolved.png')
      // Verify fetch was called with an IPFS gateway URL containing a valid CID
      const fetchCall = (fetch as any).mock.calls[0][0] as string
      expect(fetchCall).toMatch(new RegExp(`^${IPFS_GATEWAY.replace(/[/.]/g, '\\$&')}`))
    })

    it('returns URL unchanged for unsupported hash', async () => {
      const url = 'template-ipfs://{ipfscid:1:raw:reserve:sha3-256}'
      const result = await resolveProtocol(url, TEST_ADDR)
      expect(result).toBe(url)
    })

    it('returns URL unchanged for unsupported codec', async () => {
      const url = 'template-ipfs://{ipfscid:1:cbor:reserve:sha2-256}'
      const result = await resolveProtocol(url, TEST_ADDR)
      expect(result).toBe(url)
    })

    it('returns URL unchanged for unsupported asa field', async () => {
      const url = 'template-ipfs://{ipfscid:1:raw:manager:sha2-256}'
      const result = await resolveProtocol(url, TEST_ADDR)
      expect(result).toBe(url)
    })

    it('returns URL unchanged for malformed ipfscid format', async () => {
      const url = 'template-ipfs://{ipfscid:1:raw}'
      const result = await resolveProtocol(url, TEST_ADDR)
      expect(result).toBe(url)
    })
  })

  describe('no protocol', () => {
    it('returns URL unchanged when no known protocol', async () => {
      const url = 'just-a-string'
      const result = await resolveProtocol(url, TEST_ADDR)
      expect(result).toBe(url)
    })
  })
})
