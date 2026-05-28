/**
 * Tiny date helpers for the header. Output is lowercase on purpose — the CSS
 * applies `text-transform: uppercase` on `.date-pill`, but keeping the source
 * lowercase matches the prototype and is friendlier to copy-paste.
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

/**
 * Time-of-day appropriate greeting. The prototype's example was
 * "good morning, take it easy." so the morning branch keeps that exact text.
 *
 * Returned object splits the leading phrase from the italic tail — the header
 * renders them in different colours via the `<em>` element.
 */
export function formatGreeting(d: Date = new Date()): { lead: string; tail: string } {
  const h = d.getHours();
  let lead: string;
  if (h < 5) lead = "still up,";
  else if (h < 12) lead = "good morning,";
  else if (h < 17) lead = "good afternoon,";
  else if (h < 22) lead = "good evening,";
  else lead = "winding down,";

  return { lead, tail: "take it easy." };
}
