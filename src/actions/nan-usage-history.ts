import type { NanApiDailyUsageRow } from "../providers/nan/nan-api-usage-provider.js";

export interface NanDailyTotal {
  readonly date: string;
  readonly totalTokens: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * Per-day total tokens for one model over the last `days` UTC days ending today,
 * oldest first. Days without rows are zero-filled; rows for other models or
 * outside the window are ignored. Same-day rows are summed.
 */
export function dailyTotalsForModel(
  rows: readonly NanApiDailyUsageRow[],
  model: string,
  days: number,
  now: () => Date = () => new Date(),
): readonly NanDailyTotal[] {
  const today = utcDay(now());
  const startIndex = Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY_MS;
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.model !== model) continue;
    const day = Date.parse(`${row.date}T00:00:00Z`);
    if (!Number.isFinite(day) || day < startIndex || day > Date.parse(`${today}T00:00:00Z`)) continue;
    totals.set(row.date, (totals.get(row.date) ?? 0) + row.totalTokens);
  }
  return Array.from({ length: days }, (_, index) => {
    const date = utcDay(new Date(startIndex + index * DAY_MS));
    return Object.freeze({ date, totalTokens: totals.get(date) ?? 0 });
  });
}
