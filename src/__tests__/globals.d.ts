/**
 * Type declarations for auto-imported globals used by the source code.
 *
 * In production, unplugin-auto-import generates these declarations at dev/build
 * time. This file provides them for the test TypeScript context so that source
 * files resolved through imports don't produce "Cannot find name" errors.
 */

declare function useAppStore(): any

declare const browser: {
  tabs: { sendMessage: (...args: any[]) => any }
  action: { setIcon: (...args: any[]) => any }
}

declare const __APP_VERSION__: string

// Vue single-file component module shim for transitively imported .vue files
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, any>
  export default component
}
