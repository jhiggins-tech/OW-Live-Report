import { useState } from 'react';
import type { RankIconMaps } from '../types/snapshots';

// Tier names with a tint token (--rank-<name> in theme/tokens.css).
const TINTED = new Set([
  'bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster', 'champion',
]);

const urlFor = (map: Record<string, string> | undefined, key: string): string | null => {
  const url = map?.[key];
  return typeof url === 'string' ? url : null;
};

// The division number, clamped (and defaulted to 3) the way rankOrdinal does,
// so the badge always agrees with the text label next to it.
function divisionNumber(tier: number | null): number {
  return tier !== null && Number.isFinite(tier) ? Math.max(1, Math.min(5, Math.trunc(tier))) : 3;
}

interface Props {
  // The rank row's raw values: `division` is the tier NAME ('gold') and `tier`
  // the division NUMBER (1-5), as everywhere in the snapshot data.
  division: string | null;
  tier: number | null;
  // "Gold 3": the badge's alt text.
  label: string;
  icons: RankIconMaps | undefined;
}

function Insignia({ name, number, label, badge, overlay }: {
  name: string;
  number: number;
  label: string;
  badge: string | null;
  overlay: string | null;
}) {
  const [failed, setFailed] = useState(false);

  // Official art: the tier badge with the division number stacked under it,
  // sized like the optimizer's lineup cards.
  if (badge && overlay && !failed) {
    return (
      <span className="rank-insignia" title={label}>
        <img className="rank-insignia-badge" src={badge} alt={label} onError={() => setFailed(true)} />
        <img className="rank-insignia-tier" src={overlay} alt="" onError={() => setFailed(true)} />
      </span>
    );
  }

  // A URL we haven't captured yet (e.g. diamond), or one that no longer loads.
  return (
    <span
      className={`rank-insignia-fallback${TINTED.has(name) ? ` tier-${name}` : ''}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {number}
    </span>
  );
}

// The insignia for one rank card. Look-up is by name and number only, so past
// seasons' ranks get the badge too. Renders nothing for an unranked role.
export default function RankInsignia({ division, tier, label, icons }: Props) {
  const name = division?.trim().toLowerCase() ?? '';
  if (!name) return null;
  const number = divisionNumber(tier);
  const badge = urlFor(icons?.divisions, name);
  const overlay = urlFor(icons?.tiers, String(number));
  // Keyed by the URLs so a new rank retries images that failed for the old one.
  return <Insignia key={`${badge}|${overlay}`} name={name} number={number} label={label} badge={badge} overlay={overlay} />;
}
