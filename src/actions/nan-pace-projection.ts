/**
 * Consumption-pace projection for the monthly billing window (pure domain logic).
 *
 * Linear extrapolation at the current rate: rate = used / (now - periodStart).
 * Edge cases return `null` (no projection) rather than a misleading number:
 * no/zero cap, missing or invalid period bounds, end <= start, `now` outside the
 * period, negative usage, or less than MIN_ELAPSED_MS elapsed (too noisy).
 * Usage at or above the cap yields `capped`. Zero usage projects 0%.
 * Staleness is the caller's concern: stale data must not be projected.
 */
export const MIN_ELAPSED_MS = 6 * 3_600_000;

export interface NanPaceInput {
  readonly used: number;
  readonly cap: number;
  /** Date-only (YYYY-MM-DD, read as UTC midnight) or ISO timestamp. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly now: number;
}

export type NanPaceProjection =
  | { readonly kind: "cap-date"; readonly at: string }
  | { readonly kind: "period-end-percent"; readonly percent: number }
  | { readonly kind: "capped" };

export function projectMonthlyPace({ used, cap, periodStart, periodEnd, now }: NanPaceInput): NanPaceProjection | null {
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(used) || used < 0) return null;
  const start = parseTime(periodStart);
  const end = parseTime(periodEnd);
  if (start === null || end === null || end <= start || now < start || now >= end) return null;
  if (used >= cap) return { kind: "capped" };
  const elapsed = now - start;
  if (elapsed < MIN_ELAPSED_MS) return null;
  const rate = used / elapsed; // tokens per ms
  const capHit = rate > 0 ? start + cap / rate : Number.POSITIVE_INFINITY;
  if (capHit < end) return { kind: "cap-date", at: new Date(capHit).toISOString() };
  return { kind: "period-end-percent", percent: Math.round(rate * (end - start) / cap * 100) };
}

function parseTime(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}
