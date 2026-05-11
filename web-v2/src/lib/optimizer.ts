// Ports src/internal/AnalyticsTeam.ps1:505 Get-OwReportTeamRoleOption and
// AnalyticsTeam.ps1:680 Search-OwReportBestTeamComposition. Picks 1 tank /
// 2 damage / 2 support from a roster, optionally honouring role locks,
// scoring each option with V1's weighted composite and breaking ties on
// wide-group penalty then total score then winrate.

import { assessWideGroup, type WideGroupAssessment } from './wideMatch';
import type { Role, RosterPlayer } from '../types/models';
import type { PlayerOptimizerData, PlayerRoleStats } from './queries/optimizerData';

const ROLES: readonly Role[] = ['tank', 'damage', 'support'];

export const NEEDED_COUNTS: Record<Role, number> = { tank: 1, damage: 2, support: 2 };

export interface RoleOption {
  role: Role;
  eligible: boolean;
  score: number;
  kda: number;
  winRate: number;
  gamesPlayed: number;
  timePlayedSeconds: number;
  rankLabel: string;
  rankOrdinal: number | null;
  explanation: string;
}

export interface OptimizerCandidate {
  player: RosterPlayer;
  trendLabel: 'up' | 'flat' | 'down' | null;
  roleOptions: Record<Role, RoleOption>;
}

export interface LineupAssignment {
  player: RosterPlayer;
  role: Role;
  option: RoleOption;
  locked: boolean;
}

export interface LineupResult {
  assignments: LineupAssignment[];
  totalScore: number;
  teamKda: number;
  teamWinRate: number;
  wideAssessment: WideGroupAssessment;
}

export interface OptimizerWarning {
  message: string;
}

export interface OptimizerOutput {
  lineup: LineupResult | null;
  warnings: OptimizerWarning[];
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function average(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function buildRoleOption(
  stats: PlayerRoleStats,
  preferredRole: Role | null,
  trendLabel: 'up' | 'flat' | 'down' | null,
  lockedRole: Role | null,
): RoleOption {
  const games = stats.gamesPlayed;
  const time = stats.timePlayedSeconds;
  const kda = stats.kda ?? 0;
  const winRate = stats.winRate ?? 0;
  const ord = stats.rankOrdinal;
  const rankLabel = stats.rankLabel;
  const eligible = games > 0 || time > 0 || ord !== null;

  if (!eligible) {
    return {
      role: stats.role,
      eligible: false,
      score: 0,
      kda: 0,
      winRate: 0,
      gamesPlayed: 0,
      timePlayedSeconds: 0,
      rankLabel: 'Unranked',
      rankOrdinal: null,
      explanation: 'No visible competitive sample on this role yet.',
    };
  }

  const sampleNorm = clamp01(Math.max(games / 25, time / 7200));
  const kdaNorm = clamp01((kda - 1.0) / 2.5);
  const winNorm = clamp01((winRate - 45) / 20);
  const rankNorm = ord !== null ? clamp01((ord - 1) / 39) : 0.2;
  const trendNorm = trendLabel === 'up' ? 1.0 : trendLabel === 'flat' ? 0.6 : 0.35;

  let roleFitBonus = 0;
  if (preferredRole === stats.role) roleFitBonus += 0.06;
  if (lockedRole === stats.role) roleFitBonus += 0.08;

  const score = (
    kdaNorm * 0.34
    + winNorm * 0.24
    + sampleNorm * 0.18
    + rankNorm * 0.18
    + trendNorm * 0.06
    + roleFitBonus
  );

  const parts: string[] = [];
  if (games > 0) parts.push(`${games} games`);
  if (ord !== null) parts.push(`rank ${rankLabel}`);
  if (kda > 0) parts.push(`${kda.toFixed(2)} KDA`);

  return {
    role: stats.role,
    eligible: true,
    score: Number(score.toFixed(3)),
    kda,
    winRate,
    gamesPlayed: games,
    timePlayedSeconds: time,
    rankLabel,
    rankOrdinal: ord,
    explanation: parts.join(' · '),
  };
}

export function buildCandidates(
  data: PlayerOptimizerData[],
  trendLabelByPlayerId: Record<string, 'up' | 'flat' | 'down'> = {},
): OptimizerCandidate[] {
  return data.map((d) => {
    const trendLabel = trendLabelByPlayerId[d.player.playerId] ?? null;
    return {
      player: d.player,
      trendLabel,
      roleOptions: {
        tank: buildRoleOption(d.byRole.tank, d.bestRole, trendLabel, d.player.lockedRole ?? null),
        damage: buildRoleOption(d.byRole.damage, d.bestRole, trendLabel, d.player.lockedRole ?? null),
        support: buildRoleOption(d.byRole.support, d.bestRole, trendLabel, d.player.lockedRole ?? null),
      },
    };
  });
}

function widePenalty(label: WideGroupAssessment['label']): number {
  return label === 'narrow' ? 0 : label === 'unknown' ? 1 : 2;
}

function search(
  candidates: OptimizerCandidate[],
  needed: Record<Role, number>,
  used: Set<string>,
  current: LineupAssignment[],
  best: { value: LineupResult | null },
): void {
  if (needed.tank + needed.damage + needed.support === 0) {
    const assignments = [...current].sort((a, b) => {
      if (a.role !== b.role) return ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
      if (b.option.score !== a.option.score) return b.option.score - a.option.score;
      return a.player.display.localeCompare(b.player.display);
    });
    const totalScore = Number(assignments.reduce((a, b) => a + b.option.score, 0).toFixed(3));
    const teamKda = Number(average(assignments.map((a) => a.option.kda)).toFixed(2));
    const teamWinRate = Number(average(assignments.map((a) => a.option.winRate)).toFixed(2));
    const ordinals = assignments.map((a) => a.option.rankOrdinal);
    const wide = assessWideGroup(ordinals);

    if (!best.value) {
      best.value = { assignments, totalScore, teamKda, teamWinRate, wideAssessment: wide };
      return;
    }

    const bestPen = widePenalty(best.value.wideAssessment.label);
    const curPen = widePenalty(wide.label);
    if (curPen < bestPen
      || (curPen === bestPen && totalScore > best.value.totalScore)
      || (curPen === bestPen && totalScore === best.value.totalScore && teamWinRate > best.value.teamWinRate)) {
      best.value = { assignments, totalScore, teamKda, teamWinRate, wideAssessment: wide };
    }
    return;
  }

  const nextRole: Role = needed.tank > 0 ? 'tank' : needed.damage > 0 ? 'damage' : 'support';

  for (const candidate of candidates) {
    if (used.has(candidate.player.slug)) continue;
    const option = candidate.roleOptions[nextRole];
    if (!option.eligible) continue;

    const nextNeeded = { ...needed, [nextRole]: needed[nextRole] - 1 };
    used.add(candidate.player.slug);
    current.push({ player: candidate.player, role: nextRole, option, locked: candidate.player.lockedRole === nextRole });
    search(candidates, nextNeeded, used, current, best);
    current.pop();
    used.delete(candidate.player.slug);
  }
}

export function optimizeLineup(
  candidates: OptimizerCandidate[],
  options?: { roleLocks?: Record<string, Role | null> },
): OptimizerOutput {
  const warnings: OptimizerWarning[] = [];
  const used = new Set<string>();
  const current: LineupAssignment[] = [];
  const needed = { ...NEEDED_COUNTS };
  const locks = options?.roleLocks ?? {};

  // Honour per-candidate user-set locks first, then admin lockedRole, in order.
  for (const candidate of candidates) {
    const explicit = locks[candidate.player.slug];
    const lockedRole: Role | null = explicit ?? candidate.player.lockedRole ?? null;
    if (!lockedRole) continue;
    if (needed[lockedRole] <= 0) {
      warnings.push({ message: `Skipped ${candidate.player.display}'s ${lockedRole} lock — that role is already filled.` });
      continue;
    }
    const option = candidate.roleOptions[lockedRole];
    if (!option.eligible) {
      warnings.push({ message: `Skipped ${candidate.player.display}'s ${lockedRole} lock — no visible competitive data for that role yet.` });
      continue;
    }
    used.add(candidate.player.slug);
    needed[lockedRole] -= 1;
    current.push({ player: candidate.player, role: lockedRole, option, locked: true });
  }

  const best: { value: LineupResult | null } = { value: null };
  search(candidates, needed, used, current, best);

  if (!best.value) {
    warnings.push({ message: 'Could not find five eligible players across all three roles.' });
  }

  return { lineup: best.value, warnings };
}
