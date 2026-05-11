// Ports src/internal/AnalyticsCore.ps1:62 ConvertTo-RankOrdinal + ConvertFrom-RankOrdinal.
// Ordinal range: 1 (Bronze 5) .. 40 (Champion 1).
//
// Important: the InfluxDB schema labels these counterintuitively:
//   - `tier` (float)  actually carries the division NUMBER (1..5)
//   - `division` (string) actually carries the tier NAME (silver, gold, ...)
// Inputs may also arrive in the natural order from other sources, so we
// resolve which is which by type, matching V1's Resolve-OwReportRankParts.

const TIER_INDEX: Record<string, number> = {
  bronze: 1,
  silver: 2,
  gold: 3,
  platinum: 4,
  diamond: 5,
  master: 6,
  grandmaster: 7,
  champion: 8,
};

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Master', 'Grandmaster', 'Champion'];

type RawRankPart = string | number | null | undefined;

function resolveParts(a: RawRankPart, b: RawRankPart): { tierName: string | null; divisionNumber: number | null } {
  let tierName: string | null = null;
  let divisionNumber: number | null = null;

  const consider = (v: RawRankPart): void => {
    if (v === null || v === undefined || v === '') return;
    if (typeof v === 'number') {
      if (divisionNumber === null && Number.isFinite(v)) divisionNumber = Math.trunc(v);
      return;
    }
    const s = String(v).trim();
    if (!s) return;
    const asNum = Number(s);
    if (!Number.isNaN(asNum) && Number.isFinite(asNum) && /^-?\d+(?:\.\d+)?$/.test(s)) {
      if (divisionNumber === null) divisionNumber = Math.trunc(asNum);
      return;
    }
    if (tierName === null) tierName = s.toLowerCase();
  };

  consider(a);
  consider(b);
  return { tierName, divisionNumber };
}

export function rankOrdinal(a: RawRankPart, b: RawRankPart): number | null {
  const { tierName, divisionNumber } = resolveParts(a, b);
  if (!tierName) return null;
  const tierIdx = TIER_INDEX[tierName];
  if (!tierIdx) return null;
  const div = (() => {
    if (divisionNumber === null) return 3;
    return Math.max(1, Math.min(5, divisionNumber));
  })();
  return (tierIdx - 1) * 5 + (6 - div);
}

export function rankLabelFromOrdinal(ordinal: number | null | undefined): string {
  if (ordinal === null || ordinal === undefined || ordinal < 1) return 'Unranked';
  const rounded = Math.round(ordinal);
  const tierIndex = Math.min(TIERS.length - 1, Math.floor((rounded - 1) / 5));
  const tierName = TIERS[tierIndex];
  if (!tierName) return 'Unranked';
  const division = 6 - (((rounded - 1) % 5) + 1);
  return `${tierName} ${division}`;
}
