// Ports src/internal/AnalyticsTeam.ps1:605 Get-OwReportWideGroupAssessment.
// Decides whether a lineup is a "Wide Group" per Blizzard's matchmaking rules:
// https://overwatch.blizzard.com/en-us/news/24061006/

export type WideGroupLabel = 'wide' | 'narrow' | 'unknown';

export interface WideGroupAssessment {
  label: WideGroupLabel;
  isWide: boolean | null;
  spreadDivisions: number | null;
  threshold: number | null;
  reason: string;
  sourceUrl: string;
}

const SOURCE_URL = 'https://overwatch.blizzard.com/en-us/news/24061006/';

function tierIndexFromOrdinal(ordinal: number): number {
  return Math.floor((ordinal - 1) / 5) + 1;
}

export function assessWideGroup(ordinals: ReadonlyArray<number | null | undefined>): WideGroupAssessment {
  if (!ordinals.length) {
    return {
      label: 'unknown',
      isWide: null,
      spreadDivisions: null,
      threshold: null,
      reason: 'No lineup selected yet.',
      sourceUrl: SOURCE_URL,
    };
  }
  const concrete = ordinals.filter((o): o is number => typeof o === 'number' && Number.isFinite(o));
  if (concrete.length !== ordinals.length) {
    return {
      label: 'unknown',
      isWide: null,
      spreadDivisions: null,
      threshold: null,
      reason: 'At least one player is unranked, so the Wide Group check is incomplete.',
      sourceUrl: SOURCE_URL,
    };
  }

  const maxOrdinal = Math.max(...concrete);
  const minOrdinal = Math.min(...concrete);
  const spreadDivisions = Math.round((maxOrdinal - minOrdinal) * 100) / 100;
  const highestTierIndex = tierIndexFromOrdinal(maxOrdinal);

  if (highestTierIndex >= 7) {
    return {
      label: 'wide',
      isWide: true,
      spreadDivisions,
      threshold: 0,
      reason: 'A Grandmaster or Champion role rank makes the lineup a Wide Group.',
      sourceUrl: SOURCE_URL,
    };
  }

  const threshold = highestTierIndex >= 6 ? 3 : 5;
  const isWide = spreadDivisions > threshold;
  const reason = highestTierIndex >= 6
    ? isWide
      ? 'A Masters-inclusive lineup spreads more than 3 skill divisions, so it is Wide.'
      : 'The Masters-inclusive lineup stays within 3 skill divisions, so it is Narrow.'
    : isWide
      ? 'The Diamond-or-lower lineup spreads more than 5 skill divisions, so it is Wide.'
      : 'The Diamond-or-lower lineup stays within 5 skill divisions, so it is Narrow.';

  return {
    label: isWide ? 'wide' : 'narrow',
    isWide,
    spreadDivisions,
    threshold,
    reason,
    sourceUrl: SOURCE_URL,
  };
}
