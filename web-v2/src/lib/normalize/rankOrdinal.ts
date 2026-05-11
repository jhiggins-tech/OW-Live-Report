// Ports src/internal/AnalyticsCore.ps1:62 ConvertTo-RankOrdinal + ConvertFrom-RankOrdinal.
// Ordinal range: 1 (Bronze 5) .. 40 (Champion 1).

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

export function rankOrdinal(tier: string | null | undefined, division: number | string | null | undefined): number | null {
  if (!tier) return null;
  const normalizedTier = String(tier).trim().toLowerCase();
  const tierIdx = TIER_INDEX[normalizedTier];
  if (!tierIdx) return null;
  const divNum = (() => {
    if (division === null || division === undefined || division === '') return 3;
    const n = typeof division === 'number' ? division : parseInt(String(division), 10);
    if (Number.isNaN(n)) return 3;
    return Math.max(1, Math.min(5, n));
  })();
  return (tierIdx - 1) * 5 + (6 - divNum);
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
