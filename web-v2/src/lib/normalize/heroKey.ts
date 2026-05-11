// Ports src/internal/Common.ps1:57 ConvertTo-OwReportHeroKey + ConvertTo-OwReportPrettyHeroName.

const SPECIAL_CASES: Record<string, string> = {
  'd.va': 'dva',
  'd va': 'dva',
  'soldier 76': 'soldier-76',
  'soldier: 76': 'soldier-76',
  'junker queen': 'junker-queen',
  'wrecking ball': 'wrecking-ball',
};

const PRETTY_OVERRIDES: Record<string, string> = {
  dva: 'D.Va',
  'soldier-76': 'Soldier: 76',
  'junker-queen': 'Junker Queen',
  'wrecking-ball': 'Wrecking Ball',
  'lucio': 'Lúcio',
  'torbjorn': 'Torbjörn',
};

export function heroKey(input: string | null | undefined): string | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;
  const direct = SPECIAL_CASES[normalized];
  if (direct) return direct;
  const slug = normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || null;
}

export function prettyHeroName(key: string | null | undefined): string {
  if (!key) return 'Unknown';
  const override = PRETTY_OVERRIDES[key];
  if (override) return override;
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
