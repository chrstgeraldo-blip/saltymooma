/**
 * Local-timezone date helpers.
 *
 * The API speaks YYYY-MM-DD and means a *calendar* day. `Date#toISOString()`
 * converts to UTC first, so at UTC+7 it reports the previous day for anything
 * before 07:00 local — including midnight, which is exactly what
 * "start of month" is. Every conversion here stays in local time.
 */

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses YYYY-MM-DD as a local date. `new Date(str)` would parse it as UTC. */
export function parseISODate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(iso: string, delta: number): string {
  const d = parseISODate(iso) ?? new Date();
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Monday-first week start. */
export function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return s;
}

/** "2 Sep 2026" */
export function formatHuman(iso: string): string {
  const d = parseISODate(iso);
  return d
    ? d.toLocaleDateString("en-ID", { day: "numeric", month: "short", year: "numeric" })
    : iso;
}
