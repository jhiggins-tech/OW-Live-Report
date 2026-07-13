import { parseStatementSeries, runInfluxMultiQuery } from '../../../influxClient';
import { safeNumber } from '../../../normalize/kda';
import { buildPlayerRegex } from '../../_shared';
import { fetchSupportingStats } from '../../supportingStats';
import type { RosterPlayer } from '../../../../types/models';

export interface TeamStatCards {
  trackedPlayers: number;
  freshPlayers: number;
  teamKda: number | null;
  teamWinRate: number | null;
  teamAssistsPerDeath: number | null;
  teamHealingDone: number | null;
  teamHealingPer10Min: number | null;
  newestSeenAt: number | null;
}

export async function fetchTeamStatCards(players: RosterPlayer[]): Promise<TeamStatCards> {
  if (!players.length) {
    return {
      trackedPlayers: 0,
      freshPlayers: 0,
      teamKda: null,
      teamWinRate: null,
      teamAssistsPerDeath: null,
      teamHealingDone: null,
      teamHealingPer10Min: null,
      newestSeenAt: null,
    };
  }
  const regex = buildPlayerRegex(players);

  // last(username) is the cheapest way to recover the per-player row time
  // from player_summary (there is no last_updated_at field on the schema).
  const summaryQ = `SELECT last("username") AS u FROM "player_summary" WHERE "player" =~ /${regex}/ GROUP BY "player"`;

  const [[summary], supporting] = await Promise.all([
    runInfluxMultiQuery([summaryQ]),
    fetchSupportingStats(players.map((p) => p.playerId)),
  ]);

  const newestByPlayer = new Map<string, number>();
  let newestSeenAt: number | null = null;
  for (const s of parseStatementSeries<{ time: number; u: string | null }>(summary)) {
    const tag = s.tags.player ?? '';
    const seenAt = safeNumber(s.rows[0]?.time);
    if (seenAt !== null) {
      newestByPlayer.set(tag, seenAt);
      if (newestSeenAt === null || seenAt > newestSeenAt) newestSeenAt = seenAt;
    }
  }

  const kdas: number[] = [];
  const wrs: number[] = [];
  for (const p of players) {
    const stats = supporting.get(p.playerId);
    if (stats?.kda !== null && stats?.kda !== undefined) kdas.push(stats.kda);
    if (stats?.winRate !== null && stats?.winRate !== undefined) wrs.push(stats.winRate);
  }

  // Assists/death and heal-rate average across players; healing done is a
  // team total since per-player career totals are meaningful to sum.
  const apds: number[] = [];
  const heal10s: number[] = [];
  let healingDoneTotal = 0;
  let healingDoneSeen = false;
  for (const p of players) {
    const s = supporting.get(p.playerId);
    if (!s) continue;
    if (s.assistsPerDeath !== null) apds.push(s.assistsPerDeath);
    if (s.healingPer10Min !== null) heal10s.push(s.healingPer10Min);
    if (s.healingDone !== null) {
      healingDoneTotal += s.healingDone;
      healingDoneSeen = true;
    }
  }

  const freshCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let freshPlayers = 0;
  for (const p of players) {
    const seenAt = newestByPlayer.get(p.playerId);
    if (seenAt !== undefined && seenAt >= freshCutoff) freshPlayers += 1;
  }

  return {
    trackedPlayers: players.length,
    freshPlayers,
    teamKda: kdas.length ? kdas.reduce((a, b) => a + b, 0) / kdas.length : null,
    teamWinRate: wrs.length ? wrs.reduce((a, b) => a + b, 0) / wrs.length : null,
    teamAssistsPerDeath: apds.length ? apds.reduce((a, b) => a + b, 0) / apds.length : null,
    teamHealingDone: healingDoneSeen ? healingDoneTotal : null,
    teamHealingPer10Min: heal10s.length ? heal10s.reduce((a, b) => a + b, 0) / heal10s.length : null,
    newestSeenAt,
  };
}
