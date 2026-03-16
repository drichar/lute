import { vi } from 'vitest'

// Stub useAppStore as a global to mirror the auto-import behavior in production.
// Production code uses unplugin-auto-import which makes useAppStore available
// without explicit imports. Tests need this global stub to prevent ReferenceErrors.
vi.stubGlobal(
  'useAppStore',
  vi.fn(() => ({
    debug: false,
    isWeb: true,
    overlay: false,
    loading: 0,
    accounts: [],
    info: [],
    seeds: [],
    keys: [],
    nsObj: {},
    networkName: 'MainNet',
    hotWallet: true,
    fallback: false,
    snackbar: { text: '', color: '', timeout: 0, display: false },
    device: { transport: undefined, showSelector: false, list: [] },
    refresh: 0,
    acctInfo: [],
    allNetworks: [],
    setSnackbar: vi.fn(),
    getDevices: vi.fn(),
  })),
)

// Stub browser extension globals that some modules reference at import time
vi.stubGlobal('browser', {
  tabs: { sendMessage: vi.fn() },
  action: { setIcon: vi.fn() },
  sidePanel: { setOptions: vi.fn() },
})
