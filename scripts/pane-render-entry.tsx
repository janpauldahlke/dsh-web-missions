/**
 * Render entry for the M6 pane smoke (bundled by scripts/smoke-m6-pane.mjs):
 * SSR-renders the presentational Board/Detail components against fixture
 * payloads — the mechanical half of V1/V2/V6 (badges, ages, budget line,
 * hint condition, stop button presence) without a browser.
 *
 * `renderDetail` computes the hint exactly the way the hook layer does
 * (sessionHint on the payload), so the wiring itself is under test.
 */
import { renderToString } from 'react-dom/server'
import type { ListPayload, StatusPayload } from '../src/shared/types.ts'
import { Board, Detail, Hygiene } from '../src/client/MissionsBody.tsx'
import { sessionHint } from '../src/client/paneModel.ts'

export function renderBoard(list: ListPayload | null): string {
  return renderToString(<Board list={list} onOpen={() => {}} onMarkDone={() => {}} />)
}

export function renderHygiene(clearNote: string | null, clearArmed: boolean): string {
  return renderToString(
    <Hygiene clearNote={clearNote} clearArmed={clearArmed} onClearRecents={() => {}} onClearAll={() => {}} />,
  )
}

export function renderDetail(missionId: string, detail: StatusPayload | null): string {
  const hint = detail ? sessionHint(detail.visited) : null
  return renderToString(
    <Detail
      missionId={missionId}
      detail={detail}
      error={null}
      hint={hint}
      stopping={false}
      onBack={() => {}}
      onMarkDone={() => {}}
    />,
  )
}
