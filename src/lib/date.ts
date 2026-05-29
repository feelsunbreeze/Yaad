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

export function formatGreeting(d: Date = new Date(), name?: string): { lead: string; name?: string; tail: string } {
  const h = d.getHours();
  let base: string;
  if (h < 5) base = "still up";
  else if (h < 12) base = "good morning";
  else if (h < 17) base = "good afternoon";
  else if (h < 22) base = "good evening";
  else base = "winding down";

  const n = name ? name.toLowerCase() : undefined;
  const isStillUp = h < 5;
  const punc = isStillUp ? "?" : ",";
  const lead = n ? base : `${base}${punc}`;

  return { lead, name: n ? ` ${n}${punc}` : undefined, tail: "take it easy." };
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

export function formatTimeLive(d: Date = new Date(), format: string = "12h"): string {
  let hrs = d.getHours();
  const mins = String(d.getMinutes()).padStart(2, "0");
  const secs = String(d.getSeconds()).padStart(2, "0");
  if (format === "24h") {
    const hoursStr = String(hrs).padStart(2, "0");
    return `${hoursStr}:${mins}:${secs}`;
  } else {
    const ampm = hrs >= 12 ? "pm" : "am";
    hrs = hrs % 12;
    hrs = hrs ? hrs : 12; // hour '0' is '12'
    return `${hrs}:${mins}:${secs} ${ampm}`;
  }
}
