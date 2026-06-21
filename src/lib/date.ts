const DAYS = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
] as const;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

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
    hrs = hrs ? hrs : 12;
    return `${hrs}:${mins}:${secs} ${ampm}`;
  }
}

const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatClock(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const suf = h >= 12 ? "PM" : "AM";
  h = h % 12;
  h = h ? h : 12;
  return m === 0 ? `${h} ${suf}` : `${h}:${String(m).padStart(2, "0")} ${suf}`;
}

export function describeTime(ms: number, nowMs: number = Date.now()): string {
  const d = new Date(ms);
  const now = new Date(nowMs);
  const clock = formatClock(d);

  const startOfDay = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c.getTime();
  };
  const dayDiff = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);

  if (dayDiff <= 0) return `today at ${clock}`;
  if (dayDiff === 1) return `tomorrow at ${clock}`;
  if (dayDiff < 7) return `${WEEKDAYS_LONG[d.getDay()]} at ${clock}`;

  const sameYear = d.getFullYear() === now.getFullYear();
  const base = `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  return sameYear
    ? `on ${base} at ${clock}`
    : `on ${base}, ${d.getFullYear()} at ${clock}`;
}

export function formatExactDate(ms: number): string {
  const d = new Date(ms);
  const month = MONTHS_SHORT[d.getMonth()].toLowerCase();

  const date = d.getDate();
  const suffix = date % 10 === 1 && date !== 11 ? "st" :
                 date % 10 === 2 && date !== 12 ? "nd" :
                 date % 10 === 3 && date !== 13 ? "rd" : "th";

  const year = d.getFullYear();
  const clock = formatClock(d).toLowerCase();

  return `${month} ${date}${suffix}, ${year} at ${clock}`;
}
