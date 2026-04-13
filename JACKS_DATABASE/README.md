# ow-stats-influxdb

Telegraf-based data collection pipeline for Overwatch player stats. Scrapes the
[OverFast API](https://overfast-api.tekrop.fr/) on a schedule, writes InfluxDB
line protocol via Telegraf, and optionally visualizes with Grafana.

## Architecture

```
                 internal network
┌────────────────────────────────────────────┐
│  Telegraf ──────────► InfluxDB:8181        │
│  (exec plugin)         (no auth)           │
│                           ▲                │
│  Grafana ──► nginx:8086 ──┘                │
│              (read-only proxy)             │
└──────────────┬─────────────────────────────┘
               │ external network
               ▼
          nginx:8086 ── port 8183 (host)
          /query, /health, /ping → allowed
          /write, everything else → 403
```

- **Telegraf** — Runs Python scripts via exec input plugin on a 1-hour interval
- **InfluxDB 3 Core** — Time-series storage, no auth internally
- **nginx** — Reverse proxy exposing read-only access externally, writes blocked
- **Grafana** (optional) — Dashboards, enabled via `--profile grafana`

## Quick Start

```bash
# Copy and edit environment config
cp example.env .env

# Start core services (InfluxDB + Telegraf + proxy)
docker compose up --build -d

# Or with Grafana
docker compose --profile grafana up --build -d
```

## Configuration

### Environment Variables (`.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `OW_PLAYERS` | Comma-separated battletags to scrape | `Player1-1234,Player2-5678` |

See `example.env` for a template.

### Telegraf

The scrape interval and exec plugin timeouts are configured in `docker/telegraf/telegraf.conf`.
Default interval is 3600s (1 hour).

## Measurements

### `competitive_rank`

One row per player per role. Tags: `player`, `role`. Fields: `division` (string), `tier`, `season`.

### `heroes_comparisons`

One row per player per hero. Tags: `player`, `platform`, `gamemode`, `hero`.
Fields: `time_played`, `games_won`, `win_percentage`, `eliminations_per_life`,
`deaths_avg_per_10_min`, `healing_done_avg_per_10_min`, and more (15 fields total).

### `career_stats_*`

Split by category to stay under InfluxDB's 500-column limit:

| Measurement | Description |
|-------------|-------------|
| `career_stats_best` | Personal bests (most in game/life) |
| `career_stats_average` | Per-10-minute averages |
| `career_stats_combat` | Lifetime combat totals |
| `career_stats_game` | Games played/won/lost |
| `career_stats_assists` | Assist stats |
| `career_stats_match_awards` | Medal counts |
| `career_stats_hero_specific_<hero>` | Per-hero ability stats (one measurement per hero) |

Tags: `player`, `platform`, `gamemode`, `hero`.

## Network Security

InfluxDB is only accessible on the internal Docker network. External access goes
through an nginx reverse proxy that whitelists read-only endpoints:

- `/health`, `/ping` — allowed
- `/query`, `/api/v2/query`, `/api/v3/query_sql`, `/api/v3/query_influxql` — allowed
- Everything else (including `/write`) — **403 Forbidden**

Telegraf writes directly to InfluxDB on the internal network, bypassing the proxy entirely.

## Querying

The read-only proxy exposes InfluxQL via the `/query` endpoint. Production is at `134.199.184.203:8183`.

```bash
# List databases
curl -s "http://134.199.184.203:8183/query?db=ow_stats_telegraf&q=SHOW+DATABASES" | jq

# List measurements
curl -s "http://134.199.184.203:8183/query?db=ow_stats_telegraf&q=SHOW+MEASUREMENTS" | jq

# Competitive ranks (latest per player/role)
curl -s "http://134.199.184.203:8183/query?db=ow_stats_telegraf&q=SELECT+last(tier),division+FROM+competitive_rank+GROUP+BY+player,role" | jq

# Top heroes by time played for a player
curl -s "http://134.199.184.203:8183/query?db=ow_stats_telegraf&q=SELECT+last(time_played)+FROM+heroes_comparisons+WHERE+player='DarthKcaj-1443'+AND+gamemode='competitive'+GROUP+BY+hero+ORDER+BY+time+DESC+LIMIT+10" | jq

# Career stats (combat) for a specific hero
curl -s "http://134.199.184.203:8183/query?db=ow_stats_telegraf&q=SELECT+*+FROM+career_stats_combat+WHERE+player='DarthKcaj-1443'+AND+hero='illari'+AND+gamemode='competitive'+ORDER+BY+time+DESC+LIMIT+1" | jq

# Health check
curl -s "http://134.199.184.203:8183/health"
```

Replace `134.199.184.203` with `localhost` for local development.

## Directory Structure

```
├── .env                        # Player list (gitignored, auto-loaded by compose)
├── example.env                 # Template for .env
├── docker-compose.yml          # Service definitions (at package root)
└── docker/
    ├── Dockerfile.telegraf     # Custom Telegraf image (uv + Python)
    ├── nginx/
    │   └── influxdb-proxy.conf.template  # Read-only proxy config
    ├── telegraf/
    │   └── telegraf.conf       # Telegraf agent configuration
    ├── grafana/
    │   ├── dashboards/         # Grafana dashboard JSON files
    │   └── provisioning/       # Datasource and dashboard provisioning
    └── scripts/
        ├── heartbeat.py        # Pipeline health check (outputs heartbeat measurement)
        └── scrape.py           # OverFast API scraper (outputs line protocol)
```

## Ports

| Service | Internal | Host |
|---------|----------|------|
| InfluxDB | 8181 | — (internal only) |
| nginx proxy | 8086 | 8183 |
| Grafana | 3000 | 3001 (profile: grafana) |
