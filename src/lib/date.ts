/**
 * Tiny date helpers for the header and the completed-list time labels.
 * Output is lowercase on purpose — the CSS applies `text-transform: uppercase`
 * on `.date-pill`, but keeping the source lowercase matches the prototype.
 */

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

/**
 * "thursday, 29 may"
 */
export function formatDatePill(d: Date = new Date()): string {
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatGreeting(d: Date = new Date(), name?: string): { lead: string; tail: string } {
  const h = d.getHours();
  let lead: string;
  if (h < 5) lead = "still up,";
  else if (h < 12) lead = "good morning,";
  else if (h < 17) lead = "good afternoon,";
  else if (h < 22) lead = "good evening,";
  else lead = "winding down,";

  const n = name ? name.toLowerCase() : undefined;
  if (n) {
    if (lead.endsWith(",")) {
      lead = lead.slice(0, -1) + ` ${n},`;
    } else {
      lead = `${lead} ${n},`;
    }
  }

  return { lead, tail: "take it easy." };
}

/**
 * "resolved 2h ago" / "yesterday" — used by the completed tab's card meta row.
 * Returns "resolved" as a graceful default when completedAt is null.
 */
export function formatResolvedAgo(completedAt: number | null, now: number = Date.now()): string {
  if (completedAt === null) return "resolved";
  const diff = Math.max(0, now - completedAt);
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (days >= 2) return `resolved ${days} days ago`;
  if (days === 1) return "resolved yesterday";
  if (hrs >= 1)  return `resolved ${hrs}h ago`;
  return mins < 1 ? "resolved just now" : `resolved ${mins}m ago`;
}

/**
 * Live relative time countdown for the cards. E.g., "in 1h 2m 5s".
 */
export function formatRelativeLive(fireAtMs: number, nowMs: number = Date.now()): string {
  const diff = fireAtMs - nowMs;
  if (diff <= 0) return "due now";

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  if (minutes > 0) return `in ${minutes}m ${seconds}s`;
  return `in ${seconds}s`;
}
