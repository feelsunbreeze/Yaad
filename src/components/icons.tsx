/**
 * SVG icons, copied verbatim from the HTML prototype.
 *
 * The icons take no props on purpose — their size and stroke colour are
 * inherited from the parent container via CSS (`.icon-btn svg`, `.empty-icon
 * svg`, `.check-wrap svg`, `.meta-time svg`, `.add-btn svg`). Keeping them
 * dumb means the design system stays in App.css, not scattered across TSX.
 */

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function SmileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2z" />
      <path d="M8 12s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  );
}

/**
 * Checkmark, drawn left-to-right.
 *
 * The polyline points are ordered intentionally: (4,12) is the left tip,
 * (9,17) is the apex (bottom of the V), (20,6) is the upper-right tail.
 * SVG draws the path in declared order, so when we animate
 * stroke-dashoffset on `.reminder-card.completing .check-wrap svg`, the
 * stroke starts at the left tip, sweeps DOWN through the apex, then UP to
 * the right tail — the natural sweep of a pen drawing a ✓.
 *
 * Reversing this back to "20 6 9 17 4 12" would draw from the right tail
 * inward, which reads as mechanical / backwards.
 */
export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="4 12 9 17 20 6" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/**
 * Tiny hourglass sort icon — two small triangles (⏳-ish) that evoke
 * "reorder by time". The top triangle points up (soonest), the bottom
 * points down (latest). During the flip animation CSS rotates the whole
 * SVG 180° so the triangles swap, giving visual feedback on sort direction.
 */
export function SortTimeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {/* top triangle — points up */}
      <polygon points="4,6 12,6 8,2" />
      {/* bottom triangle — points down */}
      <polygon points="4,10 12,10 8,14" />
      {/* connecting waist */}
      <line x1="8" y1="6" x2="8" y2="10" />
    </svg>
  );
}

/**
 * Cute pencil icon for the reschedule button. Compact, warm, minimal.
 */
export function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}
