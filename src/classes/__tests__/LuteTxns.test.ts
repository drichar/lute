// Mock heavy dependencies before any imports
vi.mock('@/services/Algo', () => ({
  default: {
    algod: {
      accountInformation: vi.fn(),
      getTransactionParams: vi.fn(),
      status: vi.fn(),
    },
  },
}))
vi.mock('@/services/Falcon', () => ({ default: {} }))
vi.mock('@/services/Msig', () => ({
  default: { loadApp: vi.fn(), buildGroup: vi.fn() },
}))
vi.mock('@/data', () => ({
  msigAbiContract: { methods: [] },
}))
vi.mock('@/utils/signers', () => ({ signer: vi.fn() }))
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

const capturedMessages: any[] = []
vi.mock('@/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils')>()
  return {
    ...actual,
    sendOrPostMessage: vi.fn((message: any) => {
      capturedMessages.push(message)
    }),
    send: vi.fn(),
    selectDevice: vi.fn(),
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import algosdk from 'algosdk'
import LuteTxns from '@/classes/LuteTxns'
import type { WalletTransaction } from '@/types'
import { signer } from '@/utils/signers'

// --- Helpers ---

const GENESIS_ID = 'mainnet-v1.0'
const GENESIS_HASH = 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8='
const GENESIS_HASH_BYTES = Buffer.from(GENESIS_HASH, 'base64')

const SENDER = algosdk.generateAccount()
const RECEIVER = algosdk.generateAccount()

function makeSuggestedParams(
  overrides: Partial<algosdk.SuggestedParams> = {},
): algosdk.SuggestedParams {
  return {
    flatFee: true,
    fee: 1000n,
    minFee: 1000n,
    firstValid: 1000n,
    lastValid: 2000n,
    genesisID: GENESIS_ID,
    genesisHash: GENESIS_HASH_BYTES,
    ...overrides,
  }
}

function makePayTxn(
  from = SENDER.addr,
  to = RECEIVER.addr,
  amount = 1000n,
  sp = makeSuggestedParams(),
): algosdk.Transaction {
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: from,
    receiver: to,
    amount,
    suggestedParams: sp,
  })
}

function txnToWalletTxn(
  txn: algosdk.Transaction,
  overrides: Partial<WalletTransaction> = {},
): WalletTransaction {
  return {
    txn: Buffer.from(txn.toByte()).toString('base64'),
    ...overrides,
  }
}

// Create a group of transactions with valid group ID
function makeGroupedWalletTxns(
  txns: algosdk.Transaction[],
): WalletTransaction[] {
  algosdk.assignGroupID(txns)
  return txns.map((t) => txnToWalletTxn(t))
}

// --- Setup ---

let mockStore: any

beforeEach(() => {
  capturedMessages.length = 0

  mockStore = {
    debug: false,
    isWeb: true,
    overlay: false,
    accounts: [],
    allNetworks: [
      {
        name: 'MainNet',
        genesisID: GENESIS_ID,
        genesisHash: GENESIS_HASH,
      },
    ],
    networkName: '',
    refresh: 0,
    device: { transport: undefined },
    luteTxns: undefined,
    setSnackbar: vi.fn(),
  }

  vi.mocked(useAppStore).mockReturnValue(mockStore)

  vi.stubGlobal('window', {
    close: vi.fn(),
    dispatchEvent: vi.fn(),
    opener: { postMessage: vi.fn() },
  })
})

// --- Tests ---

describe('LuteTxns constructor', () => {
  it('decodes base64-encoded transactions', () => {
    const txn = makePayTxn()
    const lt = new LuteTxns([txnToWalletTxn(txn)])

    expect(lt.txns).toHaveLength(1)
    expect(lt.dtxns).toHaveLength(1)
    expect(lt.dtxns[0]!.sender.toString()).toBe(txn.sender.toString())
  })

  it('preserves tabId', () => {
    const lt = new LuteTxns([txnToWalletTxn(makePayTxn())], 42)
    expect(lt.tabId).toBe(42)
  })

  it('decodes multiple transactions', () => {
    const txn1 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n)
    const txn2 = makePayTxn(SENDER.addr, RECEIVER.addr, 2000n)
    const lt = new LuteTxns([txnToWalletTxn(txn1), txnToWalletTxn(txn2)])

    expect(lt.dtxns).toHaveLength(2)
  })
})

describe('LuteTxns.validateNetwork', () => {
  it('accepts transactions on the same known network', async () => {
    const txn1 = makePayTxn()
    const txn2 = makePayTxn()
    const lt = new LuteTxns([txnToWalletTxn(txn1), txnToWalletTxn(txn2)])
    await lt.validateNetwork()

    expect(mockStore.networkName).toBe('MainNet')
    expect(capturedMessages).toHaveLength(0)
  })

  it('sends error for mixed-network transactions', async () => {
    const sp1 = makeSuggestedParams()
    const sp2 = makeSuggestedParams({
      genesisID: 'testnet-v1.0',
      genesisHash: Buffer.from('SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=', 'base64'),
    })
    const txn1 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n, sp1)
    const txn2 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n, sp2)
    const lt = new LuteTxns([txnToWalletTxn(txn1), txnToWalletTxn(txn2)])
    await lt.validateNetwork()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Mixed Networks')
  })

  it('sends error for unknown network', async () => {
    mockStore.allNetworks = []
    const lt = new LuteTxns([txnToWalletTxn(makePayTxn())])
    await lt.validateNetwork()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Unknown Network')
  })

  it('maps sandnet-v1 genesis ID to dockernet-v1', async () => {
    const sp = makeSuggestedParams({ genesisID: 'sandnet-v1' })
    mockStore.allNetworks = [
      { name: 'LocalNet', genesisID: 'dockernet-v1', genesisHash: GENESIS_HASH },
    ]
    const lt = new LuteTxns([txnToWalletTxn(makePayTxn(SENDER.addr, RECEIVER.addr, 1000n, sp))])
    await lt.validateNetwork()

    expect(mockStore.networkName).toBe('LocalNet')
  })
})

describe('LuteTxns.validateGroup', () => {
  it('sends error for empty transaction array', async () => {
    const lt = new LuteTxns([])
    // dtxns is empty, so length is 0
    await lt.validateGroup()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Empty Transaction Array')
  })

  it('passes validation for a single ungrouped transaction', async () => {
    const lt = new LuteTxns([txnToWalletTxn(makePayTxn())])
    await lt.validateGroup()

    expect(capturedMessages).toHaveLength(0)
    expect(lt.groupWarn).toBe(false)
  })

  it('passes validation for a correctly grouped pair', async () => {
    const txn1 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n)
    const txn2 = makePayTxn(SENDER.addr, RECEIVER.addr, 2000n)
    const walletTxns = makeGroupedWalletTxns([txn1, txn2])
    const lt = new LuteTxns(walletTxns)
    await lt.validateGroup()

    expect(capturedMessages).toHaveLength(0)
  })

  it('sends error for invalid group ID', async () => {
    // Create a grouped pair, then tamper with one transaction
    const txn1 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n)
    const txn2 = makePayTxn(SENDER.addr, RECEIVER.addr, 2000n)
    algosdk.assignGroupID([txn1, txn2])

    // Create wallet txns from the grouped originals
    const wt1 = txnToWalletTxn(txn1)

    // Make a different txn but give it the same group ID bytes to simulate mismatch
    const txn3 = makePayTxn(SENDER.addr, RECEIVER.addr, 9999n)
    txn3.group = txn2.group // copy the group ID but txn3 is different from txn2
    const wt2 = txnToWalletTxn(txn3)

    const lt = new LuteTxns([wt1, wt2])
    await lt.validateGroup()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Invalid Group')
  })

  it('sets groupWarn when multiple groups are present', async () => {
    // Two separate groups
    const txn1 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n)
    const txn2 = makePayTxn(SENDER.addr, RECEIVER.addr, 2000n)
    algosdk.assignGroupID([txn1, txn2])

    const txn3 = makePayTxn(SENDER.addr, RECEIVER.addr, 3000n)
    const txn4 = makePayTxn(SENDER.addr, RECEIVER.addr, 4000n)
    algosdk.assignGroupID([txn3, txn4])

    const lt = new LuteTxns([
      txnToWalletTxn(txn1),
      txnToWalletTxn(txn2),
      txnToWalletTxn(txn3),
      txnToWalletTxn(txn4),
    ])
    await lt.validateGroup()

    expect(lt.groupWarn).toBe(true)
    expect(capturedMessages).toHaveLength(0) // valid groups, just multiple
  })

  it('sets groupWarn for ungrouped transactions in a batch', async () => {
    // Multiple ungrouped txns — each becomes its own "group"
    const txn1 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n)
    const txn2 = makePayTxn(SENDER.addr, RECEIVER.addr, 2000n)
    // Don't assign group IDs
    const lt = new LuteTxns([txnToWalletTxn(txn1), txnToWalletTxn(txn2)])
    await lt.validateGroup()

    expect(lt.groupWarn).toBe(true)
  })

  it('sends error for >512 transactions', async () => {
    const txns: WalletTransaction[] = Array.from({ length: 513 }, () =>
      txnToWalletTxn(makePayTxn()),
    )
    const lt = new LuteTxns(txns)
    await lt.validateGroup()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4201)
    expect(capturedMessages[0].message).toBe('Too Many Transactions')
  })
})

describe('LuteTxns.handleError', () => {
  it('sends error message with code and message', async () => {
    const lt = new LuteTxns([txnToWalletTxn(makePayTxn())])
    await lt.handleError(new Error('Test Error', { cause: 4300 }))

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0]).toEqual({
      action: 'error',
      code: 4300,
      message: 'Test Error',
      debug: false,
    })
  })

  it('handles errors without a cause code', async () => {
    const lt = new LuteTxns([txnToWalletTxn(makePayTxn())])
    await lt.handleError(new Error('Something broke'))

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBeUndefined()
    expect(capturedMessages[0].message).toBe('Something broke')
  })
})

describe('LuteTxns.sign validation', () => {
  it('rejects msig transactions with code 4200', async () => {
    const txn = makePayTxn()
    const wt = txnToWalletTxn(txn, {
      msig: { version: 1, threshold: 2, addrs: [SENDER.addr.toString()] },
    })
    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4200)
    expect(capturedMessages[0].message).toBe('Msig not supported')
  })

  it('rejects already-signed transaction with signers set', async () => {
    const txn = makePayTxn()
    const stxn = algosdk.signTransaction(txn, SENDER.sk)
    const wt = txnToWalletTxn(txn, {
      stxn: Buffer.from(stxn.blob).toString('base64'),
      signers: [SENDER.addr.toString()],
    })
    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Transaction already signed')
  })

  it('passes through stxn when signers is empty (reference txn)', async () => {
    const txn = makePayTxn()
    const stxn = algosdk.signTransaction(txn, SENDER.sk)
    const stxnB64 = Buffer.from(stxn.blob).toString('base64')
    const wt = txnToWalletTxn(txn, {
      stxn: stxnB64,
      signers: [],
    })

    vi.mocked(signer).mockResolvedValue([])

    const lt = new LuteTxns([wt])
    await lt.sign()

    // Should succeed (stxn passed through, no error)
    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].action).toBe('signed')
  })

  it('returns null for empty signers without stxn', async () => {
    const txn = makePayTxn()
    const wt = txnToWalletTxn(txn, { signers: [] })

    vi.mocked(signer).mockResolvedValue([])

    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].action).toBe('signed')
    expect(capturedMessages[0].txns[0]).toBeNull()
  })

  it('rejects signer/authAddr mismatch', async () => {
    const other = algosdk.generateAccount()
    const txn = makePayTxn()
    const wt = txnToWalletTxn(txn, {
      signers: [other.addr.toString()],
      authAddr: SENDER.addr.toString(),
    })
    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Signer/AuthAddr Mismatch')
  })

  it('rejects signer/from mismatch', async () => {
    const other = algosdk.generateAccount()
    const txn = makePayTxn()
    const wt = txnToWalletTxn(txn, {
      signers: [other.addr.toString()],
    })
    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Signer/From Mismatch')
  })

  it('rejects multiple signers without msig', async () => {
    const other1 = algosdk.generateAccount()
    const other2 = algosdk.generateAccount()
    const txn = makePayTxn()
    const wt = txnToWalletTxn(txn, {
      signers: [other1.addr.toString(), other2.addr.toString()],
    })
    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Msig missing')
  })

  it('rejects stxn/txn mismatch for reference transactions', async () => {
    const txn = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n)
    // Sign a DIFFERENT transaction
    const differentTxn = makePayTxn(SENDER.addr, RECEIVER.addr, 9999n)
    const stxn = algosdk.signTransaction(differentTxn, SENDER.sk)
    const wt = txnToWalletTxn(txn, {
      stxn: Buffer.from(stxn.blob).toString('base64'),
      signers: [],
    })

    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].code).toBe(4300)
    expect(capturedMessages[0].message).toBe('Signed Transaction Mismatch')
  })

  it('signs a valid transaction and returns signed result', async () => {
    const txn = makePayTxn()
    const stxn = algosdk.signTransaction(txn, SENDER.sk)
    const wt = txnToWalletTxn(txn, {
      signers: [SENDER.addr.toString()],
    })

    vi.mocked(signer).mockResolvedValue([stxn.blob])

    const lt = new LuteTxns([wt])
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].action).toBe('signed')
    expect(capturedMessages[0].txns).toHaveLength(1)
  })

  it('handles mixed signable and reference transactions', async () => {
    const txn1 = makePayTxn(SENDER.addr, RECEIVER.addr, 1000n)
    const txn2 = makePayTxn(SENDER.addr, RECEIVER.addr, 2000n)

    // txn2 is a reference txn (empty signers + stxn)
    const stxn2 = algosdk.signTransaction(txn2, SENDER.sk)

    const walletTxns: WalletTransaction[] = [
      txnToWalletTxn(txn1, { signers: [SENDER.addr.toString()] }),
      txnToWalletTxn(txn2, {
        stxn: Buffer.from(stxn2.blob).toString('base64'),
        signers: [],
      }),
    ]

    const stxn1 = algosdk.signTransaction(txn1, SENDER.sk)
    vi.mocked(signer).mockResolvedValue([stxn1.blob])

    const lt = new LuteTxns(walletTxns)
    await lt.sign()

    expect(capturedMessages).toHaveLength(1)
    expect(capturedMessages[0].action).toBe('signed')
    expect(capturedMessages[0].txns).toHaveLength(2)
    // First txn should be signed, second should be the reference stxn
    expect(capturedMessages[0].txns[0]).not.toBeNull()
    expect(capturedMessages[0].txns[1]).not.toBeNull()
  })
})
