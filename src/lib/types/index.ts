export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

export const PHASE = {
  foundation: 1,
  dailyEntries: 2,
  bankImport: 3,
  salesPurchase: 4,
  consolidation: 5,
} as const;

export const FEATURE_PHASE: Record<string, number> = {
  masters: 1,
  openingBalances: 1,
  cashBook: 2,
  bankBook: 2,
  journals: 2,
  bankImport: 3,
  salesPurchase: 4,
  consolidation: 5,
  reportsCore: 2,
};

export const CURRENT_PHASE = PHASE.consolidation;
