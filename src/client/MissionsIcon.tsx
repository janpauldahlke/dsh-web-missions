/**
 * The Missions pane's glyph (M0): a flag on a pole — a research mission.
 * Drawn on `currentColor` so the chip and the guide capsule pick their own ink.
 * Inline SVG only: no CSS pipeline, no icon-font, no image.
 */
import type { CSSProperties, ReactNode } from 'react'

export interface MissionsIconProps {
  /** Square edge in px (default 16, matching the chip's icon slot). */
  size?: number
  /** Extra class for layout placement. */
  className?: string
  style?: CSSProperties
}

export function MissionsIcon({ size = 16, className, style }: MissionsIconProps): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {/* pole */}
      <path d="M4 2V14" stroke="currentColor" strokeLinecap="round" />
      {/* flag */}
      <path
        d="M4 2.8C5.8 2 7.6 2 9 2.9C10.4 3.8 12.2 3.8 12.8 3.2V8.8C12.2 9.4 10.4 9.4 9 8.5C7.6 7.6 5.8 7.6 4 8.4Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      {/* ground */}
      <path d="M2.5 14H9" stroke="currentColor" strokeLinecap="round" />
    </svg>
  )
}
