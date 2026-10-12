/**
 * Ambient type shims for the harness host/client packages.
 *
 * Out-of-tree plugins reference harness types via type-only imports that only
 * resolve inside the real harness. Declaring a minimal surface here (pinned to
 * dsh 0.2.1-alpha.2, see ENV.md) lets `tsc --noEmit` type-check our own code;
 * esbuild erases these type imports at build time. Mirrors the dsh-memento
 * baseline.
 *
 * Hard rule: the built bundle may request only platform-baseline modules at
 * runtime. Harness VALUES must never be value-imported (unresolvable from an
 * out-of-tree install location); harness behavior that must be reproduced is
 * implemented locally.
 */
declare module '@deepseek-ai/cordis' {
  export interface SlotKey {
    name: string
    key?: string
    id?: string
    order?: number
  }
  export interface Logger {
    debug: (format: unknown, ...params: unknown[]) => void
    info: (format: unknown, ...params: unknown[]) => void
    warn: (format: unknown, ...params: unknown[]) => void
    error: (format: unknown, ...params: unknown[]) => void
  }
  export interface Context {
    slots: {
      inject: (name: string, factory: () => unknown) => () => void
      register: (key: SlotKey, render: unknown) => () => void
    }
    // Present on webServer-injected contexts (gpu-monitor pattern: the host
    // declares `inject: ['webServer']` and registers routes directly).
    webServer: {
      register: (route: import('@deepseek-ai/dsh-host-webserver').WebServerRoute) => () => void
    }
    sidebarRightTabs: {
      register: (def: import('@deepseek-ai/dsh-client-ui-sidebar-right/client').SidebarRightTabDefinition) => () => void
    }
    effect: (dispose: () => void, tag?: string) => void
    inject: (deps: string[], fn: (ctx: Context) => void) => void
    /**
     * Subscribe to a Cordis event. `options.global: true` receives the event
     * regardless of scope-carrier filter checks (harness invariant pattern).
     */
    on: (
      name: string,
      listener: (...args: any[]) => any,
      options?: boolean | { prepend?: boolean; global?: boolean },
    ) => () => void
    logger?: (name: string) => Logger
    [key: string]: unknown
  }
}

declare module '@deepseek-ai/dsh-host-webserver' {
  import type { IncomingMessage, ServerResponse } from 'node:http'
  export interface WebServerRoute {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }
}

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  export interface SidebarRightTabGuide {
    id: string
    order?: number
    title: () => string
    description?: () => string
    /** Optional glyph before the title; without one the guide draws its cube placeholder. */
    icon?: (props: { size?: number; className?: string }) => unknown
  }
  export interface SidebarRightTabDefinition {
    id: string
    kind: string
    multiple?: boolean
    keepMounted?: boolean
    patterns?: readonly string[]
    priority?: 'extension' | 'builtin' | 'fallback'
    canOpen?: (address: string) => boolean
    title: (address: string) => string
    guide?: SidebarRightTabGuide[]
  }
}

// Type-only: renderer client module (activated by the real harness).
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {
  export {}
}
