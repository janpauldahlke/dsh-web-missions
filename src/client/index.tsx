/**
 * Browser half of dsh-local-web-missions (M0: the Missions tab).
 *
 * Registers the "Missions" rightbar tab type (top level, not inside a React
 * effect — a missing top-level registration can stall boot) with a guide
 * capsule, and the keyed pane body under `sidebar.right.pane.tab`.
 *
 * Pane content (M0): heading + one-shot host ping (proves host ↔ UI loop) +
 * empty state. Inline styles only. Bundle is load-once, dispose-clean;
 * runtime imports are the platform baseline.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { TAB_ID, TAB_KIND, TAB_TITLE } from '../shared/types.ts'
import { MissionsBody } from './MissionsBody.tsx'
import { MissionsIcon } from './MissionsIcon.tsx'

export const name = 'dsh-local-web-missions'
export const inject = ['slots', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  const definition: SidebarRightTabDefinition = {
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => TAB_TITLE,
    guide: [{
      id: 'web-missions',
      order: 280,
      title: () => TAB_TITLE,
      description: () => 'Persist-and-find web research: missions on disk, cache hits, lexical find over stored pages',
      icon: MissionsIcon,
    }],
  }
  const disposeType = ctx.sidebarRightTabs.register(definition)
  const disposeBody = ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: TAB_ID },
    MissionsBody,
  ))
  ctx.effect(() => () => {
    disposeBody()
    disposeType()
  }, 'web-missions: rightbar tab type')
}
