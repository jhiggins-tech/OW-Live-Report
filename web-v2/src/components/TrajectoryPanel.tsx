import { usePlayerTrajectory } from '../hooks/usePlayerTrajectory';

const LABEL_TONE: Record<string, 'support' | 'damage' | 'tank'> = {
  up: 'support',
  down: 'damage',
  flat: 'tank',
};

const LABEL_TEXT: Record<string, string> = {
  up: 'Trending up',
  down: 'Trending down',
  flat: 'Stable',
};

const METRIC_LABEL: Record<string, string> = {
  rank: 'Rank',
  kda: 'KDA',
  winrate: 'Win rate',
};

function fmtSlope(metric: string, slope: number): string {
  switch (metric) {
    case 'rank':
      return `${slope >= 0 ? '+' : ''}${slope.toFixed(3)} divs/day`;
    case 'kda':
      return `${slope >= 0 ? '+' : ''}${slope.toFixed(3)}/day`;
    case 'winrate':
      return `${slope >= 0 ? '+' : ''}${slope.toFixed(2)} pp/day`;
    default:
      return slope.toFixed(3);
  }
}

export default function TrajectoryPanel({ playerId, displayName }: { playerId: string; displayName: string }) {
  const { trajectory, isLoading, isError } = usePlayerTrajectory(playerId, displayName);

  if (isLoading) return <div className="panel skeleton" style={{ minHeight: 160 }} />;
  if (isError) return <div className="error">Couldn't compute trajectory.</div>;
  if (!trajectory) return null;

  if (trajectory.signals.length === 0) {
    return (
      <section className="panel">
        <header className="section-head">
          <h2>Trajectory</h2>
          <p>Composite trend across rank, KDA, win rate</p>
        </header>
        <div className="empty">Not enough recent data to project a direction yet.</div>
      </section>
    );
  }

  return (
    <section className="panel">
      <header
        className="section-head"
        style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2>Trajectory</h2>
          <span className={`role-pill ${LABEL_TONE[trajectory.label]}`}>
            {LABEL_TEXT[trajectory.label]}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>{trajectory.forecast}</span>
        </div>
        <p style={{ marginLeft: 'auto' }}>
          confidence {Math.round(trajectory.confidence * 100)}%
        </p>
      </header>
      <p className="lede" style={{ marginTop: 0 }}>{trajectory.narrative}</p>
      <div className="grid cols-3" style={{ marginTop: 16 }}>
        {trajectory.signals.map((sig) => (
          <div key={sig.metric} className="panel" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <div className="label" style={{ fontSize: '0.78rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              {METRIC_LABEL[sig.metric]}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
              <span className={`role-pill ${LABEL_TONE[sig.direction]}`} style={{ fontSize: '0.72rem' }}>
                {sig.direction}
              </span>
              <span style={{ fontSize: '0.9rem' }}>{fmtSlope(sig.metric, sig.slopePerDay)}</span>
            </div>
            <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: '0.78rem' }}>
              confidence {Math.round(sig.confidence * 100)}%
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
