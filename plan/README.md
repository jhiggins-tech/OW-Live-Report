# plan/

Working plan documents for the V2 site rebuild. Each markdown file is a PRD
(Product Requirement Document) — what the change is, why we want it, what's
in scope, what's out, and the open questions.

## Master plan

- **[v2.md](./v2.md)** — the original V2 greenfield plan. Records the MVP
  scope, the V2.1 checklist (all shipped, with PR references), the V2.2
  backlog (pointing at the PRDs below), and the V1→V2 port map.

## V2.2 PRDs

All sized to roughly one PR each. Status is currently "Proposed" on all of
them — none have been picked up.

- **[v2.2-hash-url-migration.md](./v2.2-hash-url-migration.md)** — drop the
  `#` from V2 URLs by moving HashRouter → BrowserRouter and emitting one
  HTML stub per route at build time. Biggest of the four; touches routing,
  build, and CI.
- **[v2.2-hero-pool-meta-overlay.md](./v2.2-hero-pool-meta-overlay.md)** —
  layer OverFast community pickrate onto the Overview team hero pool so
  you can see at a glance whether the team is on-meta or running niche
  picks. Small follow-up to PR #20.
- **[v2.2-hero-portraits.md](./v2.2-hero-portraits.md)** — show OverFast
  hero portraits next to hero names on the player leaderboard (and
  optionally the team hero pool). Cosmetic, ~½ PR.
- **[v2.2-overfast-player-endpoints.md](./v2.2-overfast-player-endpoints.md)**
  — evaluate `/players/{id}/stats/*` for live (non-cached) data. Current
  recommendation: **skip** unless a concrete real-time use case shows up.

## Conventions

- File name pattern: `<version>-<short-slug>.md`. Use lowercase, hyphens.
- Every PRD has these sections: *Status, Context, Goals, Non-goals,
  Proposed approach, Open questions, Risks, Acceptance criteria,
  Estimated effort*.
- PRDs link to relevant PRs by number so context survives across sessions.
- When a PRD ships, mark its `Status` line and link the merged PR.
