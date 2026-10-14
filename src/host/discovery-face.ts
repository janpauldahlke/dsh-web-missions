/**
 * Discovery companion face probe (R4.5).
 *
 * Honest on|off: `discovery_search` is registered on the tools face in this
 * process. Package presence alone is not enough (companion may be unlinked).
 */
import type { Context } from '@deepseek-ai/cordis'

export type DiscoveryFace = 'on' | 'off'

export function discoveryFace(ctx: Context | null | undefined): DiscoveryFace {
  try {
    const tools = (ctx as { tools?: { get?: (name: string) => unknown } } | null)?.tools
    if (tools && typeof tools.get === 'function' && tools.get('discovery_search')) {
      return 'on'
    }
  } catch {
    /* degrade to off */
  }
  return 'off'
}
