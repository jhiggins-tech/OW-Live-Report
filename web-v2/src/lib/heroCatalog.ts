// Ported from src/internal/Provider.ps1:248 Get-OwReportFallbackHeroCatalog.
// Static fallback used until V2.1 wires up the OverFast /heroes API.
// Heroes appearing in the DB but not yet in this map fall back to 'unknown';
// adding them here is a one-line change.

import type { Role } from '../types/models';

export type HeroRole = Role | 'unknown';

export interface HeroCatalogEntry {
  name: string;
  role: HeroRole;
}

export const HERO_CATALOG: Record<string, HeroCatalogEntry> = {
  // Tank
  doomfist: { name: 'Doomfist', role: 'tank' },
  dva: { name: 'D.Va', role: 'tank' },
  hazard: { name: 'Hazard', role: 'tank' },
  'junker-queen': { name: 'Junker Queen', role: 'tank' },
  mauga: { name: 'Mauga', role: 'tank' },
  orisa: { name: 'Orisa', role: 'tank' },
  ramattra: { name: 'Ramattra', role: 'tank' },
  reinhardt: { name: 'Reinhardt', role: 'tank' },
  roadhog: { name: 'Roadhog', role: 'tank' },
  sigma: { name: 'Sigma', role: 'tank' },
  winston: { name: 'Winston', role: 'tank' },
  'wrecking-ball': { name: 'Wrecking Ball', role: 'tank' },
  zarya: { name: 'Zarya', role: 'tank' },

  // Damage
  ashe: { name: 'Ashe', role: 'damage' },
  bastion: { name: 'Bastion', role: 'damage' },
  cassidy: { name: 'Cassidy', role: 'damage' },
  echo: { name: 'Echo', role: 'damage' },
  freja: { name: 'Freja', role: 'damage' },
  genji: { name: 'Genji', role: 'damage' },
  hanzo: { name: 'Hanzo', role: 'damage' },
  junkrat: { name: 'Junkrat', role: 'damage' },
  mei: { name: 'Mei', role: 'damage' },
  pharah: { name: 'Pharah', role: 'damage' },
  reaper: { name: 'Reaper', role: 'damage' },
  sojourn: { name: 'Sojourn', role: 'damage' },
  'soldier-76': { name: 'Soldier: 76', role: 'damage' },
  sombra: { name: 'Sombra', role: 'damage' },
  symmetra: { name: 'Symmetra', role: 'damage' },
  torbjorn: { name: 'Torbjörn', role: 'damage' },
  tracer: { name: 'Tracer', role: 'damage' },
  venture: { name: 'Venture', role: 'damage' },
  widowmaker: { name: 'Widowmaker', role: 'damage' },

  // Support
  ana: { name: 'Ana', role: 'support' },
  baptiste: { name: 'Baptiste', role: 'support' },
  brigitte: { name: 'Brigitte', role: 'support' },
  illari: { name: 'Illari', role: 'support' },
  'jetpack-cat': { name: 'Jetpack Cat', role: 'support' },
  juno: { name: 'Juno', role: 'support' },
  kiriko: { name: 'Kiriko', role: 'support' },
  lifeweaver: { name: 'Lifeweaver', role: 'support' },
  lucio: { name: 'Lúcio', role: 'support' },
  mercy: { name: 'Mercy', role: 'support' },
  mizuki: { name: 'Mizuki', role: 'support' },
  moira: { name: 'Moira', role: 'support' },
  wuyang: { name: 'Wuyang', role: 'support' },
  zenyatta: { name: 'Zenyatta', role: 'support' },
};

export function heroRole(key: string | null | undefined): HeroRole {
  if (!key) return 'unknown';
  return HERO_CATALOG[key]?.role ?? 'unknown';
}

export function heroPretty(key: string | null | undefined): string {
  if (!key) return 'Unknown';
  const entry = HERO_CATALOG[key];
  if (entry) return entry.name;
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
