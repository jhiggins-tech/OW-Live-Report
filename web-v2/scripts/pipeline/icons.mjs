// The rank-insignia map: division name ('gold') -> badge image URL, and
// division number ('3') -> number-overlay image URL, written to
// snapshots/rank-icons.json. The URLs carry content hashes and older profiles
// use an older URL format, so they can't be derived from the names; they are
// captured from the OverFast responses instead (`rank_icon` and `tier_icon`)
// and the map keeps the one seen with the highest rank season. Pure: store.mjs
// reads and writes the file. In-memory entries are { url, season, at }, where
// `at` (the sample's fetchedAt) is not persisted.
//
// Naming quirk, as everywhere in the pipeline: in a rank, `division` is the
// tier NAME ('gold') and `tier` is the NUMBER (1-5).

export const RANK_ICONS_FILE = 'snapshots/rank-icons.json';
export const ICON_TIER_KEYS = ['1', '2', '3', '4', '5'];

export const isIconUrl = (v) => typeof v === 'string' && v.startsWith('https://');

export function emptyRankIcons() {
  return { divisions: new Map(), tiers: new Map() };
}

export const rankIconCount = (icons) => icons.divisions.size + icons.tiers.size;

// Higher season wins. On the same season the newer poll wins, and a poll's
// own conflict (same season, same `at`) goes to the larger URL, so the result
// never depends on the order players are ingested in. Entries loaded from disk
// have at = -Infinity: any new sighting of the same season replaces them.
function offer(map, key, url, season, at) {
  const cur = map.get(key);
  const wins = !cur
    || season > cur.season
    || (season === cur.season && (at > cur.at || (at === cur.at && url > cur.url)));
  if (wins) map.set(key, { url, season, at });
}

// `rank` is an extractSample ranks[] entry; `season` is the season the rank
// belongs to and `at` the sample's fetchedAt. Icons that are missing or not
// https URLs are ignored, as is a division outside the 1-5 numbering.
export function noteRankIcons(icons, rank, { season, at }) {
  if (!Number.isInteger(season)) return;
  const name = typeof rank.division === 'string' ? rank.division.trim().toLowerCase() : '';
  if (name && isIconUrl(rank.rankIcon)) offer(icons.divisions, name, rank.rankIcon, season, at);
  const number = String(rank.tier);
  if (ICON_TIER_KEYS.includes(number) && isIconUrl(rank.tierIcon)) offer(icons.tiers, number, rank.tierIcon, season, at);
}

// The on-disk object: keys in plain `<` order, entries as { url, season }.
export function rankIconsFile(icons, generatedAt) {
  const dump = (map) => Object.fromEntries(
    [...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, e]) => [key, { url: e.url, season: e.season }]),
  );
  return { generatedAt, divisions: dump(icons.divisions), tiers: dump(icons.tiers) };
}

// Pretty-printed like meta.json and state.json.
export function renderRankIcons(icons, generatedAt) {
  return `${JSON.stringify(rankIconsFile(icons, generatedAt), null, 2)}\n`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A parsed rank-icons.json -> the in-memory map. Throws on a file that is not
// shaped like one, so a bad file is never treated as empty and overwritten.
export function parseRankIcons(raw, path) {
  if (!isObject(raw) || !isObject(raw.divisions) || !isObject(raw.tiers)) {
    throw new Error(`Cannot read ${path}: expected "divisions" and "tiers" objects`);
  }
  const icons = emptyRankIcons();
  for (const kind of ['divisions', 'tiers']) {
    for (const [key, e] of Object.entries(raw[kind])) {
      if (!isObject(e) || typeof e.url !== 'string' || !Number.isInteger(e.season)) {
        throw new Error(`Cannot read ${path}: ${kind}.${key} is not { url, season }`);
      }
      icons[kind].set(key, { url: e.url, season: e.season, at: -Infinity });
    }
  }
  return icons;
}
