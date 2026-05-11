(() => {
  const dataNode = document.getElementById("report-data");
  if (!dataNode) return;

  const pageData = JSON.parse(dataNode.textContent);
  const palette = ["#59c2ff", "#41d8b7", "#ffb84f", "#ff7f73", "#9ed36a", "#f3de79"];

  const fmtDate = (value) =>
    new Date(value).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const fmtAxisTime = (timeMs, spanMs) => {
    const value = new Date(timeMs);
    if (spanMs >= 1000 * 60 * 60 * 24 * 3) {
      return value.toLocaleDateString([], {
        month: "short",
        day: "numeric",
      });
    }
    return value.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const fmtNumber = (value, digits = 2) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
    return Number(value).toFixed(digits);
  };

  const fmtPercent = (value, digits = 1) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
    return `${Number(value).toFixed(digits)}%`;
  };

  const fmtHours = (seconds) => {
    if (seconds === null || seconds === undefined) return "n/a";
    return `${(Number(seconds) / 3600).toFixed(1)}h`;
  };

  const fmtSigned = (value, digits = 2) => {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(digits)}`;
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const infoIcon = (description) =>
    description
      ? `<span class="info-pill" tabindex="0" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}">i</span>`
      : "";

  const withInfo = (label, description) => `${escapeHtml(label)} ${infoIcon(description)}`;

  const renderAxisNote = (xLabel, yLabel) => `
    <div class="axis-note">
      <span>${escapeHtml(`X: ${xLabel}`)}</span>
      <span>${escapeHtml(`Y: ${yLabel}`)}</span>
    </div>
  `;

  const emptyState = (container, message) => {
    if (!container) return;
    container.classList.add("empty");
    container.innerHTML = `<p>${escapeHtml(message)}</p>`;
  };

  const buildSparkline = (series, color) => {
    const points = (series || []).filter((point) => point.value !== null && point.value !== undefined);
    if (!points.length) return "";
    const width = 260;
    const height = 56;
    const pad = 6;
    const values = points.map((point) => Number(point.value));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 0.001);
    const coords = points.map((point, index) => {
      const x = pad + (index / Math.max(points.length - 1, 1)) * (width - pad * 2);
      const y = height - pad - ((Number(point.value) - min) / span) * (height - pad * 2);
      return `${x},${y}`;
    });
    return `
      <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <path d="M ${coords.join(" L ")}" stroke="${color}" />
      </svg>
    `;
  };

  const renderLineChart = (container, seriesDefs, options = {}) => {
    if (!container) return;
    const allPoints = seriesDefs.flatMap((definition) =>
      (definition.series || []).filter((point) => point.value !== null && point.value !== undefined)
    );
    if (!allPoints.length) {
      emptyState(container, options.emptyMessage || "Not enough data yet.");
      return;
    }

    const width = options.width || 640;
    const height = options.height || 280;
    const pad = { top: 18, right: 18, bottom: 38, left: 44 };
    const timestamps = allPoints.map((point) => new Date(point.timestamp).getTime());
    const values = allPoints.map((point) => Number(point.value));
    const minX = Math.min(...timestamps);
    const maxX = Math.max(...timestamps);
    const minY = options.minY ?? Math.min(...values);
    const maxY = options.maxY ?? Math.max(...values);
    const ySpan = Math.max(maxY - minY, 0.001);
    const xSpan = Math.max(maxX - minX, 1);

    const xFor = (time) => pad.left + ((time - minX) / xSpan) * (width - pad.left - pad.right);
    const yFor = (value) => height - pad.bottom - ((value - minY) / ySpan) * (height - pad.top - pad.bottom);

    const yTickValues = (() => {
      if (options.tickValues?.length) {
        return [...new Set(options.tickValues.map(Number).filter((value) => Number.isFinite(value)))].sort((left, right) => right - left);
      }
      return Array.from({ length: 4 }, (_, index) => {
        const ratio = index / 3;
        return maxY - ratio * ySpan;
      });
    })();

    const buildVisibleSegments = (series) => {
      if (options.connectGaps !== false) {
        return [
          (series || []).filter((point) => point.value !== null && point.value !== undefined),
        ].filter((segment) => segment.length);
      }

      const segments = [];
      let currentSegment = [];
      (series || []).forEach((point) => {
        if (point.value === null || point.value === undefined) {
          if (currentSegment.length) {
            segments.push(currentSegment);
            currentSegment = [];
          }
          return;
        }
        currentSegment.push(point);
      });
      if (currentSegment.length) {
        segments.push(currentSegment);
      }
      return segments;
    };

    const buildPath = (points) => {
      if (!points.length) return "";
      const firstPoint = points[0];
      const firstX = xFor(new Date(firstPoint.timestamp).getTime());
      const firstY = yFor(Number(firstPoint.value));
      const parts = [`M ${firstX} ${firstY}`];

      for (let index = 1; index < points.length; index += 1) {
        const point = points[index];
        const x = xFor(new Date(point.timestamp).getTime());
        const y = yFor(Number(point.value));

        if (options.stepMode === "after") {
          const previousPoint = points[index - 1];
          const previousY = yFor(Number(previousPoint.value));
          parts.push(`L ${x} ${previousY} L ${x} ${y}`);
        } else {
          parts.push(`L ${x} ${y}`);
        }
      }

      return parts.join(" ");
    };

    const grid = yTickValues.map((rawValue) => {
      const y = yFor(rawValue);
      return `
        <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
        <text x="${pad.left - 8}" y="${y + 4}" fill="rgba(148,170,200,0.9)" font-size="11" text-anchor="end">${escapeHtml(
          options.tickFormatter ? options.tickFormatter(rawValue) : fmtNumber(rawValue, 1)
        )}</text>
      `;
    }).join("");

    const xTicks = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      const time = minX + ratio * xSpan;
      const x = xFor(time);
      return `
        <line x1="${x}" y1="${height - pad.bottom}" x2="${x}" y2="${height - pad.bottom + 6}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
        <text x="${x}" y="${height - 8}" fill="rgba(148,170,200,0.9)" font-size="11" text-anchor="middle">${escapeHtml(
          fmtAxisTime(time, xSpan)
        )}</text>
      `;
    }).join("");

    const seriesMarkup = seriesDefs
      .map((definition, index) => {
        const visiblePoints = (definition.series || []).filter((point) => point.value !== null && point.value !== undefined);
        if (!visiblePoints.length) return "";
        const color = definition.color || palette[index % palette.length];
        const paths = buildVisibleSegments(definition.series || [])
          .map((segment) => {
            const path = buildPath(segment);
            if (!path) return "";
            return `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />`;
          })
          .join("");
        const dots = visiblePoints
          .map((point) => {
            const x = xFor(new Date(point.timestamp).getTime());
            const y = yFor(Number(point.value));
            const label = options.pointFormatter
              ? options.pointFormatter(point.value, point)
              : fmtNumber(point.value, 2);
            return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"><title>${escapeHtml(
              `${definition.name}: ${label} on ${fmtDate(point.timestamp)}`
            )}</title></circle>`;
          })
          .join("");
        return `${paths}${dots}`;
      })
      .join("");

    const legend = options.showLegend === false
      ? ""
      : seriesDefs
          .map(
            (definition, index) =>
              `<span class="hero-chip"><span style="width:10px;height:10px;border-radius:999px;background:${
                definition.color || palette[index % palette.length]
              };display:inline-block"></span>${escapeHtml(definition.name)}</span>`
          )
          .join("");

    const axisNote = options.showAxisNote === false ? "" : renderAxisNote(options.xLabel || "Snapshot Time", options.yLabel || "Value");

    container.classList.remove("empty");
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="rgba(255,255,255,0.14)" stroke-width="1" />
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="rgba(255,255,255,0.14)" stroke-width="1" />
        ${grid}
        ${seriesMarkup}
        ${xTicks}
      </svg>
      <div class="chart-meta">
        ${legend ? `<div class="hero-list">${legend}</div>` : ""}
        ${axisNote}
      </div>
    `;
  };

  const renderBarChart = (container, items, options = {}) => {
    if (!container) return;
    if (!items || !items.length) {
      emptyState(container, options.emptyMessage || "Not enough data yet.");
      return;
    }
    const maxValue = Math.max(...items.map((item) => Number(item.value || 0)), 1);
    container.classList.remove("empty");
    container.innerHTML = `
      <div class="detail-list">
        ${items
          .map((item, index) => {
            const color = palette[index % palette.length];
            const width = Math.max(4, (Number(item.value || 0) / maxValue) * 100);
            return `
              <div class="detail-row">
                <div style="min-width:120px">${escapeHtml(item.label)}</div>
                <div style="flex:1;display:flex;align-items:center;gap:10px">
                  <div style="height:12px;border-radius:999px;background:${color};width:${width}%"></div>
                  <div>${escapeHtml(item.display)}</div>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
      ${renderAxisNote(options.xLabel || "Metric Value", options.yLabel || "Categories")}
    `;
  };

  const renderScatterChart = (container, points) => {
    if (!container) return;
    if (!points || !points.length) {
      emptyState(container, "Not enough comparison points yet.");
      return;
    }

    const width = 620;
    const height = 280;
    const pad = { top: 16, right: 16, bottom: 36, left: 48 };
    const xs = points.map((point) => Number(point.kda));
    const ys = points.map((point) => Number(point.winrate));
    const minX = Math.min(...xs, 0.5);
    const maxX = Math.max(...xs, 2.5);
    const minY = Math.min(...ys, 30);
    const maxY = Math.max(...ys, 70);
    const xSpan = Math.max(maxX - minX, 0.001);
    const ySpan = Math.max(maxY - minY, 0.001);
    const xFor = (value) => pad.left + ((value - minX) / xSpan) * (width - pad.left - pad.right);
    const yFor = (value) => height - pad.bottom - ((value - minY) / ySpan) * (height - pad.top - pad.bottom);

    const xTicks = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      const rawValue = minX + ratio * xSpan;
      const x = xFor(rawValue);
      return `
        <line x1="${x}" y1="${height - pad.bottom}" x2="${x}" y2="${height - pad.bottom + 6}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
        <text x="${x}" y="${height - 8}" fill="rgba(148,170,200,0.9)" font-size="11" text-anchor="middle">${escapeHtml(
          fmtNumber(rawValue, 1)
        )}</text>
      `;
    }).join("");

    const yTicks = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      const rawValue = maxY - ratio * ySpan;
      const y = pad.top + ratio * (height - pad.top - pad.bottom);
      return `
        <line x1="${pad.left - 6}" y1="${y}" x2="${pad.left}" y2="${y}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />
        <text x="${pad.left - 10}" y="${y + 4}" fill="rgba(148,170,200,0.9)" font-size="11" text-anchor="end">${escapeHtml(
          fmtPercent(rawValue, 0)
        )}</text>
      `;
    }).join("");

    const comparisonLegend = points
      .map((point, index) => {
        const color = `hsl(${Math.round((index / Math.max(points.length, 1)) * 320)}, 72%, 63%)`;
        return `<span class="hero-chip"><span style="width:10px;height:10px;border-radius:999px;background:${color};display:inline-block"></span>${escapeHtml(
          `${point.display_name} (${fmtNumber(point.kda, 2)} / ${fmtPercent(point.winrate, 1)})`
        )}</span>`;
      })
      .join("");

    container.classList.remove("empty");
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="rgba(255,255,255,0.1)" />
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="rgba(255,255,255,0.1)" />
        ${xTicks}
        ${yTicks}
        ${points
          .map((point, index) => {
            const x = xFor(Number(point.kda));
            const y = yFor(Number(point.winrate));
            const color = `hsl(${Math.round((index / Math.max(points.length, 1)) * 320)}, 72%, 63%)`;
            const stroke =
              point.trend_label === "up" ? "#59e19c" : point.trend_label === "down" ? "#ff7070" : "rgba(255,255,255,0.7)";
            return `<circle cx="${x}" cy="${y}" r="7" fill="${color}" stroke="${stroke}" stroke-width="2"><title>${escapeHtml(
              `${point.display_name}: KDA ${fmtNumber(point.kda, 2)}, win rate ${fmtPercent(point.winrate, 1)}`
            )}</title></circle>`;
          })
          .join("")}
      </svg>
      <div class="chart-meta">
        <div class="hero-list comparison-legend">${comparisonLegend}</div>
        ${renderAxisNote("KDA", "Win Rate")}
      </div>
    `;
  };

  const renderHeroMeta = (cards) =>
    cards
      .map(
        (card) => `
          <div class="metric-card accent-${card.accent}">
            <div class="metric-label">${withInfo(card.label, {
              "Tracked players": "Players currently listed in your tracking file.",
              "Visible players": "Players currently included in overview charts and optimizer after roster visibility filters.",
              "Fresh snapshots": "Players successfully captured in the most recent manual run.",
              "Team avg KDA": "Average kills plus assists divided by deaths across the current team snapshot.",
              "Team avg rank": "Average competitive rank converted to an internal ordinal scale, then shown again as a readable ladder label."
            }[card.label])}</div>
            <strong>${escapeHtml(card.value)}</strong>
          </div>
        `
      )
      .join("");

  const getDataSourceStatus = (meta) => {
    if (meta?.source_mode === "live" || meta?.live_mode) {
      return {
        label: "Live Server",
        className: "live",
        detail: "Reading fresh data directly from the hosted stats server.",
      };
    }

    if (meta?.source_mode === "published-snapshot") {
      return {
        label: "Published Snapshot",
        className: "live",
        detail: "Reading the uploaded snapshot file that sits beside this published site.",
      };
    }

    if (meta?.source_mode === "embedded-fallback" || meta?.live_source?.enabled) {
      return {
        label: "Fallback Snapshot",
        className: "fallback",
        detail: "Showing the embedded report data that was baked into this page.",
      };
    }

    return {
      label: "Static Snapshot",
      className: "flat",
      detail: "Showing the generated report data saved into this page.",
    };
  };

  const roleLabel = (value) => {
    if (!value) return "";
    if (value === "damage") return "DPS";
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const roleOrder = { tank: 0, damage: 1, support: 2 };
  const rankTiers = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Grandmaster", "Champion"];

  const normalizeRoleLock = (value) => {
    if (!value) return "";
    const normalized = String(value).trim().toLowerCase();
    if (normalized === "dps") return "damage";
    return ["tank", "damage", "support"].includes(normalized) ? normalized : "";
  };

  const normalizeOptimizerLock = (value) => {
    if (!value) return "";
    const normalized = String(value).trim().toLowerCase();
    if (["bench", "not-playing", "not_playing", "not playing"].includes(normalized)) return "not-playing";
    return normalizeRoleLock(normalized);
  };

  const formatRankLabelFromOrdinal = (ordinal) => {
    const value = Number(ordinal);
    if (!Number.isFinite(value) || value < 1) return "Unranked";
    const rounded = Math.max(1, Math.round(value));
    const tierIndex = Math.min(rankTiers.length - 1, Math.floor((rounded - 1) / 5));
    const division = 6 - (((rounded - 1) % 5) + 1);
    return `${rankTiers[tierIndex]} ${division}`;
  };

  const buildRemovedRunsStorageKey = (meta) => `owr-removed-runs:${meta.team_name}`;
  const buildHiddenPlayersStorageKey = (meta) => `owr-hidden-players:${meta.team_name}`;
  const buildSnapshotDeleteCommand = (meta, runId) => {
    const scriptPath = meta.project_root ? `${meta.project_root}\\remove-snapshot.ps1` : ".\\remove-snapshot.ps1";
    const configPath = meta.config_path || ".\\config\\team.sample.json";
    return `powershell -ExecutionPolicy Bypass -File "${scriptPath}" -RunId "${runId}" -ConfigPath "${configPath}"`;
  };

  const getStoredRemovedRuns = (meta) => {
    try {
      return [...new Set(JSON.parse(localStorage.getItem(buildRemovedRunsStorageKey(meta)) || "[]").filter(Boolean))];
    } catch (error) {
      return [];
    }
  };

  const storeRemovedRuns = (meta, runIds) => {
    try {
      localStorage.setItem(buildRemovedRunsStorageKey(meta), JSON.stringify([...(runIds || [])]));
    } catch (error) {
    }
  };

  const getStoredHiddenPlayers = (meta) => {
    try {
      return [...new Set(JSON.parse(localStorage.getItem(buildHiddenPlayersStorageKey(meta)) || "[]").filter(Boolean))];
    } catch (error) {
      return [];
    }
  };

  const storeHiddenPlayers = (meta, playerSlugs) => {
    try {
      localStorage.setItem(buildHiddenPlayersStorageKey(meta), JSON.stringify([...(playerSlugs || [])]));
    } catch (error) {
    }
  };

  const renderSnapshotDelta = (value, digits, suffix, hasPreviousSnapshot) => {
    if (!hasPreviousSnapshot) {
      return "First tracked snapshot";
    }
    return `${fmtSigned(value, digits)} ${suffix}`;
  };

  const getDeltaClass = (value, hasPreviousSnapshot = true) => {
    if (!hasPreviousSnapshot || Number(value || 0) === 0) return "delta-flat";
    return Number(value || 0) > 0 ? "delta-up" : "delta-down";
  };

  const copyText = async (text) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "readonly");
    input.style.position = "absolute";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    const succeeded = document.execCommand("copy");
    document.body.removeChild(input);
    return succeeded;
  };

  const renderRankPills = (roles) => {
    if (!roles || !roles.length) {
      return `<span class="hero-chip">Unranked</span>`;
    }
    return roles
      .map(
        (rank) =>
          `<span class="rank-pill"><strong style="font-size:0.85rem;display:inline">${escapeHtml(roleLabel(rank.role))}</strong> ${escapeHtml(rank.label)}</span>`
      )
      .join("");
  };

  const renderHeroHighlights = (highlights) => {
    const chips = [];
    if (highlights?.best_kda_hero?.hero_name) {
      chips.push(
        `<span class="hero-chip"><strong>Best KDA:</strong> ${escapeHtml(highlights.best_kda_hero.hero_name)} (${fmtNumber(
          highlights.best_kda_hero.kda,
          2
        )})</span>`
      );
    }
    if (highlights?.best_winrate_hero?.hero_name) {
      chips.push(
        `<span class="hero-chip"><strong>Best WR:</strong> ${escapeHtml(highlights.best_winrate_hero.hero_name)} (${fmtPercent(
          highlights.best_winrate_hero.winrate,
          1
        )})</span>`
      );
    }
    return chips.join("");
  };

  const filterRankedHeroes = (heroes) =>
    (heroes || []).filter((hero) => {
      const gamesPlayed = Number(hero.games_played || 0);
      const winrate = Number(hero.winrate || 0);
      return gamesPlayed > 0 && winrate < 100;
    });

  const renderHeroLeaderboardColumn = (title, items, formatter) => `
    <section class="subpanel leaderboard-panel">
      <div class="subpanel-head">
        <h3>${escapeHtml(title)}</h3>
        <p>Latest hero snapshot.</p>
      </div>
      ${
        items && items.length
          ? `<div class="detail-list">
              ${items
                .map(
                  (hero, index) => `
                    <div class="detail-row leaderboard-row">
                      <div>
                        <strong style="font-size:1rem;display:block">${escapeHtml(hero.hero_name)}</strong>
                        <div class="meta-line">${fmtHours(hero.time_played_seconds)} played - ${escapeHtml(hero.games_played)} games</div>
                      </div>
                      <div class="leaderboard-value">
                        <div>${formatter(hero)}</div>
                        <div class="meta-line">#${index + 1}</div>
                      </div>
                    </div>
                  `
                )
                .join("")}
            </div>`
          : `<div class="meta-line">No hero rows survived the outlier filter yet.</div>`
      }
    </section>
  `;

  const buildOptimizerStorageKey = (meta) => `owr-team-optimizer-locks:${meta.team_name}`;

  const getOptimizerWideAssessment = (assignments) => {
    if (!assignments.length) {
      return {
        label: "unknown",
        is_wide: null,
        reason: "No lineup selected yet.",
        spread_divisions: null,
        threshold: null,
      };
    }

    const ordinals = assignments
      .map((assignment) => assignment.rank_ordinal)
      .filter((value) => value !== null && value !== undefined && !Number.isNaN(Number(value)))
      .map(Number);

    if (ordinals.length !== assignments.length) {
      return {
        label: "unknown",
        is_wide: null,
        reason: "At least one assigned role is unranked, so the Wide Group check is incomplete.",
        spread_divisions: null,
        threshold: null,
      };
    }

    const maxOrdinal = Math.max(...ordinals);
    const minOrdinal = Math.min(...ordinals);
    const spread = Number((maxOrdinal - minOrdinal).toFixed(2));
    const highestTierIndex = Math.floor((maxOrdinal - 1) / 5) + 1;

    if (highestTierIndex >= 7) {
      return {
        label: "wide",
        is_wide: true,
        reason: "A Grandmaster or Champion role rank makes the lineup a Wide Group.",
        spread_divisions: spread,
        threshold: 0,
      };
    }

    const threshold = highestTierIndex >= 6 ? 3 : 5;
    const isWide = spread > threshold;
    return {
      label: isWide ? "wide" : "narrow",
      is_wide: isWide,
      reason:
        highestTierIndex >= 6
          ? isWide
            ? "A Masters-inclusive lineup spreads more than 3 skill divisions, so it is Wide."
            : "The Masters-inclusive lineup stays within 3 skill divisions, so it is Narrow."
          : isWide
            ? "The Diamond-or-lower lineup spreads more than 5 skill divisions, so it is Wide."
            : "The Diamond-or-lower lineup stays within 5 skill divisions, so it is Narrow.",
      spread_divisions: spread,
      threshold,
    };
  };

  const sortOptimizerAssignments = (assignments) =>
    [...assignments].sort((left, right) => {
      const roleDelta = (roleOrder[left.role] ?? 99) - (roleOrder[right.role] ?? 99);
      if (roleDelta !== 0) return roleDelta;
      return String(left.display_name || "").localeCompare(String(right.display_name || ""));
    });

  const computeOptimizerResult = (optimizer, lockState) => {
    const players = optimizer?.candidate_players || [];
    const needed = { tank: 1, damage: 2, support: 2 };
    const used = new Set();
    const lockedAssignments = [];
    const warnings = [...(optimizer?.warnings || [])];

    players.forEach((player) => {
      const lockedRole = normalizeOptimizerLock(lockState[player.slug]);
      if (!lockedRole) return;
      if (lockedRole === "not-playing") {
        used.add(player.slug);
        return;
      }
      if (!(lockedRole in needed)) {
        warnings.push(`Ignored invalid lock for ${player.display_name}.`);
        return;
      }
      if (needed[lockedRole] <= 0) {
        warnings.push(`Ignored extra ${roleLabel(lockedRole)} lock for ${player.display_name} because that role is already full.`);
        return;
      }
      const option = player.role_options?.[lockedRole];
      if (!option?.eligible) {
        warnings.push(`Ignored lock for ${player.display_name} because there is no visible competitive data for that role yet.`);
        return;
      }

      needed[lockedRole] -= 1;
      used.add(player.slug);
      lockedAssignments.push({
        slug: player.slug,
        display_name: player.display_name,
        avatar: player.avatar,
        role: lockedRole,
        role_label: roleLabel(lockedRole),
        score: Number(option.score || 0),
        kda: Number(option.kda || 0),
        winrate: Number(option.winrate || 0),
        games_played: Number(option.games_played || 0),
        time_played_seconds: Number(option.time_played_seconds || 0),
        rank_label: option.rank_label || "Unranked",
        rank_ordinal:
          option.rank_ordinal === null || option.rank_ordinal === undefined ? null : Number(option.rank_ordinal),
        explanation: option.explanation || "",
        locked: true,
      });
    });

    let best = null;
    const search = (currentAssignments, currentNeeded, currentUsed) => {
      const remainingSlots = currentNeeded.tank + currentNeeded.damage + currentNeeded.support;
      if (remainingSlots <= 0) {
        const assignments = sortOptimizerAssignments(currentAssignments);
        const totalScore = Number(
          assignments.reduce((sum, assignment) => sum + Number(assignment.score || 0), 0).toFixed(3)
        );
        const teamKda =
          assignments.length > 0
            ? Number((assignments.reduce((sum, assignment) => sum + Number(assignment.kda || 0), 0) / assignments.length).toFixed(2))
            : 0;
        const teamWinrate =
          assignments.length > 0
            ? Number(
                (
                  assignments.reduce((sum, assignment) => sum + Number(assignment.winrate || 0), 0) / assignments.length
                ).toFixed(2)
              )
            : 0;
        const wideAssessment = getOptimizerWideAssessment(assignments);
        const widePenalty = wideAssessment.label === "narrow" ? 0 : wideAssessment.label === "unknown" ? 1 : 2;

        if (!best) {
          best = { assignments, total_score: totalScore, team_kda: teamKda, team_winrate: teamWinrate, wide_assessment: wideAssessment };
          return;
        }

        const bestWidePenalty =
          best.wide_assessment.label === "narrow" ? 0 : best.wide_assessment.label === "unknown" ? 1 : 2;

        if (
          widePenalty < bestWidePenalty ||
          (widePenalty === bestWidePenalty &&
            (totalScore > best.total_score || (totalScore === best.total_score && teamWinrate > best.team_winrate)))
        ) {
          best = { assignments, total_score: totalScore, team_kda: teamKda, team_winrate: teamWinrate, wide_assessment: wideAssessment };
        }
        return;
      }

      const nextRole = currentNeeded.tank > 0 ? "tank" : currentNeeded.damage > 0 ? "damage" : "support";
      players.forEach((player) => {
        if (currentUsed.has(player.slug)) return;
        const option = player.role_options?.[nextRole];
        if (!option?.eligible) return;

        const nextUsed = new Set(currentUsed);
        nextUsed.add(player.slug);
        search(
          [
            ...currentAssignments,
            {
              slug: player.slug,
              display_name: player.display_name,
              avatar: player.avatar,
              role: nextRole,
              role_label: roleLabel(nextRole),
              score: Number(option.score || 0),
              kda: Number(option.kda || 0),
              winrate: Number(option.winrate || 0),
              games_played: Number(option.games_played || 0),
              time_played_seconds: Number(option.time_played_seconds || 0),
              rank_label: option.rank_label || "Unranked",
              rank_ordinal:
                option.rank_ordinal === null || option.rank_ordinal === undefined ? null : Number(option.rank_ordinal),
              explanation: option.explanation || "",
              locked: normalizeOptimizerLock(lockState[player.slug]) === nextRole,
            },
          ],
          {
            ...currentNeeded,
            [nextRole]: currentNeeded[nextRole] - 1,
          },
          nextUsed
        );
      });
    };

    search(lockedAssignments, needed, used);

    return {
      result: best,
      warnings: [...new Set(warnings.filter(Boolean))],
    };
  };

  const renderTeamOptimizer = (container, meta, optimizer) => {
    if (!container) return;
    if (!optimizer?.candidate_players?.length) {
      emptyState(container, "Need at least five players with competitive history before the team optimizer can build a lineup.");
      return;
    }

    const storageKey = buildOptimizerStorageKey(meta);
    let lockState = {};
    try {
      lockState = JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch (error) {
      lockState = {};
    }

    if (!Object.keys(lockState).length && optimizer.default_locks?.length) {
      optimizer.default_locks.forEach((entry) => {
        lockState[entry.slug] = entry.role;
      });
    }

    const persistLocks = () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(lockState));
      } catch (error) {
      }
    };

    const draw = () => {
      const { result, warnings } = computeOptimizerResult(optimizer, lockState);
      const selectedSlugs = new Set((result?.assignments || []).map((assignment) => assignment.slug));
      const benchPlayers = (optimizer.candidate_players || []).filter((player) => !selectedSlugs.has(player.slug));
      const wideLabel = result?.wide_assessment?.label || "unknown";
      const statusClass = wideLabel === "narrow" ? "up" : wideLabel === "wide" ? "down" : "flat";

      container.classList.remove("empty");
      container.innerHTML = `
        <div class="optimizer-stack">
          <div class="optimizer-controls">
            <div class="optimizer-controls-head">
              <div>
                <h3>Role Locks</h3>
                <p>Browser-only override controls. Lock a role or mark someone as not playing to rerun the best 1 / 2 / 2 lineup instantly.</p>
              </div>
              <button type="button" class="filter-chip" data-reset-locks="true">Reset Locks</button>
            </div>
            <div class="optimizer-lock-grid">
              ${(optimizer.candidate_players || [])
                .map(
                  (player) => `
                    <label class="optimizer-lock-card">
                      <span class="optimizer-lock-name">${escapeHtml(player.display_name)}</span>
                      <select data-lock-player="${escapeHtml(player.slug)}" class="optimizer-select">
                        <option value="">Auto</option>
                        <option value="tank" ${normalizeOptimizerLock(lockState[player.slug]) === "tank" ? "selected" : ""}>Tank</option>
                        <option value="damage" ${normalizeOptimizerLock(lockState[player.slug]) === "damage" ? "selected" : ""}>DPS</option>
                        <option value="support" ${normalizeOptimizerLock(lockState[player.slug]) === "support" ? "selected" : ""}>Support</option>
                        <option value="not-playing" ${normalizeOptimizerLock(lockState[player.slug]) === "not-playing" ? "selected" : ""}>Not Playing</option>
                      </select>
                    </label>
                  `
                )
                .join("")}
            </div>
          </div>
          ${
            result
              ? `
                <div class="optimizer-summary-grid">
                  <div class="summary-card">
                    <div class="metric-label">${withInfo(
                      "Lineup Score",
                      "Internal optimizer score built from role-specific competitive KDA, win rate, sample size, and rank context."
                    )}</div>
                    <strong>${fmtNumber(result.total_score, 3)}</strong>
                    <div class="card-note">Higher means the current role fit looks stronger.</div>
                  </div>
                  <div class="summary-card">
                    <div class="metric-label">${withInfo(
                      "Projected Team KDA",
                      "Average KDA across the selected role assignments."
                    )}</div>
                    <strong>${fmtNumber(result.team_kda, 2)}</strong>
                    <div class="card-note">Competitive-only role sample.</div>
                  </div>
                  <div class="summary-card">
                    <div class="metric-label">${withInfo(
                      "Projected Team Win Rate",
                      "Average win rate across the selected role assignments."
                    )}</div>
                    <strong>${fmtPercent(result.team_winrate, 1)}</strong>
                    <div class="card-note">Competitive-only role sample.</div>
                  </div>
                  <div class="summary-card">
                    <div class="metric-label">${withInfo(
                      "Wide Check",
                      optimizer.wide_rule_summary || "Blizzard Wide Group check based on assigned role ranks."
                    )}</div>
                    <strong>${escapeHtml(wideLabel.toUpperCase())}</strong>
                    <div class="badge ${statusClass}">${escapeHtml(result.wide_assessment.reason)}</div>
                  </div>
                </div>
                <div class="hero-list">
                  <span class="flag-chip">Spread: ${
                    result.wide_assessment.spread_divisions === null
                      ? "unknown"
                      : escapeHtml(fmtNumber(result.wide_assessment.spread_divisions, 2))
                  } divisions</span>
                  ${
                    result.wide_assessment.threshold !== null
                      ? `<span class="flag-chip">Threshold: ${escapeHtml(result.wide_assessment.threshold)}</span>`
                      : ""
                  }
                  ${
                    optimizer.wide_rule_source_url
                      ? `<a class="hero-chip" href="${escapeHtml(optimizer.wide_rule_source_url)}" target="_blank" rel="noreferrer">Blizzard wide rule source</a>`
                      : ""
                  }
                </div>
                <div class="optimizer-lineup-grid">
                  ${result.assignments
                    .map(
                      (assignment) => `
                        <article class="optimizer-card">
                          <div class="player-head">
                            <div>
                              <div class="player-name">${escapeHtml(assignment.display_name)}</div>
                              <div class="meta-line">${escapeHtml(roleLabel(assignment.role))} | ${escapeHtml(
                                assignment.rank_label || "Unranked"
                              )}</div>
                            </div>
                            <div class="hero-list">
                              <span class="rank-pill">${escapeHtml(roleLabel(assignment.role))}</span>
                              ${assignment.locked ? `<span class="flag-chip">Locked</span>` : ""}
                            </div>
                          </div>
                          <div class="split-row">
                            <div class="summary-card">
                              <div class="metric-label">Role KDA</div>
                              <strong>${fmtNumber(assignment.kda, 2)}</strong>
                            </div>
                            <div class="summary-card">
                              <div class="metric-label">Role WR</div>
                              <strong>${fmtPercent(assignment.winrate, 1)}</strong>
                            </div>
                            <div class="summary-card">
                              <div class="metric-label">Role Score</div>
                              <strong>${fmtNumber(assignment.score, 3)}</strong>
                            </div>
                          </div>
                          <div class="meta-line">${escapeHtml(assignment.explanation || "Competitive role sample")}</div>
                        </article>
                      `
                    )
                    .join("")}
                </div>
                ${
                  benchPlayers.length
                    ? `<div class="detail-list">
                        <div class="detail-row">
                          <strong>Not selected right now</strong>
                          <div class="hero-list">${benchPlayers
                            .map((player) => {
                              const playerLock = normalizeOptimizerLock(lockState[player.slug]);
                              return `<span class="hero-chip">${escapeHtml(player.display_name)}${
                                playerLock === "not-playing" ? " (not playing)" : ""
                              }</span>`;
                            })
                            .join("")}</div>
                        </div>
                      </div>`
                    : ""
                }
              `
              : `<div class="chart-shell empty"><p>No valid 1 tank / 2 DPS / 2 support lineup could be built from the current competitive role samples.</p></div>`
          }
          ${
            warnings.length
              ? `<div class="hero-list">${warnings.map((warning) => `<span class="flag-chip">${escapeHtml(warning)}</span>`).join("")}</div>`
              : ""
          }
        </div>
      `;

      const resetButton = container.querySelector("[data-reset-locks]");
      if (resetButton) {
        resetButton.addEventListener("click", () => {
          lockState = {};
          persistLocks();
          draw();
        });
      }

      container.querySelectorAll("[data-lock-player]").forEach((select) => {
        select.addEventListener("change", (event) => {
          const { value } = event.target;
          const slug = event.target.getAttribute("data-lock-player");
          if (!value) {
            delete lockState[slug];
          } else {
            lockState[slug] = normalizeOptimizerLock(value);
          }
          persistLocks();
          draw();
        });
      });
    };

    draw();
  };

  const renderOverview = (payload) => {
    const removedRunIds = getStoredRemovedRuns(payload.meta);
    let hiddenPlayerSlugs = getStoredHiddenPlayers(payload.meta);
    const validPlayerSlugs = new Set((payload.players || []).map((player) => player.slug).filter(Boolean));
    hiddenPlayerSlugs = hiddenPlayerSlugs.filter((slug) => validPlayerSlugs.has(slug));
    const { meta, overview } = buildOverviewView(payload, removedRunIds, hiddenPlayerSlugs);
    const sourceStatus = getDataSourceStatus(meta);
    document.getElementById("hero-meta").innerHTML = `
      <div class="meta-line"><span class="badge ${escapeHtml(sourceStatus.className)}">${escapeHtml(sourceStatus.label)}</span></div>
      <div class="meta-line">${escapeHtml(sourceStatus.detail)}</div>
      <div class="meta-line">Generated ${escapeHtml(fmtDate(meta.generated_at))}</div>
      <div class="meta-line">Latest visible run: ${escapeHtml(meta.latest_run?.run_id || "n/a")}</div>
      <div class="meta-line">Scope: ${escapeHtml(meta.stat_scope || "competitive-only")}</div>
      <div class="meta-line">Queue context: ${escapeHtml(meta.latest_run?.wide_match_context || "mixed")}</div>
      <div class="meta-line">Fresh snapshots: ${escapeHtml(meta.fresh_snapshots)}</div>
      ${meta.live_refresh_message ? `<div class="meta-line">${escapeHtml(meta.live_refresh_message)}</div>` : ""}
      <div class="meta-line">Removed runs: ${escapeHtml(removedRunIds.length)}</div>
      <div class="meta-line">Hidden players: ${escapeHtml(hiddenPlayerSlugs.length)}</div>
    `;

    const summary = document.getElementById("overview-summary");
    summary.innerHTML =
      renderHeroMeta(overview.stat_cards) +
      `
      <div class="summary-card">
        <div class="metric-label">${withInfo(
          "Trend Split",
          "How many players currently look to be trending up, flat, or down based on recent snapshots."
        )}</div>
        <strong>${overview.trend_counts.up} / ${overview.trend_counts.flat} / ${overview.trend_counts.down}</strong>
        <div class="card-note">Up / flat / down</div>
      </div>
      <div class="summary-card">
        <div class="metric-label">${withInfo(
          "Watchlist",
          "Players flagged for warnings, downward movement, or partial data that deserves a closer look."
        )}</div>
        <strong>${overview.watchlist.length}</strong>
        <div class="card-note">Players needing review or context.</div>
      </div>
    `;

    renderLineChart(
      document.getElementById("team-kda-chart"),
      [{ name: "Team KDA", series: overview.team_series.kda, color: palette[0] }],
      {
        tickFormatter: (value) => fmtNumber(value, 1),
        pointFormatter: (value) => fmtNumber(value, 2),
        xLabel: "Snapshot Time",
        yLabel: "KDA",
        emptyMessage: "Run at least two snapshots to see team KDA momentum.",
      }
    );

    renderLineChart(
      document.getElementById("team-winrate-chart"),
      [{ name: "Team Win Rate", series: overview.team_series.winrate, color: palette[2] }],
      {
        tickFormatter: (value) => fmtPercent(value, 0),
        pointFormatter: (value) => fmtPercent(value, 1),
        xLabel: "Snapshot Time",
        yLabel: "Win Rate",
        emptyMessage: "Run at least two snapshots to see team win-rate momentum.",
      }
    );

    renderLineChart(
      document.getElementById("team-rank-chart"),
      [{ name: "Team Rank Ordinal", series: overview.team_series.rank, color: palette[3] }],
      {
        tickFormatter: (value) => fmtNumber(value, 0),
        pointFormatter: (value) => fmtNumber(value, 2),
        xLabel: "Snapshot Time",
        yLabel: "Rank Ordinal",
        emptyMessage: "Rank data appears once competitive roles are visible.",
      }
    );

    renderScatterChart(document.getElementById("comparison-chart"), overview.comparison);
    renderBarChart(
      document.getElementById("hero-pool-chart"),
      [...(overview.hero_pool_summary || [])]
        .sort((left, right) => Number(right.total_time_played_seconds || 0) - Number(left.total_time_played_seconds || 0))
        .map((hero) => ({
          label: hero.hero_name,
          value: hero.total_time_played_seconds,
          display: `${fmtHours(hero.total_time_played_seconds)} across ${hero.player_count} players`,
        })),
      {
        emptyMessage: "Hero pool fills in after successful snapshots.",
        xLabel: "Hours Played",
        yLabel: "Heroes",
      }
    );

    const filters = [
      { id: "all", label: "All Players" },
      { id: "up", label: "Trending Up" },
      { id: "down", label: "Trending Down" },
      { id: "tank", label: "Tank" },
      { id: "damage", label: "Damage" },
      { id: "support", label: "Support" },
      { id: "falling-kda", label: "Falling KDA" },
      { id: "best-momentum", label: "Best Momentum" },
      { id: "needs-review", label: "Needs Review" },
      { id: "wide-warning", label: "Wide Queue Warning" },
    ];

    const filterContainer = document.getElementById("overview-filters");
    const visibilityContainer = document.getElementById("player-visibility-controls");
    const playerGrid = document.getElementById("player-grid");
    let activeFilter = "all";

    const renderPlayers = () => {
      const visiblePlayers = overview.players.filter(
        (player) => activeFilter === "all" || player.filter_tags.includes(activeFilter)
      );
      if (!visiblePlayers.length) {
        playerGrid.innerHTML = `
          <div class="summary-card empty-card">
            <div class="metric-label">No Visible Players</div>
            <strong>Nothing matches this filter yet</strong>
            <div class="card-note">Try a different roster filter, show a hidden player, or restore a removed run on the settings page.</div>
          </div>
        `;
        return;
      }
      playerGrid.innerHTML = visiblePlayers
        .map(
          (player) => `
            <a class="player-card" href="${escapeHtml(player.href)}">
              <div class="player-head">
                <div class="identity">
                  ${player.avatar ? `<img class="avatar" src="${escapeHtml(player.avatar)}" alt="">` : `<div class="avatar"></div>`}
                  <div>
                    <div class="player-name">${escapeHtml(player.display_name)}</div>
                    <div class="meta-line">${escapeHtml(roleLabel(player.best_rank_role || player.preferred_role))} | ${escapeHtml(player.current.rank_label)}</div>
                  </div>
                </div>
                <span class="badge ${escapeHtml(player.trend.label)}">${escapeHtml(player.trend.forecast)}</span>
              </div>
              <div class="hero-list">${renderRankPills(player.current.rank_roles)}</div>
              <div class="split-row">
                <div class="summary-card">
                  <div class="metric-label">${withInfo(
                    "KDA",
                    "Kills plus assists divided by deaths. Higher usually means better fight efficiency."
                  )}</div>
                  <strong>${fmtNumber(player.current.kda, 2)}</strong>
                  <div class="${getDeltaClass(player.delta.kda, player.has_previous_snapshot)}">${escapeHtml(
                    renderSnapshotDelta(player.delta.kda, 2, "since last snapshot", player.has_previous_snapshot)
                  )}</div>
                </div>
                <div class="summary-card">
                  <div class="metric-label">${withInfo(
                    "Win Rate",
                    "Percentage of tracked games won in the current snapshot."
                  )}</div>
                  <strong>${fmtPercent(player.current.winrate, 1)}</strong>
                  <div class="${getDeltaClass(player.delta.winrate, player.has_previous_snapshot)}">${escapeHtml(
                    renderSnapshotDelta(player.delta.winrate, 1, "pts since last snapshot", player.has_previous_snapshot)
                  )}</div>
                </div>
              </div>
              ${buildSparkline(player.mini_series.kda, "#59c2ff")}
              <div class="hero-list">${renderHeroHighlights(player.highlights)}</div>
              <div class="hero-list">${(player.top_heroes || []).map((hero) => `<span class="hero-chip">${escapeHtml(hero)}</span>`).join("")}</div>
              <div class="trajectory-copy">${escapeHtml(player.narrative)}</div>
              <div class="hero-list">
                ${(player.flags || []).slice(0, 3).map((flag) => `<span class="flag-chip">${escapeHtml(flag)}</span>`).join("")}
              </div>
            </a>
          `
        )
        .join("");
    };

    filterContainer.innerHTML = filters
      .map(
        (filter) =>
          `<button class="filter-chip ${filter.id === activeFilter ? "active" : ""}" data-filter="${filter.id}">${escapeHtml(filter.label)}</button>`
      )
      .join("");

    if (visibilityContainer) {
      const allPlayers = (payload.players || [])
        .map((player) => ({ slug: player.slug, display_name: player.display_name }))
        .filter((player) => player.slug);
      const allPlayerSlugs = new Set(allPlayers.map((player) => player.slug));
      hiddenPlayerSlugs = hiddenPlayerSlugs.filter((slug) => allPlayerSlugs.has(slug));
      const hiddenPlayerSet = new Set(hiddenPlayerSlugs);

      visibilityContainer.innerHTML = `
        <div class="hero-filter-shell">
          <div class="hero-filter-head">
            <div>
              <strong>Player Visibility</strong>
              <div class="meta-line">Hide players from overview roster cards, team graphs, comparison charts, hero pool summary, and best team combination.</div>
            </div>
            ${
              hiddenPlayerSlugs.length
                ? `<button type="button" class="filter-chip" data-show-all-players="true">Show All Players</button>`
                : ""
            }
          </div>
          <div class="hero-list">
            ${allPlayers
              .map(
                (player) => `
                  <button type="button" class="filter-chip ${hiddenPlayerSet.has(player.slug) ? "active" : ""}" data-toggle-player="${escapeHtml(
                  player.slug
                )}">
                    ${hiddenPlayerSet.has(player.slug) ? "Show" : "Hide"} ${escapeHtml(player.display_name)}
                  </button>
                `
              )
              .join("")}
          </div>
        </div>
      `;

      visibilityContainer.addEventListener("click", (event) => {
        const showAllButton = event.target.closest("[data-show-all-players]");
        const toggleButton = event.target.closest("[data-toggle-player]");
        if (!showAllButton && !toggleButton) return;

        if (showAllButton) {
          hiddenPlayerSlugs = [];
        } else {
          const slug = toggleButton.getAttribute("data-toggle-player");
          const nextHidden = new Set(hiddenPlayerSlugs);
          if (nextHidden.has(slug)) {
            nextHidden.delete(slug);
          } else {
            nextHidden.add(slug);
          }
          hiddenPlayerSlugs = [...nextHidden].filter((hiddenSlug) => allPlayerSlugs.has(hiddenSlug));
        }

        storeHiddenPlayers(payload.meta, hiddenPlayerSlugs);
        window.location.reload();
      });
    }

    filterContainer.addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (!button) return;
      activeFilter = button.dataset.filter;
      Array.from(filterContainer.querySelectorAll(".filter-chip")).forEach((chip) =>
        chip.classList.toggle("active", chip.dataset.filter === activeFilter)
      );
      renderPlayers();
    });

    renderPlayers();
    renderTeamOptimizer(document.getElementById("team-optimizer"), meta, overview.team_optimizer);
  };

  const renderRecommendationColumn = (title, items) => `
    <div class="recommendation-card">
      <h4>${escapeHtml(title)}</h4>
      ${
        items && items.length
          ? items
              .map(
                (item) => `
                  <div class="detail-row">
                    <div>
                      <strong style="font-size:1rem;display:block">${escapeHtml(item.hero_name)}</strong>
                      <div class="meta-line">${escapeHtml(item.reason)}</div>
                    </div>
                    <div>${fmtPercent(item.winrate, 1)} / ${fmtNumber(item.kda, 2)} KDA</div>
                  </div>
                `
              )
              .join("")
          : `<div class="meta-line">Need more snapshot history here.</div>`
      }
    </div>
  `;

  const buildPlayerHiddenHeroStorageKey = (meta, slug) => `owr-player-hidden-heroes:${meta.team_name}:${slug}`;

  const numericValue = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const computeKdaFromTotals = (eliminations, assists, deaths) => {
    const numerator = numericValue(eliminations) + numericValue(assists);
    if (numerator <= 0) return 0;
    if (numericValue(deaths) <= 0) return Number(numerator.toFixed(2));
    return Number((numerator / numericValue(deaths)).toFixed(2));
  };

  const computePerTenAverage = (total, timePlayedSeconds) => {
    const seconds = numericValue(timePlayedSeconds);
    if (seconds <= 0) return 0;
    return Number((numericValue(total) / (seconds / 600)).toFixed(2));
  };

  const aggregateMetricsFromHeroes = (heroes) => {
    const totals = {
      eliminations: 0,
      assists: 0,
      deaths: 0,
      damage: 0,
      healing: 0,
    };
    let gamesPlayed = 0;
    let gamesWon = 0;
    let gamesLost = 0;
    let timePlayedSeconds = 0;

    (heroes || []).forEach((hero) => {
      gamesPlayed += numericValue(hero.games_played);
      gamesWon += numericValue(hero.games_won);
      gamesLost += numericValue(hero.games_lost);
      timePlayedSeconds += numericValue(hero.time_played_seconds);
      totals.eliminations += numericValue(hero.total?.eliminations);
      totals.assists += numericValue(hero.total?.assists);
      totals.deaths += numericValue(hero.total?.deaths);
      totals.damage += numericValue(hero.total?.damage);
      totals.healing += numericValue(hero.total?.healing);
    });

    const effectiveGamesPlayed = gamesPlayed > 0 ? gamesPlayed : gamesWon + gamesLost;
    const winrate = effectiveGamesPlayed > 0 ? Number(((gamesWon / effectiveGamesPlayed) * 100).toFixed(2)) : 0;

    return {
      kda: computeKdaFromTotals(totals.eliminations, totals.assists, totals.deaths),
      winrate,
      games_played: effectiveGamesPlayed,
      games_won: gamesWon,
      games_lost: gamesLost,
      time_played_seconds: timePlayedSeconds,
      total: {
        eliminations: Number(totals.eliminations.toFixed(2)),
        assists: Number(totals.assists.toFixed(2)),
        deaths: Number(totals.deaths.toFixed(2)),
        damage: Number(totals.damage.toFixed(2)),
        healing: Number(totals.healing.toFixed(2)),
      },
      average: {
        eliminations: computePerTenAverage(totals.eliminations, timePlayedSeconds),
        assists: computePerTenAverage(totals.assists, timePlayedSeconds),
        deaths: computePerTenAverage(totals.deaths, timePlayedSeconds),
        damage: computePerTenAverage(totals.damage, timePlayedSeconds),
        healing: computePerTenAverage(totals.healing, timePlayedSeconds),
      },
    };
  };

  const aggregateRoleMetricsFromHeroes = (heroes) =>
    ["tank", "damage", "support", "flex"]
      .map((role) => {
        const roleHeroes = (heroes || []).filter((hero) => hero.hero_role === role);
        if (!roleHeroes.length) return null;
        const aggregate = aggregateMetricsFromHeroes(roleHeroes);
        if (aggregate.games_played <= 0 && aggregate.time_played_seconds <= 0) return null;
        return {
          role,
          ...aggregate,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        const timeDelta = numericValue(right.time_played_seconds) - numericValue(left.time_played_seconds);
        if (timeDelta !== 0) return timeDelta;
        return numericValue(right.games_played) - numericValue(left.games_played);
      });

  const getPreferredRoleFromRoles = (roles, rankSummary) => {
    const orderedRoles = [...(roles || [])].sort((left, right) => {
      const timeDelta = numericValue(right.time_played_seconds) - numericValue(left.time_played_seconds);
      if (timeDelta !== 0) return timeDelta;
      return numericValue(right.games_played) - numericValue(left.games_played);
    });
    if (orderedRoles.length && numericValue(orderedRoles[0].time_played_seconds) > 0) {
      return orderedRoles[0].role;
    }
    return rankSummary?.best_role || "flex";
  };

  const buildSeriesPoint = (timestamp, value, heroKey = "", heroName = "") => ({
    timestamp,
    value,
    hero_key: heroKey,
    hero_name: heroName,
  });

  const buildHeroSeriesFromSnapshots = (snapshots, heroKeys, metricKey, missingAsZero = false) =>
    (heroKeys || []).map((heroKey) => {
      const latestHero =
        [...((snapshots[snapshots.length - 1]?.heroes || []))].find((hero) => hero.hero_key === heroKey) || null;
      return {
        key: heroKey,
        name: latestHero?.hero_name || heroKey,
        series: (snapshots || []).map((snapshot) => {
          const hero = (snapshot.heroes || []).find((entry) => entry.hero_key === heroKey);
          let value = hero ? hero[metricKey] : null;
          if (missingAsZero && (value === null || value === undefined)) {
            value = 0;
          }
          return buildSeriesPoint(snapshot.captured_at, value, heroKey, hero?.hero_name || latestHero?.hero_name || "");
        }),
      };
    });

  const getWindowedSeries = (series, windowDays = 14, minimumPoints = 3, fallbackLastPoints = 4) => {
    const ordered = [...(series || [])]
      .filter((point) => point.value !== null && point.value !== undefined)
      .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

    if (!ordered.length) return [];
    if (ordered.length <= 1) return ordered;

    const latestTimestamp = new Date(ordered[ordered.length - 1].timestamp);
    const threshold = latestTimestamp.getTime() - windowDays * 24 * 60 * 60 * 1000;
    const windowed = ordered.filter((point) => new Date(point.timestamp).getTime() >= threshold);
    if (windowed.length < minimumPoints) {
      return ordered.slice(-Math.min(fallbackLastPoints, ordered.length));
    }

    return windowed;
  };

  const getTimeSeriesTrend = (series, flatSlopeThreshold, confidenceMultiplier = 1) => {
    const ordered = [...(series || [])]
      .filter((point) => point.value !== null && point.value !== undefined)
      .sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));

    if (ordered.length < 2) {
      return {
        direction: "flat",
        slope_per_day: 0,
        delta: 0,
        confidence: 0,
        span_days: 0,
        sample_count: ordered.length,
      };
    }

    const baseTime = new Date(ordered[0].timestamp).getTime();
    const pairs = ordered.map((point) => ({
      x: (new Date(point.timestamp).getTime() - baseTime) / (1000 * 60 * 60 * 24),
      y: Number(point.value),
    }));

    const xMean = pairs.reduce((sum, pair) => sum + pair.x, 0) / pairs.length;
    const yMean = pairs.reduce((sum, pair) => sum + pair.y, 0) / pairs.length;
    const denominator = pairs.reduce((sum, pair) => sum + (pair.x - xMean) ** 2, 0);
    let slope = 0;
    if (denominator !== 0) {
      const numerator = pairs.reduce((sum, pair) => sum + (pair.x - xMean) * (pair.y - yMean), 0);
      slope = numerator / denominator;
    }

    const delta = Number(ordered[ordered.length - 1].value) - Number(ordered[0].value);
    const spanDays =
      (new Date(ordered[ordered.length - 1].timestamp).getTime() - new Date(ordered[0].timestamp).getTime()) /
      (1000 * 60 * 60 * 24);
    const confidence =
      Math.min(1, ordered.length / 5) * Math.min(1, spanDays / 14) * numericValue(confidenceMultiplier, 1);

    let direction = "flat";
    if (Math.abs(slope) > flatSlopeThreshold && Math.abs(delta) > flatSlopeThreshold * Math.max(spanDays, 1)) {
      direction = slope > 0 ? "up" : "down";
    }

    return {
      direction,
      slope_per_day: Number(slope.toFixed(4)),
      delta: Number(delta.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      span_days: Number(spanDays.toFixed(2)),
      sample_count: ordered.length,
    };
  };

  const buildPlayerTrendFromSeries = (rankSeries, kdaSeries, winSeries, latestWideContext) => {
    const wideConfidenceMultiplier = latestWideContext === "mostly_wide" ? 0.65 : 1;
    const shortRankTrend = getTimeSeriesTrend(getWindowedSeries(rankSeries, 21, 2, 4), 0.04, wideConfidenceMultiplier);
    const mediumRankTrend = getTimeSeriesTrend(getWindowedSeries(rankSeries, 60, 2, 6), 0.03, wideConfidenceMultiplier);
    const shortKdaTrend = getTimeSeriesTrend(getWindowedSeries(kdaSeries, 21, 2, 4), 0.01, 1);
    const mediumKdaTrend = getTimeSeriesTrend(getWindowedSeries(kdaSeries, 60, 2, 6), 0.008, 1);
    const shortWinTrend = getTimeSeriesTrend(getWindowedSeries(winSeries, 21, 2, 4), 0.12, 1);
    const mediumWinTrend = getTimeSeriesTrend(getWindowedSeries(winSeries, 60, 2, 6), 0.08, 1);

    const signals = [];
    if (shortRankTrend.sample_count >= 2) {
      signals.push({
        weight: 0.4,
        score: Math.max(-1, Math.min(1, shortRankTrend.slope_per_day / 0.08)),
        confidence: shortRankTrend.confidence,
      });
    }
    if (shortKdaTrend.sample_count >= 2) {
      signals.push({
        weight: 0.35,
        score: Math.max(-1, Math.min(1, shortKdaTrend.slope_per_day / 0.02)),
        confidence: shortKdaTrend.confidence,
      });
    }
    if (shortWinTrend.sample_count >= 2) {
      signals.push({
        weight: 0.25,
        score: Math.max(-1, Math.min(1, shortWinTrend.slope_per_day / 0.2)),
        confidence: shortWinTrend.confidence,
      });
    }

    let weightedScore = 0;
    let weightSum = 0;
    signals.forEach((signal) => {
      const effectiveWeight = signal.weight * signal.confidence;
      weightedScore += signal.score * effectiveWeight;
      weightSum += effectiveWeight;
    });

    const compositeScore = weightSum > 0 ? weightedScore / weightSum : 0;
    const confidence =
      signals.length > 0
        ? Number((signals.reduce((sum, signal) => sum + numericValue(signal.confidence), 0) / signals.length).toFixed(3))
        : 0;

    let label = "flat";
    if (compositeScore >= 0.2) {
      label = "up";
    } else if (compositeScore <= -0.2) {
      label = "down";
    }

    let forecast = "likely stable";
    if (label === "up" && confidence >= 0.35) {
      forecast = "likely climbing";
    } else if (label === "down" && confidence >= 0.35) {
      forecast = "likely declining";
    }

    return {
      label,
      short: {
        rank: shortRankTrend,
        kda: shortKdaTrend,
        winrate: shortWinTrend,
      },
      medium: {
        rank: mediumRankTrend,
        kda: mediumKdaTrend,
        winrate: mediumWinTrend,
      },
      confidence,
      forecast,
      momentum: Number((compositeScore * confidence).toFixed(3)),
    };
  };

  const buildTrajectoryText = (displayName, trendLabel, latestSnapshot, rankLabel) => {
    const currentKda = Number(numericValue(latestSnapshot?.metrics?.kda).toFixed(2));
    const currentWinrate = Number(numericValue(latestSnapshot?.metrics?.winrate).toFixed(1));
    switch (trendLabel) {
      case "up":
        return `${displayName} is trending upward with a current KDA of ${currentKda} and win rate at ${currentWinrate}%. Rank reads as ${rankLabel}, and the recent direction is strong enough to project cautious improvement.`;
      case "down":
        return `${displayName} is sliding right now. KDA sits at ${currentKda}, win rate is ${currentWinrate}%, and rank context is ${rankLabel}. The next sessions should focus on stabilizing execution before expecting visible ladder gains.`;
      default:
        return `${displayName} looks mostly stable. KDA is ${currentKda}, win rate is ${currentWinrate}%, and current rank context is ${rankLabel}. Progress is present but not accelerating enough yet to read as a decisive climb.`;
    }
  };

  const getHeroHighlightsFromHeroes = (heroes) => {
    const nonOutlierHeroes = (heroes || []).filter(
      (hero) => numericValue(hero.games_played) > 0 && numericValue(hero.winrate) < 100
    );
    if (!nonOutlierHeroes.length) {
      return {
        best_kda_hero: null,
        best_winrate_hero: null,
      };
    }

    let qualifiedHeroes = nonOutlierHeroes.filter(
      (hero) => numericValue(hero.games_played) >= 3 || numericValue(hero.time_played_seconds) >= 900
    );
    if (!qualifiedHeroes.length) {
      qualifiedHeroes = nonOutlierHeroes.filter((hero) => numericValue(hero.games_played) > 0);
    }

    return {
      best_kda_hero: [...qualifiedHeroes].sort((left, right) => {
        const kdaDiff = numericValue(right.kda) - numericValue(left.kda);
        if (kdaDiff !== 0) return kdaDiff;
        const gamesDiff = numericValue(right.games_played) - numericValue(left.games_played);
        if (gamesDiff !== 0) return gamesDiff;
        return numericValue(right.time_played_seconds) - numericValue(left.time_played_seconds);
      })[0] || null,
      best_winrate_hero: [...qualifiedHeroes].sort((left, right) => {
        const winrateDiff = numericValue(right.winrate) - numericValue(left.winrate);
        if (winrateDiff !== 0) return winrateDiff;
        const gamesDiff = numericValue(right.games_played) - numericValue(left.games_played);
        if (gamesDiff !== 0) return gamesDiff;
        return numericValue(right.kda) - numericValue(left.kda);
      })[0] || null,
    };
  };

  const getStandardDeviation = (values) => {
    const numbers = (values || [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (!numbers.length) return 0;
    const mean = numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    const variance = numbers.reduce((sum, value) => sum + (value - mean) ** 2, 0) / numbers.length;
    return Math.sqrt(variance);
  };

  const getHeroRecommendationsFromSnapshots = (snapshots) => {
    const orderedSnapshots = [...(snapshots || [])].sort((left, right) => new Date(left.captured_at) - new Date(right.captured_at));
    if (!orderedSnapshots.length) {
      return { comfort: [], growth: [], avoid: [] };
    }

    const latestSnapshot = orderedSnapshots[orderedSnapshots.length - 1];
    const preferredRole = latestSnapshot?.preferred_role || getPreferredRoleFromRoles(latestSnapshot?.roles || [], latestSnapshot?.ranks || {});
    const heroKeys = [...(latestSnapshot?.heroes || [])]
      .sort((left, right) => numericValue(right.time_played_seconds) - numericValue(left.time_played_seconds))
      .map((hero) => hero.hero_key);
    const comfort = [];
    const growth = [];
    const avoid = [];

    heroKeys.forEach((heroKey) => {
      const latestHero = (latestSnapshot.heroes || []).find((hero) => hero.hero_key === heroKey);
      if (!latestHero) return;

      const kdaSeries = buildHeroSeriesFromSnapshots(orderedSnapshots, [heroKey], "kda", false)[0]?.series || [];
      const winSeries = buildHeroSeriesFromSnapshots(orderedSnapshots, [heroKey], "winrate", false)[0]?.series || [];
      const kdaTrend = getTimeSeriesTrend(getWindowedSeries(kdaSeries, 30, 2, 4), 0.01, 1);
      const winTrend = getTimeSeriesTrend(getWindowedSeries(winSeries, 30, 2, 4), 0.12, 1);

      const gamesPlayed = numericValue(latestHero.games_played);
      const timePlayed = numericValue(latestHero.time_played_seconds);
      const latestHeroKda = numericValue(latestHero.kda);
      const latestHeroWinrate = numericValue(latestHero.winrate);
      const latestHeroElims = numericValue(latestHero.average?.eliminations);
      const latestHeroDeaths = numericValue(latestHero.average?.deaths);

      const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
      const kdaNorm = clamp((latestHeroKda - 1.0) / 2.6);
      const winNorm = clamp((latestHeroWinrate - 45.0) / 25.0);
      const elimNorm = clamp(latestHeroElims / 20.0);
      const survivability = clamp((12.0 - latestHeroDeaths) / 6.0);
      const sampleNorm = clamp(Math.max(gamesPlayed / 20.0, timePlayed / 7200.0));
      let consistency = 0.55;
      const kdaValues = kdaSeries
        .map((point) => point.value)
        .filter((value) => value !== null && value !== undefined);
      if (kdaValues.length >= 3) {
        const kdaStd = getStandardDeviation(kdaValues);
        consistency = clamp(1.0 - kdaStd / Math.max(latestHeroKda, 1.0));
      }

      const trendNorm = clamp(0.5 + (kdaTrend.slope_per_day / 0.03) * 0.3 + (winTrend.slope_per_day / 0.3) * 0.2);
      const roleBonus = latestHero.hero_role === preferredRole ? 0.04 : 0.0;
      const score = Number(
        (
          kdaNorm * 0.25 +
          winNorm * 0.28 +
          elimNorm * 0.08 +
          survivability * 0.12 +
          sampleNorm * 0.12 +
          consistency * 0.07 +
          trendNorm * 0.08 +
          roleBonus
        ).toFixed(3)
      );

      const entry = {
        hero_key: heroKey,
        hero_name: latestHero.hero_name,
        hero_role: latestHero.hero_role,
        score,
        games_played: latestHero.games_played,
        time_played_seconds: latestHero.time_played_seconds,
        winrate: latestHero.winrate,
        kda: latestHero.kda,
        reason: "",
      };

      if ((gamesPlayed >= 8 || timePlayed >= 2400) && score >= 0.62) {
        entry.reason = "Strong sample, reliable KDA, and stable results.";
        comfort.push(entry);
        return;
      }

      if (
        (gamesPlayed >= 5 || timePlayed >= 1800) &&
        (score < 0.42 || (latestHeroWinrate < 45 && latestHeroKda < 1.25 && kdaTrend.direction === "down"))
      ) {
        entry.reason = "Low return from repeated usage compared with other options.";
        avoid.push(entry);
        return;
      }

      if ((gamesPlayed >= 3 || timePlayed >= 900) && (kdaTrend.direction === "up" || winTrend.direction === "up" || score >= 0.48)) {
        entry.reason = "Promising trend with enough recent reps to keep exploring.";
        growth.push(entry);
      }
    });

    return {
      comfort: comfort.sort((left, right) => numericValue(right.score) - numericValue(left.score)).slice(0, 3),
      growth: growth.sort((left, right) => numericValue(right.score) - numericValue(left.score)).slice(0, 3),
      avoid: avoid
        .sort((left, right) => {
          const scoreDelta = numericValue(left.score) - numericValue(right.score);
          if (scoreDelta !== 0) return scoreDelta;
          return numericValue(right.games_played) - numericValue(left.games_played);
        })
        .slice(0, 3),
    };
  };

  const filterRecommendations = (recommendations, hiddenHeroSet) => ({
    comfort: (recommendations?.comfort || []).filter((item) => !hiddenHeroSet.has(item.hero_key)),
    growth: (recommendations?.growth || []).filter((item) => !hiddenHeroSet.has(item.hero_key)),
    avoid: (recommendations?.avoid || []).filter((item) => !hiddenHeroSet.has(item.hero_key)),
  });

  const buildPlayerViewModel = (player, hiddenHeroKeys = [], excludedRunIds = []) => {
    const hiddenHeroSet = new Set(hiddenHeroKeys || []);
    const excludedRunSet = new Set(excludedRunIds || []);
    const baseCurrent = player?.current || {};
    const baseRanks = player?.ranks || { roles: [] };
    const rawSnapshots = [...(player.history_snapshots || [])]
      .filter((snapshot) => !excludedRunSet.has(snapshot.run_id))
      .sort((left, right) => new Date(left.captured_at) - new Date(right.captured_at));
    const latestAvailableHeroes = [...(rawSnapshots[rawSnapshots.length - 1]?.heroes || [])].sort((left, right) => {
      const timeDelta = numericValue(right.time_played_seconds) - numericValue(left.time_played_seconds);
      if (timeDelta !== 0) return timeDelta;
      return numericValue(right.games_played) - numericValue(left.games_played);
    });

    if (!rawSnapshots.length) {
      return {
        ...player,
        current: null,
        ranks: { roles: [] },
        roles: [],
        heroes: [],
        trend: {
          label: "flat",
          short: { rank: {}, kda: {}, winrate: {} },
          medium: { rank: {}, kda: {}, winrate: {} },
          confidence: 0,
          forecast: "no visible data",
          momentum: 0,
        },
        delta: { kda: 0, winrate: 0, rank_ordinal: 0 },
        highlights: { best_kda_hero: null, best_winrate_hero: null },
        recommendations: filterRecommendations(player.recommendations || { comfort: [], growth: [], avoid: [] }, hiddenHeroSet),
        narrative: `${player.display_name} has no visible snapshots after the current run filters.`,
        flags: ["All visible runs for this player are currently removed on the settings page."],
        top_heroes: [],
        series: {
          rank: [],
          rank_roles: [],
          kda: [],
          winrate: [],
          hero_usage: [],
          hero_performance: [],
        },
        available_heroes: [],
        active_hidden_hero_names: [],
        visible_snapshots: [],
        latest_snapshot: null,
        previous_snapshot: null,
        has_previous_snapshot: false,
        has_visible_snapshots: false,
      };
    }

    const snapshots = rawSnapshots.map((snapshot) => {
      const visibleHeroes = [...(snapshot.heroes || [])].filter((hero) => !hiddenHeroSet.has(hero.hero_key));
      const hasHeroDetails = (snapshot.heroes || []).length > 0;
      const metrics = hasHeroDetails ? aggregateMetricsFromHeroes(visibleHeroes) : snapshot.metrics || aggregateMetricsFromHeroes(visibleHeroes);
      const roles = hasHeroDetails ? aggregateRoleMetricsFromHeroes(visibleHeroes) : snapshot.roles || aggregateRoleMetricsFromHeroes(visibleHeroes);
      return {
        ...snapshot,
        heroes: visibleHeroes,
        metrics,
        roles,
        preferred_role: getPreferredRoleFromRoles(roles, snapshot.ranks),
      };
    });

    const latestSnapshot = snapshots[snapshots.length - 1] || null;
    const previousSnapshot = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;
    const rankSeries =
      player.series?.rank?.length
        ? player.series.rank
        : snapshots.map((snapshot) => buildSeriesPoint(snapshot.captured_at, snapshot.ranks?.average_ordinal ?? null));
    const rankRoleSeries =
      player.series?.rank_roles?.length
        ? player.series.rank_roles
        : ["tank", "damage", "support", "open"].map((role) => ({
            role,
            series: snapshots.map((snapshot) => {
              const rankEntry = (snapshot.ranks?.roles || []).find((entry) => entry.role === role);
              return buildSeriesPoint(snapshot.captured_at, rankEntry?.ordinal ?? null);
            }),
          }));
    const kdaSeries = snapshots.map((snapshot) =>
      buildSeriesPoint(
        snapshot.captured_at,
        numericValue(snapshot.metrics.games_played) > 0 || numericValue(snapshot.metrics.time_played_seconds) > 0
          ? snapshot.metrics.kda
          : null
      )
    );
    const winrateSeries = snapshots.map((snapshot) =>
      buildSeriesPoint(
        snapshot.captured_at,
        numericValue(snapshot.metrics.games_played) > 0 || numericValue(snapshot.metrics.time_played_seconds) > 0
          ? snapshot.metrics.winrate
          : null
      )
    );

    const topHeroKeys = [...(latestSnapshot?.heroes || [])]
      .sort((left, right) => numericValue(right.time_played_seconds) - numericValue(left.time_played_seconds))
      .slice(0, 4)
      .map((hero) => hero.hero_key);
    const heroUsageSeries = buildHeroSeriesFromSnapshots(snapshots, topHeroKeys, "time_played_seconds", true);
    const heroPerformanceSeries = buildHeroSeriesFromSnapshots(snapshots, topHeroKeys, "kda", false);
    const trend = buildPlayerTrendFromSeries(rankSeries, kdaSeries, winrateSeries, latestSnapshot?.wide_match_context || "mixed");
    const delta = {
      kda:
        latestSnapshot && previousSnapshot
          ? Number((numericValue(latestSnapshot.metrics.kda) - numericValue(previousSnapshot.metrics.kda)).toFixed(2))
          : 0,
      winrate:
        latestSnapshot && previousSnapshot
          ? Number((numericValue(latestSnapshot.metrics.winrate) - numericValue(previousSnapshot.metrics.winrate)).toFixed(2))
          : 0,
      rank_ordinal:
        latestSnapshot && previousSnapshot
          ? Number(
              (
                numericValue(latestSnapshot.ranks?.average_ordinal, 0) - numericValue(previousSnapshot.ranks?.average_ordinal, 0)
              ).toFixed(2)
            )
          : 0,
    };
    const highlights = getHeroHighlightsFromHeroes(latestSnapshot?.heroes || []);
    const recommendations = filterRecommendations(
      player.recommendations || getHeroRecommendationsFromSnapshots(snapshots),
      hiddenHeroSet
    );
    const activeHiddenHeroNames = latestAvailableHeroes
      .filter((hero) => hiddenHeroSet.has(hero.hero_key))
      .map((hero) => hero.hero_name);

    const flags = [
      ...(latestSnapshot?.wide_match_context === "mostly_wide" ? ["Mostly wide queue: visible rank changes may be muted."] : []),
      ...(trend.label === "down" && delta.kda < 0 ? ["Recent KDA dip needs review."] : []),
      ...(latestSnapshot?.fetch_status && latestSnapshot.fetch_status !== "success" ? ["Latest snapshot is partial."] : []),
      ...(latestSnapshot?.warnings || []),
      ...(activeHiddenHeroNames.length ? [`Local hero filter active: ${activeHiddenHeroNames.join(", ")}`] : []),
    ].filter(Boolean);

    const current = latestSnapshot
      ? {
          kda: latestSnapshot.metrics.kda,
          winrate: latestSnapshot.metrics.winrate,
          games_played: latestSnapshot.metrics.games_played,
          games_won: latestSnapshot.metrics.games_won,
          games_lost: latestSnapshot.metrics.games_lost,
          time_played_seconds: latestSnapshot.metrics.time_played_seconds,
          rank_label: latestSnapshot.ranks?.best_label || baseCurrent.rank_label || "Unranked",
          rank_ordinal: latestSnapshot.ranks?.average_ordinal ?? baseCurrent.rank_ordinal ?? null,
          rank_roles: latestSnapshot.ranks?.roles || baseCurrent.rank_roles || [],
          preferred_role: latestSnapshot.preferred_role || baseCurrent.preferred_role || "flex",
          best_rank_role: latestSnapshot.ranks?.best_role || baseCurrent.best_rank_role || "flex",
        }
      : baseCurrent;

    return {
      ...player,
      current,
      ranks: latestSnapshot?.ranks || baseRanks,
      roles: latestSnapshot?.roles || [],
      heroes: latestSnapshot?.heroes || [],
      trend,
      delta,
      highlights,
      recommendations,
      narrative: buildTrajectoryText(player.display_name, trend.label, latestSnapshot || { metrics: current }, current.rank_label),
      flags: [...new Set(flags)],
      top_heroes: [...(latestSnapshot?.heroes || [])].slice(0, 6),
      series: {
        rank: rankSeries,
        rank_roles: rankRoleSeries,
        kda: kdaSeries,
        winrate: winrateSeries,
        hero_usage: heroUsageSeries,
        hero_performance: heroPerformanceSeries,
      },
      available_heroes: latestAvailableHeroes,
      active_hidden_hero_names: activeHiddenHeroNames,
      visible_snapshots: snapshots,
      latest_snapshot: latestSnapshot,
      previous_snapshot: previousSnapshot,
      has_previous_snapshot: Boolean(previousSnapshot),
      has_visible_snapshots: true,
    };
  };

  const buildOverviewPlayerCardFromView = (view) => {
    const displayRole = view.current?.best_rank_role || view.current?.preferred_role || "flex";
    const filterTags = [
      view.trend.label,
      displayRole,
      view.current?.preferred_role || displayRole,
      view.delta.kda < 0 ? "falling-kda" : "steady-kda",
      view.trend.momentum > 0.18 ? "best-momentum" : "normal-momentum",
      view.flags.length ? "needs-review" : "clean",
      view.latest_snapshot?.wide_match_context === "mostly_wide" ? "wide-warning" : "standard-queue",
    ];

    return {
      slug: view.slug,
      href: view.href,
      display_name: view.display_name,
      player_id: view.player_id,
      avatar: view.profile?.avatar || view.avatar,
      title: view.profile?.title || view.title,
      preferred_role: displayRole,
      best_rank_role: view.current?.best_rank_role || view.ranks?.best_role || displayRole,
      top_heroes: (view.top_heroes || []).map((hero) => hero.hero_name || hero).filter(Boolean),
      customizations: view.customizations,
      current: {
        kda: view.current?.kda ?? 0,
        winrate: view.current?.winrate ?? 0,
        games_played: view.current?.games_played ?? 0,
        rank_label: view.current?.rank_label || "Unranked",
        rank_ordinal: view.current?.rank_ordinal ?? view.ranks?.average_ordinal ?? null,
        rank_roles: view.current?.rank_roles || [],
      },
      highlights: view.highlights,
      delta: view.delta,
      trend: {
        label: view.trend.label,
        confidence: view.trend.confidence,
        forecast: view.trend.forecast,
        momentum: view.trend.momentum,
      },
      narrative: view.narrative,
      flags: view.flags,
      warnings: view.warnings || [],
      has_previous_snapshot: view.has_previous_snapshot,
      filter_tags: filterTags,
      mini_series: {
        kda: view.series.kda,
        rank: view.series.rank,
      },
    };
  };

  const getTeamRoleOptionFromView = (view, role) => {
    const roleMetric = (view.roles || []).find((entry) => entry.role === role) || null;
    const rankMetric = (view.ranks?.roles || []).find((entry) => entry.role === role) || null;
    const gamesPlayed = numericValue(roleMetric?.games_played);
    const timePlayedSeconds = numericValue(roleMetric?.time_played_seconds);
    const kda = numericValue(roleMetric?.kda);
    const winrate = numericValue(roleMetric?.winrate);
    const rankOrdinal =
      rankMetric?.ordinal === null || rankMetric?.ordinal === undefined || Number.isNaN(Number(rankMetric?.ordinal))
        ? null
        : Number(rankMetric.ordinal);
    const rankLabel = rankMetric?.label || "Unranked";
    const eligible = gamesPlayed > 0 || timePlayedSeconds > 0 || rankOrdinal !== null;

    if (!eligible) {
      return {
        role,
        role_label: roleLabel(role),
        eligible: false,
        score: 0,
        kda: 0,
        winrate: 0,
        games_played: 0,
        time_played_seconds: 0,
        rank_label: "Unranked",
        rank_ordinal: null,
        explanation: "No visible competitive sample on this role yet.",
      };
    }

    const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
    const sampleNorm = clamp(Math.max(gamesPlayed / 25, timePlayedSeconds / 7200));
    const kdaNorm = clamp((kda - 1) / 2.5);
    const winNorm = clamp((winrate - 45) / 20);
    const rankNorm = rankOrdinal !== null ? clamp((rankOrdinal - 1) / 39) : 0.2;
    const trendNorm = view.trend.label === "up" ? 1 : view.trend.label === "flat" ? 0.6 : 0.35;

    let roleFitBonus = 0;
    if ((view.ranks?.best_role || view.current?.best_rank_role) === role) roleFitBonus += 0.06;
    if ((view.current?.preferred_role || view.ranks?.best_role) === role) roleFitBonus += 0.08;

    const score = Number(
      (
        kdaNorm * 0.34 +
        winNorm * 0.24 +
        sampleNorm * 0.18 +
        rankNorm * 0.18 +
        trendNorm * 0.06 +
        roleFitBonus
      ).toFixed(3)
    );

    const explanationParts = [];
    if (gamesPlayed > 0) explanationParts.push(`${gamesPlayed} games`);
    if (rankOrdinal !== null) explanationParts.push(`rank ${rankLabel}`);
    if (kda > 0) explanationParts.push(`${fmtNumber(kda, 2)} KDA`);

    return {
      role,
      role_label: roleLabel(role),
      eligible: true,
      score,
      kda,
      winrate,
      games_played: gamesPlayed,
      time_played_seconds: timePlayedSeconds,
      rank_label: rankLabel,
      rank_ordinal: rankOrdinal,
      explanation: explanationParts.join(" | "),
    };
  };

  const buildTeamOptimizerFromViews = (views, sourceOptimizer) => {
    const candidatePlayers = (views || []).map((view) => ({
      slug: view.slug,
      display_name: view.display_name,
      avatar: view.profile?.avatar || view.avatar,
      locked_role: normalizeRoleLock(view.customizations?.locked_role || ""),
      hidden_hero_names: view.customizations?.hidden_hero_names || [],
      trend_label: view.trend.label,
      role_options: {
        tank: getTeamRoleOptionFromView(view, "tank"),
        damage: getTeamRoleOptionFromView(view, "damage"),
        support: getTeamRoleOptionFromView(view, "support"),
      },
    }));

    return {
      composition_rules: { tank: 1, damage: 2, support: 2 },
      candidate_players: candidatePlayers,
      default_locks: candidatePlayers
        .filter((player) => player.locked_role)
        .map((player) => ({
          slug: player.slug,
          display_name: player.display_name,
          role: player.locked_role,
          role_label: roleLabel(player.locked_role),
        })),
      default_result: computeOptimizerResult(
        {
          candidate_players: candidatePlayers,
          warnings: [],
        },
        Object.fromEntries(candidatePlayers.filter((player) => player.locked_role).map((player) => [player.slug, player.locked_role]))
      ),
      warnings: [],
      wide_rule_summary:
        sourceOptimizer?.wide_rule_summary ||
        "Blizzard marks groups as Wide when Diamond-or-lower spreads exceed 5 divisions, Masters spreads exceed 3, or any Grandmaster or Champion role rank is present.",
      wide_rule_source_url: sourceOptimizer?.wide_rule_source_url || "",
    };
  };

  const buildHeroPoolSummaryFromViews = (views) => {
    const heroPoolLookup = new Map();

    (views || []).forEach((view) => {
      const seasonHeroes = [...(view.heroes || [])]
        .filter(
          (hero) =>
            numericValue(hero.season_games_played, numericValue(hero.games_played)) > 0 ||
            numericValue(hero.season_time_played_seconds, numericValue(hero.time_played_seconds)) > 0
        )
        .sort((left, right) => {
          const timeDelta =
            numericValue(right.season_time_played_seconds, numericValue(right.time_played_seconds)) -
            numericValue(left.season_time_played_seconds, numericValue(left.time_played_seconds));
          if (timeDelta !== 0) return timeDelta;
          const gamesDelta =
            numericValue(right.season_games_played, numericValue(right.games_played)) -
            numericValue(left.season_games_played, numericValue(left.games_played));
          if (gamesDelta !== 0) return gamesDelta;
          return String(left.hero_name || "").localeCompare(String(right.hero_name || ""));
        })
        .slice(0, 5);

      seasonHeroes.forEach((hero) => {
        if (!heroPoolLookup.has(hero.hero_key)) {
          heroPoolLookup.set(hero.hero_key, {
            hero_key: hero.hero_key,
            hero_name: hero.hero_name,
            total_time_played_seconds: 0,
            player_count: 0,
          });
        }
        const current = heroPoolLookup.get(hero.hero_key);
        current.total_time_played_seconds += numericValue(hero.season_time_played_seconds, numericValue(hero.time_played_seconds));
        current.player_count += 1;
      });
    });

    return [...heroPoolLookup.values()].sort((left, right) => {
      const timeDelta = numericValue(right.total_time_played_seconds) - numericValue(left.total_time_played_seconds);
      if (timeDelta !== 0) return timeDelta;
      const playerDelta = numericValue(right.player_count) - numericValue(left.player_count);
      if (playerDelta !== 0) return playerDelta;
      return String(left.hero_name || "").localeCompare(String(right.hero_name || ""));
    });
  };

  const buildOverviewView = (payload, excludedRunIds = [], hiddenPlayerSlugs = []) => {
    const hiddenPlayerSet = new Set(hiddenPlayerSlugs || []);
    const sourceRuns = [...(payload.settings?.runs || [])].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
    const visibleRunSet = new Set(sourceRuns.filter((run) => !excludedRunIds.includes(run.run_id)).map((run) => run.run_id));
    const visibleViews = (payload.players || [])
      .map((player) => buildPlayerViewModel(player, [], excludedRunIds))
      .filter((view) => view.has_visible_snapshots && !hiddenPlayerSet.has(view.slug));
    const playerCards = visibleViews.map((view) => buildOverviewPlayerCardFromView(view));
    const latestSnapshots = visibleViews.map((view) => view.latest_snapshot).filter(Boolean);
    const visibleRuns = sourceRuns.filter((run) => visibleRunSet.has(run.run_id));
    const getSnapshotAtOrBeforeRun = (view, runTimestamp) => {
      const snapshots = [...(view.visible_snapshots || [])]
        .filter((snapshot) => new Date(snapshot.captured_at).getTime() <= runTimestamp)
        .sort((left, right) => new Date(left.captured_at) - new Date(right.captured_at));
      return snapshots.length ? snapshots[snapshots.length - 1] : null;
    };

    const teamSeries = visibleRuns
      .map((run) => {
        const runTimestamp = new Date(run.timestamp).getTime();
        const runSnapshots = visibleViews
          .map((view) => getSnapshotAtOrBeforeRun(view, runTimestamp))
          .filter(Boolean);
        if (!runSnapshots.length) return null;
        const avg = (values) => {
          const valid = values.filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value))).map(Number);
          if (!valid.length) return null;
          return valid.reduce((sum, value) => sum + value, 0) / valid.length;
        };
        return {
          timestamp: run.timestamp,
          run_id: run.run_id,
          avg_kda: Number(avg(runSnapshots.map((snapshot) => snapshot.metrics?.kda))?.toFixed(3) || 0),
          avg_winrate: Number(avg(runSnapshots.map((snapshot) => snapshot.metrics?.winrate))?.toFixed(3) || 0),
          avg_rank:
            avg(runSnapshots.map((snapshot) => snapshot.ranks?.average_ordinal)) === null
              ? null
              : Number(avg(runSnapshots.map((snapshot) => snapshot.ranks?.average_ordinal)).toFixed(3)),
          player_count: runSnapshots.length,
        };
      })
      .filter(Boolean);

    const latestVisibleRun = teamSeries.length
      ? visibleRuns.find((run) => run.run_id === teamSeries[teamSeries.length - 1].run_id) || visibleRuns[visibleRuns.length - 1]
      : visibleRuns[visibleRuns.length - 1] || null;
    const freshSnapshots = latestVisibleRun
      ? latestSnapshots.filter((snapshot) => snapshot.run_id === latestVisibleRun.run_id).length
      : 0;

    const teamAverageKda =
      latestSnapshots.length > 0
        ? latestSnapshots.reduce((sum, snapshot) => sum + numericValue(snapshot.metrics?.kda), 0) / latestSnapshots.length
        : null;
    const latestRankOrdinals = latestSnapshots
      .map((snapshot) => snapshot.ranks?.average_ordinal)
      .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
      .map(Number);
    const teamAverageRankOrdinal = latestRankOrdinals.length
      ? latestRankOrdinals.reduce((sum, value) => sum + value, 0) / latestRankOrdinals.length
      : null;
    const teamAverageRankLabel = formatRankLabelFromOrdinal(teamAverageRankOrdinal);
    const roleDistribution = ["tank", "damage", "support", "flex"].map((role) => ({
      role,
      count: latestSnapshots.filter((snapshot) => (snapshot.ranks?.best_role || snapshot.preferred_role || "flex") === role).length,
    }));
    const watchlist = playerCards.filter((player) => player.trend.label === "down" || (player.flags || []).length > 0).slice(0, 6);

    return {
      meta: {
        ...payload.meta,
        latest_run: latestVisibleRun
          ? {
              run_id: latestVisibleRun.run_id,
              timestamp: latestVisibleRun.timestamp,
              notes: latestVisibleRun.notes || "",
              wide_match_context: latestVisibleRun.wide_match_context || payload.meta.latest_run.wide_match_context,
            }
          : payload.meta.latest_run,
        fresh_snapshots: freshSnapshots,
      },
      overview: {
        stat_cards: [
          { label: "Visible players", value: `${visibleViews.length}/${payload.meta.total_tracked_players}`, accent: "sky" },
          { label: "Fresh snapshots", value: freshSnapshots, accent: "mint" },
          { label: "Team avg KDA", value: teamAverageKda === null ? "n/a" : fmtNumber(teamAverageKda, 2), accent: "amber" },
          { label: "Team avg rank", value: teamAverageRankLabel, accent: "rose" },
        ],
        trend_counts: {
          up: playerCards.filter((player) => player.trend.label === "up").length,
          flat: playerCards.filter((player) => player.trend.label === "flat").length,
          down: playerCards.filter((player) => player.trend.label === "down").length,
        },
        current_rank_summary: {
          average_label: teamAverageRankLabel,
          average_ordinal: teamAverageRankOrdinal,
          role_distribution: roleDistribution,
        },
        team_series: {
          kda: teamSeries.map((entry) => ({ timestamp: entry.timestamp, value: entry.avg_kda })),
          rank: teamSeries.map((entry) => ({ timestamp: entry.timestamp, value: entry.avg_rank })),
          winrate: teamSeries.map((entry) => ({ timestamp: entry.timestamp, value: entry.avg_winrate })),
        },
        comparison: playerCards.map((player) => ({
          slug: player.slug,
          display_name: player.display_name,
          kda: player.current.kda,
          winrate: player.current.winrate,
          rank_ordinal: player.current.rank_ordinal,
          preferred_role: player.preferred_role,
          trend_label: player.trend.label,
        })),
        biggest_movers: [...playerCards]
          .sort(
            (left, right) =>
              Math.abs(right.delta.kda) +
              Math.abs(right.delta.rank_ordinal) * 0.35 +
              Math.abs(right.delta.winrate) * 0.04 -
              (Math.abs(left.delta.kda) + Math.abs(left.delta.rank_ordinal) * 0.35 + Math.abs(left.delta.winrate) * 0.04)
          )
          .slice(0, 5),
        strongest_momentum: [...playerCards].sort((left, right) => right.trend.momentum - left.trend.momentum).slice(0, 5),
        watchlist,
        role_distribution: roleDistribution,
        hero_pool_summary: buildHeroPoolSummaryFromViews(visibleViews).slice(0, 10),
        players: playerCards,
        team_optimizer: buildTeamOptimizerFromViews(visibleViews, payload.overview?.team_optimizer),
      },
      players: payload.players,
      settings: payload.settings,
      removed_runs: excludedRunIds,
      hidden_players: hiddenPlayerSlugs,
    };
  };

  const renderPlayer = ({ meta, player }) => {
    const storageKey = buildPlayerHiddenHeroStorageKey(meta, player.slug);
    let hiddenHeroKeys = [];
    try {
      hiddenHeroKeys = JSON.parse(localStorage.getItem(storageKey) || "[]");
    } catch (error) {
      hiddenHeroKeys = [];
    }
    hiddenHeroKeys = [...new Set((hiddenHeroKeys || []).filter(Boolean))];

    const persistHiddenHeroes = () => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(hiddenHeroKeys));
      } catch (error) {
      }
    };

    const draw = () => {
      const removedRunIds = getStoredRemovedRuns(meta);
      const view = buildPlayerViewModel(player, hiddenHeroKeys, removedRunIds);
      const latestCapturedAt = view.latest_snapshot?.captured_at || player.latest_run.captured_at;
      const latestQueueContext = view.latest_snapshot?.wide_match_context || player.latest_run.wide_match_context;
      const sourceStatus = getDataSourceStatus(meta);

      document.getElementById("player-meta").innerHTML = `
        <div class="meta-line"><span class="badge ${escapeHtml(sourceStatus.className)}">${escapeHtml(sourceStatus.label)}</span></div>
        <div class="meta-line">${escapeHtml(sourceStatus.detail)}</div>
        <div class="meta-line">Captured ${escapeHtml(fmtDate(latestCapturedAt))}</div>
        <div class="meta-line">Scope: competitive-only</div>
        <div class="meta-line">Forecast: ${escapeHtml(view.trend.forecast)}</div>
        <div class="meta-line">Confidence: ${escapeHtml(fmtPercent(view.trend.confidence * 100, 0))}</div>
        <div class="meta-line">Queue context: ${escapeHtml(latestQueueContext)}</div>
        ${meta.live_refresh_message ? `<div class="meta-line">${escapeHtml(meta.live_refresh_message)}</div>` : ""}
        <div class="meta-line">Removed runs active: ${escapeHtml(removedRunIds.length)}</div>
      `;

      const lede = document.getElementById("player-lede");
      if (lede) {
        lede.textContent = view.has_visible_snapshots
          ? `Current KDA ${fmtNumber(view.current.kda, 2)} | Forecast: ${view.trend.forecast}`
          : "All visible runs for this player are currently removed on the settings page.";
      }

      if (!view.has_visible_snapshots || !view.current) {
        document.getElementById("player-summary").innerHTML = `
          <div class="summary-card" style="grid-column:1 / -1">
            <div class="metric-label">No Visible Snapshots</div>
            <strong>Player hidden by run filters</strong>
            <div class="card-note">Open the settings page and restore at least one run for this player to rebuild the charts.</div>
          </div>
        `;
        [
          "player-rank-chart",
          "player-kda-chart",
          "player-winrate-chart",
          "player-role-chart",
          "player-hero-usage-chart",
          "player-hero-performance-chart",
        ].forEach((id) => emptyState(document.getElementById(id), "Restore a removed run on the settings page to see this chart again."));
        document.getElementById("player-recommendations").innerHTML = `<div class="meta-line">Recommendations return when at least one visible run remains.</div>`;
        document.getElementById("player-trajectory").innerHTML = `<div class="flag-chip">All visible runs for this player are currently removed on the settings page.</div>`;
        document.getElementById("player-hero-leaderboards").innerHTML = `<div class="meta-line">Hero leaderboards return when at least one visible run remains.</div>`;
        document.getElementById("player-hero-controls").innerHTML = `
          <div class="hero-filter-shell">
            <div class="meta-line">Restore a run on the settings page first, then hero filters will be available again.</div>
            <a class="nav-link" href="../settings.html">Open Settings</a>
          </div>
        `;
        return;
      }

      document.getElementById("player-summary").innerHTML = `
        <div class="summary-card">
          <div class="metric-label">${withInfo(
            "Current KDA",
            "Kills plus assists divided by deaths in the latest tracked snapshot."
          )}</div>
          <strong>${fmtNumber(view.current.kda, 2)}</strong>
          <div class="${getDeltaClass(view.delta.kda, view.has_previous_snapshot)}">${escapeHtml(
            renderSnapshotDelta(view.delta.kda, 2, "since last snapshot", view.has_previous_snapshot)
          )}</div>
        </div>
        <div class="summary-card">
          <div class="metric-label">${withInfo(
            "Current Win Rate",
            "Percentage of tracked games won in the latest snapshot."
          )}</div>
          <strong>${fmtPercent(view.current.winrate, 1)}</strong>
          <div class="${getDeltaClass(view.delta.winrate, view.has_previous_snapshot)}">${escapeHtml(
            renderSnapshotDelta(view.delta.winrate, 1, "pts since last snapshot", view.has_previous_snapshot)
          )}</div>
        </div>
        <div class="summary-card">
          <div class="metric-label">${withInfo(
            "Current Rank Summary",
            "Best currently visible competitive role rank pulled from the latest snapshot."
          )}</div>
          <strong>${escapeHtml(view.current.rank_label)}</strong>
          <div class="${view.delta.rank_ordinal >= 0 ? "delta-up" : "delta-down"}">${escapeHtml(
            roleLabel(view.current.best_rank_role || view.current.preferred_role)
          )} lead role</div>
        </div>
        <div class="summary-card">
          <div class="metric-label">${withInfo(
            "Volume",
            "How much tracked play exists in the latest snapshot, shown as total games and total time."
          )}</div>
          <strong>${escapeHtml(view.current.games_played)}</strong>
          <div class="card-note">${fmtHours(view.current.time_played_seconds)} played</div>
        </div>
        <div class="summary-card" style="grid-column:1 / -1">
          <div class="metric-label">${withInfo(
            "Ranks By Role",
            "Visible competitive ranks for tank, DPS, and support from the latest snapshot."
          )}</div>
          <div class="hero-list">${renderRankPills(view.current.rank_roles)}</div>
        </div>
      `;

      document.getElementById("player-hero-controls").innerHTML = `
        <div class="hero-filter-shell">
          <div class="hero-filter-head">
            <div class="meta-line">Tick a box to hide that hero from this player's page. Saved in this browser.</div>
            <button type="button" class="filter-chip" data-reset-hidden-heroes="true">Reset Hidden Heroes</button>
          </div>
          <div class="hero-filter-actions">
            <button type="button" class="filter-chip" data-hide-role="tank">Tank Heroes</button>
            <button type="button" class="filter-chip" data-hide-role="damage">DPS Heroes</button>
            <button type="button" class="filter-chip" data-hide-role="support">Support Heroes</button>
          </div>
          ${
            view.active_hidden_hero_names.length
              ? `<div class="hero-list">${view.active_hidden_hero_names
                  .map((hero) => `<span class="flag-chip">Hidden: ${escapeHtml(hero)}</span>`)
                  .join("")}</div>`
              : ""
          }
          <div class="hero-filter-grid">
            ${view.available_heroes
              .map(
                (hero) => `
                  <label class="hero-filter-card ${hiddenHeroKeys.includes(hero.hero_key) ? "hidden" : ""}">
                    <span class="hero-filter-toggle">
                      <input type="checkbox" data-hide-hero="${escapeHtml(hero.hero_key)}" ${
                        hiddenHeroKeys.includes(hero.hero_key) ? "checked" : ""
                      }>
                      <span>
                        <span class="hero-filter-name">${escapeHtml(hero.hero_name)}</span>
                        <span class="meta-line">${escapeHtml(roleLabel(hero.hero_role))} | ${fmtHours(hero.time_played_seconds)} | ${
                          hero.games_played
                        } games</span>
                      </span>
                    </span>
                  </label>
                `
              )
              .join("")}
          </div>
        </div>
      `;

      const rankChartContainer = document.getElementById("player-rank-chart");
      const latestVisibleRankSeason = [...(view.visible_snapshots || [])]
        .reverse()
        .find((snapshot) => snapshot.ranks?.season !== null && snapshot.ranks?.season !== undefined)?.ranks?.season;
      const rankSnapshots =
        latestVisibleRankSeason === null || latestVisibleRankSeason === undefined
          ? [...(view.visible_snapshots || [])]
          : (view.visible_snapshots || []).filter(
              (snapshot) => Number(snapshot.ranks?.season) === Number(latestVisibleRankSeason)
            );

      const buildRankTickValues = (series) => {
        const ordinals = [...new Set(
          (series || [])
            .map((point) => Number(point.value))
            .filter((value) => Number.isFinite(value))
        )].sort((left, right) => left - right);

        if (ordinals.length <= 8) {
          return ordinals;
        }

        const min = ordinals[0];
        const max = ordinals[ordinals.length - 1];
        const stepped = Array.from({ length: 6 }, (_, index) => {
          const ratio = index / 5;
          return Math.round(min + (max - min) * ratio);
        });
        return [...new Set(stepped)].sort((left, right) => left - right);
      };

      const rankSeriesDefs = ["tank", "damage", "support"]
        .map((role, index) => ({
          role,
          color: palette[index % palette.length],
          series: rankSnapshots.map((snapshot) => {
            const rankEntry = (snapshot.ranks?.roles || []).find((entry) => entry.role === role);
            return buildSeriesPoint(snapshot.captured_at, rankEntry?.ordinal ?? null);
          }),
        }))
        .filter((definition) => definition.series.some((point) => point.value !== null && point.value !== undefined))
        .map((definition) => ({
          name: roleLabel(definition.role),
          color: definition.color,
          series: definition.series,
        }));

      if (rankSeriesDefs.length) {
        const allRankPoints = rankSeriesDefs.flatMap((definition) => definition.series);
        renderLineChart(rankChartContainer, rankSeriesDefs, {
          tickFormatter: (value) => formatRankLabelFromOrdinal(value),
          pointFormatter: (value) => formatRankLabelFromOrdinal(value),
          tickValues: buildRankTickValues(allRankPoints),
          connectGaps: false,
          xLabel: "Snapshot Time",
          yLabel: "Competitive Rank",
          emptyMessage: "Competitive ranks will appear here when available.",
        });
      } else {
        emptyState(rankChartContainer, "Competitive ranks will appear here when available.");
      }

      renderLineChart(
        document.getElementById("player-kda-chart"),
        [{ name: "KDA", series: view.series.kda, color: palette[0] }],
        {
          tickFormatter: (value) => fmtNumber(value, 1),
          pointFormatter: (value) => fmtNumber(value, 2),
          xLabel: "Snapshot Time",
          yLabel: "KDA",
          emptyMessage: "Hide fewer heroes or collect more snapshots to restore the KDA trend.",
        }
      );

      renderLineChart(
        document.getElementById("player-winrate-chart"),
        [{ name: "Win Rate", series: view.series.winrate, color: palette[2] }],
        {
          tickFormatter: (value) => fmtPercent(value, 0),
          pointFormatter: (value) => fmtPercent(value, 1),
          xLabel: "Snapshot Time",
          yLabel: "Win Rate",
          emptyMessage: "Hide fewer heroes or collect more snapshots to restore the win-rate trend.",
        }
      );

      renderBarChart(
        document.getElementById("player-role-chart"),
        (view.roles || []).map((role) => ({
          label: roleLabel(role.role),
          value: role.kda,
          display: `${fmtNumber(role.kda, 2)} KDA - ${fmtHours(role.time_played_seconds)}`,
        })),
        {
          emptyMessage: "Role data appears once at least one visible hero remains.",
          xLabel: "KDA",
          yLabel: "Roles",
        }
      );

      renderLineChart(
        document.getElementById("player-hero-usage-chart"),
        (view.series.hero_usage || []).map((series, index) => ({
          name: series.name,
          color: palette[index % palette.length],
          series: series.series,
        })),
        {
          tickFormatter: (value) => fmtNumber(value / 3600, 1),
          pointFormatter: (value) => fmtHours(value),
          xLabel: "Snapshot Time",
          yLabel: "Hours Played",
          emptyMessage: "Hero usage needs at least one visible hero across snapshots.",
        }
      );

      renderLineChart(
        document.getElementById("player-hero-performance-chart"),
        (view.series.hero_performance || []).map((series, index) => ({
          name: series.name,
          color: palette[index % palette.length],
          series: series.series,
        })),
        {
          tickFormatter: (value) => fmtNumber(value, 1),
          pointFormatter: (value) => fmtNumber(value, 2),
          xLabel: "Snapshot Time",
          yLabel: "Hero KDA",
          emptyMessage: "Hero performance fills in once repeated visible hero snapshots exist.",
        }
      );

      document.getElementById("player-recommendations").innerHTML = `
        <div class="recommendation-columns">
          ${renderRecommendationColumn("Comfort Pick", view.recommendations.comfort)}
          ${renderRecommendationColumn("Growth Pick", view.recommendations.growth)}
          ${renderRecommendationColumn("Avoid For Now", view.recommendations.avoid)}
        </div>
      `;

      document.getElementById("player-trajectory").innerHTML = `
        <div class="badge ${escapeHtml(view.trend.label)}">${escapeHtml(view.trend.forecast)}</div>
        <div class="trajectory-copy">${escapeHtml(view.narrative)}</div>
        <div class="hero-list">
          ${renderHeroHighlights(view.highlights)}
        </div>
        <div class="rank-list">
          ${(view.ranks.roles || [])
            .map(
              (rank) =>
                `<div class="rank-row"><span>${escapeHtml(roleLabel(rank.role))}</span><span class="rank-pill">${escapeHtml(rank.label)}</span></div>`
            )
            .join("")}
        </div>
        <div class="hero-list">
          ${(view.flags || []).map((flag) => `<span class="flag-chip">${escapeHtml(flag)}</span>`).join("")}
        </div>
        <div class="hero-list">
          ${(view.top_heroes || []).map((hero) => `<span class="hero-chip">${escapeHtml(hero.hero_name)}</span>`).join("")}
        </div>
      `;

      const rankedHeroes = filterRankedHeroes(view.heroes || []);
      const bestKdaHeroes = [...rankedHeroes]
        .sort((left, right) => {
          const kdaDiff = Number(right.kda || 0) - Number(left.kda || 0);
          if (kdaDiff !== 0) return kdaDiff;
          const gamesDiff = Number(right.games_played || 0) - Number(left.games_played || 0);
          if (gamesDiff !== 0) return gamesDiff;
          return Number(right.time_played_seconds || 0) - Number(left.time_played_seconds || 0);
        })
        .slice(0, 10);

      const bestWinrateHeroes = [...rankedHeroes]
        .sort((left, right) => {
          const winrateDiff = Number(right.winrate || 0) - Number(left.winrate || 0);
          if (winrateDiff !== 0) return winrateDiff;
          const gamesDiff = Number(right.games_played || 0) - Number(left.games_played || 0);
          if (gamesDiff !== 0) return gamesDiff;
          return Number(right.kda || 0) - Number(left.kda || 0);
        })
        .slice(0, 10);

      document.getElementById("player-hero-leaderboards").innerHTML = `
        ${renderHeroLeaderboardColumn("Best Heroes By KDA", bestKdaHeroes, (hero) => `${fmtNumber(hero.kda, 2)} KDA`)}
        ${renderHeroLeaderboardColumn("Best Heroes By Win Rate", bestWinrateHeroes, (hero) => `${fmtPercent(hero.winrate, 1)}`)}
      `;

      const resetButton = document.querySelector("[data-reset-hidden-heroes]");
      if (resetButton) {
        resetButton.addEventListener("click", () => {
          hiddenHeroKeys = [];
          persistHiddenHeroes();
          draw();
        });
      }

      document.querySelectorAll("[data-hide-hero]").forEach((checkbox) => {
        checkbox.addEventListener("change", (event) => {
          const heroKey = event.target.getAttribute("data-hide-hero");
          if (!heroKey) return;
          if (event.target.checked) {
            hiddenHeroKeys = [...new Set([...hiddenHeroKeys, heroKey])];
          } else {
            hiddenHeroKeys = hiddenHeroKeys.filter((entry) => entry !== heroKey);
          }
          persistHiddenHeroes();
          draw();
        });
      });

      document.querySelectorAll("[data-hide-role]").forEach((button) => {
        button.addEventListener("click", (event) => {
          const role = event.currentTarget.getAttribute("data-hide-role");
          const roleHeroKeys = (view.available_heroes || [])
            .filter((hero) => hero.hero_role === role)
            .map((hero) => hero.hero_key);
          if (!roleHeroKeys.length) {
            return;
          }

          const allRoleHeroesHidden = roleHeroKeys.every((heroKey) => hiddenHeroKeys.includes(heroKey));
          if (allRoleHeroesHidden) {
            hiddenHeroKeys = hiddenHeroKeys.filter((heroKey) => !roleHeroKeys.includes(heroKey));
          } else {
            hiddenHeroKeys = [...new Set([...hiddenHeroKeys, ...roleHeroKeys])];
          }

          persistHiddenHeroes();
          draw();
        });
      });
    };

    draw();
  };

  const renderSettings = (payload) => {
    const { meta } = payload;
    const removalMode = payload.settings?.removal_mode || "browser-local";
    const hideOnlyMode = removalMode === "hide-only";
    let removedRunIds = getStoredRemovedRuns(meta);

    const draw = () => {
      const runs = [...(payload.settings?.runs || [])].sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp));
      const removedRunSet = new Set(removedRunIds);
      const visibleCount = runs.filter((run) => !removedRunSet.has(run.run_id)).length;
      const latestVisibleRun = runs.find((run) => !removedRunSet.has(run.run_id)) || null;
      const sourceStatus = getDataSourceStatus(meta);

      document.getElementById("settings-meta").innerHTML = `
        <div class="meta-line"><span class="badge ${escapeHtml(sourceStatus.className)}">${escapeHtml(sourceStatus.label)}</span></div>
        <div class="meta-line">${escapeHtml(sourceStatus.detail)}</div>
        <div class="meta-line">Team: ${escapeHtml(meta.team_name)}</div>
        <div class="meta-line">Total snapshots: ${escapeHtml(runs.length)}</div>
        <div class="meta-line">Visible snapshots: ${escapeHtml(visibleCount)}</div>
        <div class="meta-line">Hidden snapshots: ${escapeHtml(removedRunIds.length)}</div>
        ${meta.live_refresh_message ? `<div class="meta-line">${escapeHtml(meta.live_refresh_message)}</div>` : ""}
        <div class="meta-line">Latest visible snapshot: ${escapeHtml(latestVisibleRun?.run_id || "n/a")}</div>
      `;

      document.getElementById("settings-summary").innerHTML = `
        <div class="summary-card">
          <div class="metric-label">Saved Snapshots</div>
          <strong>${escapeHtml(runs.length)}</strong>
          <div class="card-note">Every manual snapshot currently on disk.</div>
        </div>
        <div class="summary-card">
          <div class="metric-label">Visible Snapshots</div>
          <strong>${escapeHtml(visibleCount)}</strong>
          <div class="card-note">Snapshots currently shown in the report.</div>
        </div>
        <div class="summary-card">
          <div class="metric-label">Hidden Snapshots</div>
          <strong>${escapeHtml(removedRunIds.length)}</strong>
          <div class="card-note">Hidden from this browser's report view.</div>
        </div>
        <div class="summary-card">
          <div class="metric-label">Latest Visible Snapshot</div>
          <strong>${escapeHtml(latestVisibleRun?.run_id || "n/a")}</strong>
          <div class="card-note">${escapeHtml(
            latestVisibleRun ? fmtDate(latestVisibleRun.timestamp) : "Restore a snapshot to rebuild the overview."
          )}</div>
        </div>
      `;

      document.getElementById("settings-run-list").innerHTML = runs.length
        ? runs
            .map(
              (run) => `
                <div class="settings-run-card ${removedRunSet.has(run.run_id) ? "removed" : ""}">
                  <div class="settings-run-head">
                    <div>
                      <strong>${escapeHtml(run.run_id)}</strong>
                      <div class="meta-line">${escapeHtml(fmtDate(run.timestamp))}</div>
                    </div>
                    <span class="badge ${removedRunSet.has(run.run_id) ? "down" : "up"}">${
                      removedRunSet.has(run.run_id) ? "hidden" : "visible"
                    }</span>
                  </div>
                  <label class="hero-filter-toggle">
                    <input type="checkbox" data-toggle-run="${escapeHtml(run.run_id)}" ${
                      removedRunSet.has(run.run_id) ? "checked" : ""
                    }>
                    <span>
                      <span class="hero-filter-name">Hide this snapshot from the report</span>
                      <span class="meta-line">This is instant and browser-saved. You can restore it any time.</span>
                    </span>
                  </label>
                  <div class="hero-actions">
                    <button type="button" class="filter-chip" data-toggle-run-button="${escapeHtml(run.run_id)}">${
                      removedRunSet.has(run.run_id) ? "Show Snapshot" : "Hide Snapshot"
                    }</button>
                    ${
                      hideOnlyMode
                        ? ""
                        : `<button type="button" class="filter-chip" data-copy-delete-command="${escapeHtml(run.run_id)}">Copy Delete Command</button>`
                    }
                  </div>
                  <div class="meta-line">${
                    hideOnlyMode
                      ? "This mode is hide-only because the hosted database remains the source of truth."
                      : "Permanent delete needs a PowerShell command because the static HTML page cannot remove local files directly."
                  }</div>
                  <div class="detail-list">
                    <div class="detail-row">
                      <span>Queue context</span>
                      <span>${escapeHtml(run.wide_match_context || "mixed")}</span>
                    </div>
                    <div class="detail-row">
                      <span>Snapshots captured</span>
                      <span>${escapeHtml(run.snapshot_count || 0)}</span>
                    </div>
                    <div class="detail-row">
                      <span>Failed lookups</span>
                      <span>${escapeHtml(run.failed_player_count || 0)}</span>
                    </div>
                  </div>
                  ${
                    run.notes
                      ? `<div class="meta-line">Notes: ${escapeHtml(run.notes)}</div>`
                      : ""
                  }
                  ${
                    (run.player_display_names || []).length
                      ? `<div class="hero-list">${run.player_display_names
                          .map((playerName) => `<span class="hero-chip">${escapeHtml(playerName)}</span>`)
                          .join("")}</div>`
                      : `<div class="meta-line">No player snapshots are associated with this run in the current report view.</div>`
                  }
                  ${
                    (run.failed_player_names || []).length
                      ? `<div class="hero-list">${run.failed_player_names
                          .map((playerName) => `<span class="flag-chip">Failed: ${escapeHtml(playerName)}</span>`)
                          .join("")}</div>`
                      : ""
                  }
                </div>
              `
            )
            .join("")
        : `<div class="summary-card empty-card"><div class="metric-label">No Runs Yet</div><strong>No snapshot history found</strong><div class="card-note">Run the report once to start building settings data.</div></div>`;

      const resetButton = document.querySelector("[data-reset-removed-runs]");
      if (resetButton) {
        resetButton.addEventListener("click", () => {
          removedRunIds = [];
          storeRemovedRuns(meta, removedRunIds);
          draw();
        });
      }

      document.querySelectorAll("[data-toggle-run]").forEach((checkbox) => {
        checkbox.addEventListener("change", (event) => {
          const runId = event.target.getAttribute("data-toggle-run");
          if (!runId) return;
          if (event.target.checked) {
            removedRunIds = [...new Set([...removedRunIds, runId])];
          } else {
            removedRunIds = removedRunIds.filter((entry) => entry !== runId);
          }
          storeRemovedRuns(meta, removedRunIds);
          draw();
        });
      });

      document.querySelectorAll("[data-toggle-run-button]").forEach((button) => {
        button.addEventListener("click", (event) => {
          const runId = event.currentTarget.getAttribute("data-toggle-run-button");
          if (!runId) return;
          if (removedRunSet.has(runId)) {
            removedRunIds = removedRunIds.filter((entry) => entry !== runId);
          } else {
            removedRunIds = [...new Set([...removedRunIds, runId])];
          }
          storeRemovedRuns(meta, removedRunIds);
          draw();
        });
      });

      if (!hideOnlyMode) {
        document.querySelectorAll("[data-copy-delete-command]").forEach((button) => {
          button.addEventListener("click", async (event) => {
            const runId = event.currentTarget.getAttribute("data-copy-delete-command");
            if (!runId) return;
            const originalText = event.currentTarget.textContent;
            const command = buildSnapshotDeleteCommand(meta, runId);
            const copied = await copyText(command);
            event.currentTarget.textContent = copied ? "Delete Command Copied" : "Copy Failed";
            window.setTimeout(() => {
              event.currentTarget.textContent = originalText;
            }, 1800);
          });
        });
      }
    };

    draw();
  };

  const liveHeroCatalog = {
    ana: { name: "Ana", role: "support" },
    ashe: { name: "Ashe", role: "damage" },
    baptiste: { name: "Baptiste", role: "support" },
    bastion: { name: "Bastion", role: "damage" },
    brigitte: { name: "Brigitte", role: "support" },
    cassidy: { name: "Cassidy", role: "damage" },
    doomfist: { name: "Doomfist", role: "tank" },
    dva: { name: "D.Va", role: "tank" },
    echo: { name: "Echo", role: "damage" },
    freja: { name: "Freja", role: "damage" },
    genji: { name: "Genji", role: "damage" },
    hanzo: { name: "Hanzo", role: "damage" },
    hazard: { name: "Hazard", role: "tank" },
    illari: { name: "Illari", role: "support" },
    "junker-queen": { name: "Junker Queen", role: "tank" },
    junkrat: { name: "Junkrat", role: "damage" },
    juno: { name: "Juno", role: "support" },
    "jetpack-cat": { name: "Jetpack Cat", role: "support" },
    kiriko: { name: "Kiriko", role: "support" },
    lifeweaver: { name: "Lifeweaver", role: "support" },
    lucio: { name: "Lucio", role: "support" },
    mauga: { name: "Mauga", role: "tank" },
    mei: { name: "Mei", role: "damage" },
    mercy: { name: "Mercy", role: "support" },
    mizuki: { name: "Mizuki", role: "support" },
    moira: { name: "Moira", role: "support" },
    orisa: { name: "Orisa", role: "tank" },
    pharah: { name: "Pharah", role: "damage" },
    ramattra: { name: "Ramattra", role: "tank" },
    reaper: { name: "Reaper", role: "damage" },
    reinhardt: { name: "Reinhardt", role: "tank" },
    roadhog: { name: "Roadhog", role: "tank" },
    sigma: { name: "Sigma", role: "tank" },
    sojourn: { name: "Sojourn", role: "damage" },
    "soldier-76": { name: "Soldier: 76", role: "damage" },
    sombra: { name: "Sombra", role: "damage" },
    symmetra: { name: "Symmetra", role: "damage" },
    torbjorn: { name: "Torbjorn", role: "damage" },
    tracer: { name: "Tracer", role: "damage" },
    venture: { name: "Venture", role: "damage" },
    widowmaker: { name: "Widowmaker", role: "damage" },
    winston: { name: "Winston", role: "tank" },
    "wrecking-ball": { name: "Wrecking Ball", role: "tank" },
    zarya: { name: "Zarya", role: "tank" },
    zenyatta: { name: "Zenyatta", role: "support" },
  };

  const LIVE_CACHE_TTL_MS = 60 * 1000;
  const deepCloneJson = (value) => JSON.parse(JSON.stringify(value));
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const getPageFallbackPlayers = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload.players)) return payload.players;
    if (payload.player) return [payload.player];
    return [];
  };
  const slugifyText = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/#/g, "-")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "player";
  const escapeInfluxRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prettyHeroName = (heroKey) =>
    String(heroKey || "")
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const normalizeInfluxHeroKey = (hero) => {
    const normalized = String(hero || "").trim().toLowerCase();
    const special = {
      "soldier 76": "soldier-76",
      "soldier: 76": "soldier-76",
      "wrecking ball": "wrecking-ball",
      "junker queen": "junker-queen",
      "all heroes": "all-heroes",
    };
    if (special[normalized]) return special[normalized];
    return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  };
  const getLiveHeroName = (heroKey) => liveHeroCatalog[heroKey]?.name || prettyHeroName(heroKey);
  const getLiveHeroRole = (heroKey) => liveHeroCatalog[heroKey]?.role || "flex";
  const getLiveCacheKey = (liveConfig, cacheScope = "overview") =>
    `owr-live-site:${cacheScope}:${liveConfig?.database || "db"}:${liveConfig?.query_url || "query"}:${(liveConfig?.players || [])
      .map((player) => player.player_id || player.slug || player.display_name)
      .join("|")}`;
  const readLiveCache = (liveConfig, cacheScope = "overview") => {
    try {
      const raw = sessionStorage.getItem(getLiveCacheKey(liveConfig, cacheScope));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.stored_at || !parsed?.payload) return null;
      if (Date.now() - Number(parsed.stored_at) > LIVE_CACHE_TTL_MS) return null;
      return parsed.payload;
    } catch (error) {
      return null;
    }
  };
  const writeLiveCache = (liveConfig, cacheScope, payload) => {
    try {
      sessionStorage.setItem(
        getLiveCacheKey(liveConfig, cacheScope),
        JSON.stringify({
          stored_at: Date.now(),
          payload,
        })
      );
    } catch (error) {
    }
  };
  const createLiveClient = (liveConfig) => ({
    query_url: String(liveConfig?.query_url || "").trim().replace(/\/+$/, ""),
    database: String(liveConfig?.database || "ow_stats_telegraf").trim(),
    request_delay_ms: numericValue(liveConfig?.request_delay_ms, 125),
    last_request_at: 0,
  });
  const convertInfluxResponseRows = (payload) => {
    const rows = [];
    (payload?.results || []).forEach((result) => {
      (result?.series || []).forEach((series) => {
        const columns = series?.columns || [];
        const tags = series?.tags || {};
        (series?.values || []).forEach((valueRow) => {
          const record = { measurement: series?.name };
          columns.forEach((column, index) => {
            record[column] = valueRow[index];
          });
          Object.keys(tags || {}).forEach((tagName) => {
            if (record[tagName] === undefined) {
              record[tagName] = tags[tagName];
            }
          });
          rows.push(record);
        });
      });
    });
    return rows;
  };
  const liveLogPrefix = "[OWR live]";
  const summarizeLiveQuery = (query) =>
    String(query || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  const logLiveEvent = (message, detail) => {
    if (detail !== undefined) {
      console.log(`${liveLogPrefix} ${message}`, detail);
      return;
    }
    console.log(`${liveLogPrefix} ${message}`);
  };
  const logLiveWarn = (message, detail) => {
    if (detail !== undefined) {
      console.warn(`${liveLogPrefix} ${message}`, detail);
      return;
    }
    console.warn(`${liveLogPrefix} ${message}`);
  };
  const queryLiveInflux = async (client, query, options = {}) => {
    const label = options.label || "Influx query";
    const elapsed = Date.now() - numericValue(client.last_request_at, 0);
    const waitMs = Math.max(0, numericValue(client.request_delay_ms, 125) - elapsed);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    client.last_request_at = Date.now();
    const url = `${client.query_url}?db=${encodeURIComponent(client.database)}&q=${encodeURIComponent(query)}`;
    const startedAt = performance.now();
    logLiveEvent(`${label} started`, summarizeLiveQuery(query));
    let response;
    try {
      response = await fetch(url, { method: "GET" });
    } catch (error) {
      logLiveWarn(`${label} failed after ${(performance.now() - startedAt).toFixed(0)}ms`, error?.message || "Network request failed.");
      return { ok: false, rows: [], error: error?.message || "Network request failed." };
    }

    const text = await response.text();
    if (!response.ok) {
      logLiveWarn(`${label} failed after ${(performance.now() - startedAt).toFixed(0)}ms`, `HTTP ${response.status}`);
      return {
        ok: false,
        rows: [],
        error: `HTTP ${response.status}: ${text.slice(0, 400)}`,
      };
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      logLiveWarn(`${label} returned non-JSON after ${(performance.now() - startedAt).toFixed(0)}ms`);
      return { ok: false, rows: [], error: "Database returned non-JSON data." };
    }

    const rows = convertInfluxResponseRows(payload);
    logLiveEvent(`${label} completed in ${(performance.now() - startedAt).toFixed(0)}ms with ${rows.length} row(s)`);

    return {
      ok: true,
      payload,
      rows,
      error: null,
    };
  };
  const getInfluxFieldValue = (record, names) => {
    for (const name of names || []) {
      const value = record?.[name];
      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }
    return null;
  };
  const convertInfluxCategoryObject = (row) => {
    const excluded = new Set(["measurement", "time", "player", "platform", "gamemode", "hero", "host"]);
    const record = {};
    Object.keys(row || {}).forEach((key) => {
      if (excluded.has(key)) return;
      const value = row[key];
      if (value === null || value === undefined || value === "") return;
      record[key] = value;
    });
    return record;
  };
  const convertRankOrdinalFromRaw = (rank) => {
    if (!rank) return null;
    let tierName = null;
    let divisionNumber = null;
    if (typeof rank === "string") {
      const match = rank.match(/(bronze|silver|gold|platinum|diamond|master|grandmaster|champion)\s*([1-5])?/i);
      if (match) {
        tierName = match[1].toLowerCase();
        divisionNumber = match[2] ? Number(match[2]) : null;
      }
    } else {
      const tierRaw = rank?.tier;
      const divisionRaw = rank?.division;
      const rankRaw = rank?.rank;
      if (typeof tierRaw === "string" && tierRaw.trim()) {
        tierName = tierRaw.trim().toLowerCase();
      } else if (typeof divisionRaw === "string" && divisionRaw.trim()) {
        tierName = divisionRaw.trim().toLowerCase();
      } else if (typeof rankRaw === "string" && rankRaw.trim()) {
        const match = rankRaw.match(/(bronze|silver|gold|platinum|diamond|master|grandmaster|champion)/i);
        if (match) {
          tierName = match[1].toLowerCase();
        }
      }

      if (Number.isFinite(Number(tierRaw))) {
        divisionNumber = Number(tierRaw);
      } else if (Number.isFinite(Number(divisionRaw))) {
        divisionNumber = Number(divisionRaw);
      } else if (Number.isFinite(Number(rank?.subdivision))) {
        divisionNumber = Number(rank.subdivision);
      }
    }

    const tierIndexMap = {
      bronze: 1,
      silver: 2,
      gold: 3,
      platinum: 4,
      diamond: 5,
      master: 6,
      grandmaster: 7,
      champion: 8,
    };
    if (!tierName || !tierIndexMap[tierName]) return null;
    let division = Number.isFinite(Number(divisionNumber)) ? Number(divisionNumber) : 3;
    division = Math.max(1, Math.min(5, Math.round(division)));
    return (tierIndexMap[tierName] - 1) * 5 + (6 - division);
  };
  const normalizeLiveRankSummary = (rankSummary) => {
    const normalizedRoles = [...(rankSummary?.roles || [])]
      .map((entry) => {
        const raw = entry?.raw || null;
        const ordinal = entry?.ordinal ?? convertRankOrdinalFromRaw(raw || entry?.label || null);
        return {
          role: entry?.role,
          label: entry?.label || (ordinal ? formatRankLabelFromOrdinal(ordinal) : "Unranked"),
          ordinal: ordinal === null || ordinal === undefined ? null : Number(ordinal),
          raw,
        };
      })
      .filter((entry) => entry.role);
    const orderedRoles = normalizedRoles.sort((left, right) => {
      const ordinalDelta = numericValue(right.ordinal, -1) - numericValue(left.ordinal, -1);
      if (ordinalDelta !== 0) return ordinalDelta;
      return String(left.role || "").localeCompare(String(right.role || ""));
    });
    const ordinals = orderedRoles
      .map((entry) => entry.ordinal)
      .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)))
      .map(Number);
    const averageOrdinal = ordinals.length
      ? Number((ordinals.reduce((sum, value) => sum + value, 0) / ordinals.length).toFixed(2))
      : null;
    return {
      platform: rankSummary?.platform || "pc",
      season: rankSummary?.season ?? null,
      roles: orderedRoles,
      average_ordinal: averageOrdinal,
      best_role: orderedRoles[0]?.role || null,
      best_label: orderedRoles[0]?.label || "Unranked",
    };
  };
  const buildLiveHeroMetricRecord = (heroKey, heroCategoryMap) => {
    const game = heroCategoryMap?.game || {};
    const combat = heroCategoryMap?.combat || {};
    const assists = heroCategoryMap?.assists || {};
    const average = heroCategoryMap?.average || {};
    const gamesPlayed = numericValue(getInfluxFieldValue(game, ["games_played"]), 0);
    const gamesWon = numericValue(getInfluxFieldValue(game, ["games_won", "hero_wins"]), 0);
    const gamesLost = numericValue(getInfluxFieldValue(game, ["games_lost"]), 0);
    const timePlayed = numericValue(getInfluxFieldValue(game, ["time_played"]), 0);
    const totalEliminations = numericValue(getInfluxFieldValue(combat, ["eliminations"]), 0);
    const totalAssists = numericValue(getInfluxFieldValue(assists, ["assists"]), 0);
    const totalDeaths = numericValue(getInfluxFieldValue(combat, ["deaths"]), 0);
    const totalDamage = numericValue(getInfluxFieldValue(combat, ["all_damage_done", "damage_done"]), 0);
    const totalHealing = numericValue(getInfluxFieldValue(assists, ["healing_done"]), 0);
    const explicitWinrate = getInfluxFieldValue(game, ["win_percentage"]);
    const winrate =
      explicitWinrate !== null && explicitWinrate !== undefined && explicitWinrate !== ""
        ? Number(numericValue(explicitWinrate).toFixed(2))
        : gamesPlayed > 0
          ? Number(((gamesWon / gamesPlayed) * 100).toFixed(2))
          : null;
    const kda =
      totalDeaths > 0
        ? Number(((totalEliminations + totalAssists) / totalDeaths).toFixed(2))
        : totalEliminations + totalAssists > 0
          ? Number((totalEliminations + totalAssists).toFixed(2))
          : null;

    if (gamesPlayed <= 0 && timePlayed <= 0 && kda === null && winrate === null) {
      return null;
    }

    return {
      hero_key: heroKey,
      hero_name: getLiveHeroName(heroKey),
      hero_role: getLiveHeroRole(heroKey),
      games_played: gamesPlayed,
      games_won: gamesWon,
      games_lost: gamesLost,
      time_played_seconds: timePlayed,
      season_games_played: gamesPlayed,
      season_games_won: gamesWon,
      season_games_lost: gamesLost,
      season_time_played_seconds: timePlayed,
      winrate,
      kda,
      total: {
        eliminations: Number(totalEliminations.toFixed(2)),
        assists: Number(totalAssists.toFixed(2)),
        deaths: Number(totalDeaths.toFixed(2)),
        damage: Number(totalDamage.toFixed(2)),
        healing: Number(totalHealing.toFixed(2)),
      },
      average: {
        eliminations: getInfluxFieldValue(average, ["eliminations_avg_per_10_min"]),
        assists: getInfluxFieldValue(average, ["assists_avg_per_10_min"]),
        deaths: getInfluxFieldValue(average, ["deaths_avg_per_10_min"]),
        damage: getInfluxFieldValue(average, ["all_damage_done_avg_per_10_min", "damage_done_avg_per_10_min"]),
        healing: getInfluxFieldValue(average, ["healing_done_avg_per_10_min"]),
      },
      career: {
        assists,
        average,
        best: {},
        combat,
        game,
        match_awards: {},
        hero_specific: {},
      },
    };
  };
  const buildLivePlaceholderProfile = (displayName, rankSummary, timestamp, summaryRow = null) => {
    const bestLabel = rankSummary?.best_label || "Unranked";
    const bestRole = rankSummary?.best_role || "";
    const roleName = bestRole === "damage" ? "DPS" : bestRole ? roleLabel(bestRole) : "";
    const fallbackTitle = roleName && bestLabel !== "Unranked" ? `${bestLabel} ${roleName}` : bestLabel;
    const updatedAtMs = summaryRow?.time ? new Date(summaryRow.time).getTime() : new Date(timestamp).getTime();
    return {
      username: summaryRow?.username || displayName,
      avatar: summaryRow?.avatar || null,
      namecard: summaryRow?.namecard || null,
      title: summaryRow?.title || fallbackTitle,
      endorsement_level: numericValue(summaryRow?.endorsement_level, 0),
      endorsement_frame: summaryRow?.endorsement_frame || null,
      last_updated_at: Number.isFinite(updatedAtMs) ? Math.floor(updatedAtMs / 1000) : Math.floor(new Date(timestamp).getTime() / 1000),
    };
  };
  const buildRunIdFromTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return slugifyText(timestamp);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(
      date.getUTCMinutes()
    )}${pad(date.getUTCSeconds())}`;
  };
  const buildWideMatchContextFromSnapshots = (snapshots) => {
    const assignments = (snapshots || [])
      .map((snapshot) => {
        const bestRole = snapshot?.ranks?.best_role;
        const bestRank = (snapshot?.ranks?.roles || []).find((entry) => entry.role === bestRole);
        return bestRank?.ordinal !== null && bestRank?.ordinal !== undefined
          ? { rank_ordinal: Number(bestRank.ordinal) }
          : null;
      })
      .filter(Boolean);
    if (assignments.length < 2) return "mixed";
    const assessment = getOptimizerWideAssessment(assignments);
    if (assessment.label === "wide") return "mostly_wide";
    if (assessment.label === "narrow") return "mostly_narrow";
    return "mixed";
  };
  const getLiveConfiguredPlayers = (liveConfig, options = {}) => {
    const requestedSlugs = new Set((options.playerSlugs || []).filter(Boolean));
    return [...(liveConfig?.players || [])]
      .map((player) => ({
        battle_tag: player.battle_tag || "",
        player_id: player.player_id || player.battle_tag || "",
        slug: player.slug || slugifyText(player.display_name || player.player_id || player.battle_tag),
        display_name: player.display_name || player.battle_tag || player.player_id,
        notes: player.notes || "",
        locked_role: normalizeOptimizerLock(player.locked_role || ""),
      }))
      .filter((player) => player.player_id)
      .filter((player) => !requestedSlugs.size || requestedSlugs.has(player.slug));
  };
  const buildLivePlayerRecord = (playerConfig, snapshots, fallbackPayload) => {
    const orderedSnapshots = [...(snapshots || [])].sort((left, right) => new Date(left.captured_at) - new Date(right.captured_at));
    const latestSnapshot = orderedSnapshots[orderedSnapshots.length - 1] || null;
    const topHeroCount = Math.max(3, numericValue(fallbackPayload?.meta?.live_source?.ui?.top_hero_count, 6));

    if (!latestSnapshot) {
      const fallbackPlayer = getPageFallbackPlayers(fallbackPayload).find((player) => player.slug === playerConfig.slug);
      if (!fallbackPlayer) {
        return null;
      }
      const cloned = deepCloneJson(fallbackPlayer);
      const history = [...(cloned.history_snapshots || [])];
      if (history.length) {
        const latestHistory = history[history.length - 1];
        latestHistory.fetch_status = "partial";
        latestHistory.warnings = [...new Set([...(latestHistory.warnings || []), "Live DB returned no current-season rows for this player, so the embedded fallback view is being shown."])];
        cloned.history_snapshots = history;
      }
      return cloned;
    }

    return {
      slug: playerConfig.slug,
      href: `players/${playerConfig.slug}.html`,
      display_name: playerConfig.display_name,
      player_id: playerConfig.player_id,
      battle_tag: playerConfig.battle_tag,
      notes: playerConfig.notes || "",
      profile: latestSnapshot.profile,
      avatar: latestSnapshot.profile?.avatar || null,
      title: latestSnapshot.title || latestSnapshot.ranks?.best_label || "Unranked",
      current: {
        kda: latestSnapshot.metrics?.kda ?? 0,
        winrate: latestSnapshot.metrics?.winrate ?? 0,
        games_played: latestSnapshot.metrics?.games_played ?? 0,
        games_won: latestSnapshot.metrics?.games_won ?? 0,
        games_lost: latestSnapshot.metrics?.games_lost ?? 0,
        time_played_seconds: latestSnapshot.metrics?.time_played_seconds ?? 0,
        rank_label: latestSnapshot.ranks?.best_label || "Unranked",
        rank_ordinal: latestSnapshot.ranks?.average_ordinal ?? null,
        rank_roles: latestSnapshot.ranks?.roles || [],
        preferred_role: latestSnapshot.normalized?.preferred_role || latestSnapshot.ranks?.best_role || "flex",
        best_rank_role: latestSnapshot.ranks?.best_role || "flex",
      },
      ranks: latestSnapshot.ranks || { roles: [] },
      roles: latestSnapshot.roles || [],
      heroes: latestSnapshot.heroes || [],
      warnings: latestSnapshot.warnings || [],
      recommendations: getHeroRecommendationsFromSnapshots(orderedSnapshots),
      latest_run: {
        run_id: latestSnapshot.run_id,
        captured_at: latestSnapshot.captured_at,
        wide_match_context: latestSnapshot.wide_match_context,
      },
      customizations: {
        hidden_hero_names: [],
        locked_role: normalizeOptimizerLock(playerConfig.locked_role || ""),
      },
      history_snapshots: orderedSnapshots.map((snapshot) => deepCloneJson(snapshot)),
      top_heroes: [...(latestSnapshot.heroes || [])].slice(0, topHeroCount),
    };
  };
  const buildLiveSiteModel = async (liveConfig, fallbackPayload, options = {}) => {
    const playerConfigs = getLiveConfiguredPlayers(liveConfig, options);
    if (!playerConfigs.length) {
      throw new Error("No tracked players are configured for the live data source.");
    }

    const client = createLiveClient(liveConfig);
    const playerRegex = playerConfigs.map((player) => escapeInfluxRegex(player.player_id)).join("|");
    const playerSummaryByPlayer = new Map();

    const playerSummaryResult = await queryLiveInflux(
      client,
      `SELECT last("avatar"),last("endorsement_frame"),last("endorsement_level"),last("namecard"),last("title"),last("username") FROM "player_summary" WHERE "player" =~ /^(${playerRegex})$/ GROUP BY "player"`,
      { label: `Player summary (${playerConfigs.length} player${playerConfigs.length === 1 ? "" : "s"})` }
    );
    if (playerSummaryResult.ok) {
      playerSummaryResult.rows.forEach((row) => {
        if (!row.player) return;
        playerSummaryByPlayer.set(row.player, {
          time: row.time,
          avatar: row.last ?? null,
          endorsement_frame: row.last_1 ?? null,
          endorsement_level: row.last_2 ?? 0,
          namecard: row.last_3 ?? null,
          title: row.last_4 ?? null,
          username: row.last_5 ?? null,
        });
      });
    }

    const rankResult = await queryLiveInflux(
      client,
      `SELECT "tier","division","season" FROM "competitive_rank" WHERE "player" =~ /^(${playerRegex})$/ GROUP BY "player","role" ORDER BY time ASC`,
      { label: `Rank history (${playerConfigs.length} player${playerConfigs.length === 1 ? "" : "s"})` }
    );
    if (!rankResult.ok) {
      throw new Error(`Rank query failed: ${rankResult.error}`);
    }

    const latestSeasonByPlayer = new Map();
    rankResult.rows.forEach((row) => {
      const playerId = row.player;
      const season = Number(row.season);
      if (!playerId || !Number.isFinite(season)) return;
      if (!latestSeasonByPlayer.has(playerId) || season > latestSeasonByPlayer.get(playerId)) {
        latestSeasonByPlayer.set(playerId, season);
      }
    });

    const filteredRankRows = rankResult.rows.filter((row) => latestSeasonByPlayer.get(row.player) === Number(row.season));
    const seasonStartMsByPlayer = new Map();
    filteredRankRows.forEach((row) => {
      const playerId = row.player;
      const timestampMs = new Date(row.time).getTime();
      if (!playerId || Number.isNaN(timestampMs)) return;
      const existing = seasonStartMsByPlayer.get(playerId);
      if (existing === undefined || timestampMs < existing) {
        seasonStartMsByPlayer.set(playerId, timestampMs);
      }
    });

    const seasonStartValues = [...seasonStartMsByPlayer.values()].filter((value) => Number.isFinite(value));
    let careerRows = [];
    if (seasonStartValues.length) {
      const globalSeasonStartMs = Math.min(...seasonStartValues);
      const measurementPattern = "career_stats_assists|career_stats_average|career_stats_combat|career_stats_game";
      const regexQuery = `SELECT * FROM /^(${measurementPattern})$/ WHERE "player" =~ /^(${playerRegex})$/ AND "gamemode"='competitive' AND time >= ${globalSeasonStartMs}ms ORDER BY time ASC`;
      const careerResult = await queryLiveInflux(client, regexQuery, {
        label: `Detailed career history (${playerConfigs.length} player${playerConfigs.length === 1 ? "" : "s"})`,
      });
      if (careerResult.ok) {
        careerRows = careerResult.rows;
      } else {
        const measurements = ["career_stats_assists", "career_stats_average", "career_stats_combat", "career_stats_game"];
        for (const measurement of measurements) {
          const measurementResult = await queryLiveInflux(
            client,
            `SELECT * FROM "${measurement}" WHERE "player" =~ /^(${playerRegex})$/ AND "gamemode"='competitive' AND time >= ${globalSeasonStartMs}ms ORDER BY time ASC`,
            { label: `${measurement} fallback (${playerConfigs.length} player${playerConfigs.length === 1 ? "" : "s"})` }
          );
          if (measurementResult.ok) {
            careerRows = careerRows.concat(measurementResult.rows);
          }
        }
      }
    }

    const rankRowsByPlayer = new Map();
    filteredRankRows.forEach((row) => {
      if (!rankRowsByPlayer.has(row.player)) {
        rankRowsByPlayer.set(row.player, []);
      }
      rankRowsByPlayer.get(row.player).push(row);
    });

    const careerRowsByPlayer = new Map();
    careerRows.forEach((row) => {
      const playerId = row.player;
      const threshold = seasonStartMsByPlayer.get(playerId);
      const timestampMs = new Date(row.time).getTime();
      if (!playerId || !Number.isFinite(threshold) || Number.isNaN(timestampMs) || timestampMs < threshold) return;
      if (!careerRowsByPlayer.has(playerId)) {
        careerRowsByPlayer.set(playerId, []);
      }
      careerRowsByPlayer.get(playerId).push(row);
    });

    const allSnapshots = [];
    const players = [];
    const failedPlayers = [];

    playerConfigs.forEach((playerConfig) => {
      const snapshotLookup = new Map();
      const ensureSnapshotState = (timestamp) => {
        if (!snapshotLookup.has(timestamp)) {
          snapshotLookup.set(timestamp, {
            captured_at: timestamp,
            run_id: buildRunIdFromTimestamp(timestamp),
            rank_roles: {},
            hero_categories: {},
            rank_season: latestSeasonByPlayer.get(playerConfig.player_id) ?? null,
          });
        }
        return snapshotLookup.get(timestamp);
      };

      (rankRowsByPlayer.get(playerConfig.player_id) || []).forEach((row) => {
        if (!row.time) return;
        const state = ensureSnapshotState(row.time);
        const role = normalizeRoleLock(row.role);
        if (!role) return;
        state.rank_roles[role] = {
          role,
          raw: {
            division: row.division,
            tier: row.tier,
          },
          label: null,
          ordinal: convertRankOrdinalFromRaw({ division: row.division, tier: row.tier }),
        };
        state.rank_season = row.season;
      });

      (careerRowsByPlayer.get(playerConfig.player_id) || []).forEach((row) => {
        if (!row.time) return;
        const heroKey = normalizeInfluxHeroKey(row.hero);
        if (!heroKey) return;
        const state = ensureSnapshotState(row.time);
        if (!state.hero_categories[heroKey]) {
          state.hero_categories[heroKey] = {};
        }
        const categoryKey = String(row.measurement || "").replace(/^career_stats_/, "");
        state.hero_categories[heroKey][categoryKey] = convertInfluxCategoryObject(row);
      });

      const snapshots = [...snapshotLookup.keys()]
        .sort((left, right) => new Date(left) - new Date(right))
        .map((timestamp) => {
          const state = snapshotLookup.get(timestamp);
          const rankSummary = normalizeLiveRankSummary({
            platform: "pc",
            season: state.rank_season,
            roles: Object.values(state.rank_roles).sort((left, right) => String(left.role).localeCompare(String(right.role))),
          });
          const heroes = Object.keys(state.hero_categories)
            .filter((heroKey) => heroKey !== "all-heroes")
            .map((heroKey) => buildLiveHeroMetricRecord(heroKey, state.hero_categories[heroKey]))
            .filter(Boolean)
            .sort((left, right) => {
              const timeDelta =
                numericValue(right.season_time_played_seconds, numericValue(right.time_played_seconds)) -
                numericValue(left.season_time_played_seconds, numericValue(left.time_played_seconds));
              if (timeDelta !== 0) return timeDelta;
              const gamesDelta =
                numericValue(right.season_games_played, numericValue(right.games_played)) -
                numericValue(left.season_games_played, numericValue(left.games_played));
              if (gamesDelta !== 0) return gamesDelta;
              return String(left.hero_name || "").localeCompare(String(right.hero_name || ""));
            });
          const allHeroRecord = state.hero_categories["all-heroes"]
            ? buildLiveHeroMetricRecord("all-heroes", state.hero_categories["all-heroes"])
            : null;
          const metrics = allHeroRecord
            ? {
                kda: allHeroRecord.kda,
                winrate: allHeroRecord.winrate,
                games_played: allHeroRecord.games_played,
                games_won: allHeroRecord.games_won,
                games_lost: allHeroRecord.games_lost,
                time_played_seconds: allHeroRecord.time_played_seconds,
                total: allHeroRecord.total,
                average: allHeroRecord.average,
              }
            : aggregateMetricsFromHeroes(heroes);
          const roles = aggregateRoleMetricsFromHeroes(heroes);
          const preferredRole = getPreferredRoleFromRoles(roles, rankSummary);
          const profile = buildLivePlaceholderProfile(
            playerConfig.display_name,
            rankSummary,
            timestamp,
            playerSummaryByPlayer.get(playerConfig.player_id) || null
          );
          return {
            snapshot_id: `${buildRunIdFromTimestamp(timestamp)}-${playerConfig.slug}`,
            run_id: buildRunIdFromTimestamp(timestamp),
            captured_at: new Date(timestamp).toISOString(),
            player_id: playerConfig.player_id,
            player_slug: playerConfig.slug,
            display_name: playerConfig.display_name,
            battle_tag: playerConfig.battle_tag,
            notes: playerConfig.notes,
            provider: "influxdb",
            fetch_status: "success",
            wide_match_context: "mixed",
            warnings: [],
            profile,
            metrics,
            roles,
            ranks: rankSummary,
            normalized: {
              preferred_role: preferredRole,
              data_quality: "success",
              top_heroes: heroes.slice(0, 3).map((hero) => hero.hero_name),
            },
            heroes,
            raw_payloads: null,
            title: profile.title || rankSummary.best_label || "Unranked",
          };
        });

      if (!snapshots.length) {
        failedPlayers.push({
          display_name: playerConfig.display_name,
          player_id: playerConfig.player_id,
        });
      }

      allSnapshots.push(...snapshots);
      const playerRecord = buildLivePlayerRecord(playerConfig, snapshots, fallbackPayload);
      if (playerRecord) {
        players.push(playerRecord);
      }
    });

    const runLookup = new Map();
    [...allSnapshots]
      .sort((left, right) => new Date(left.captured_at) - new Date(right.captured_at))
      .forEach((snapshot) => {
        if (!runLookup.has(snapshot.run_id)) {
          runLookup.set(snapshot.run_id, {
            run_id: snapshot.run_id,
            timestamp: snapshot.captured_at,
            started_at: snapshot.captured_at,
            completed_at: snapshot.captured_at,
            notes: "",
            wide_match_context: "mixed",
            snapshot_count: 0,
            successful_players: 0,
            failed_player_count: 0,
            failed_player_names: [],
            player_display_names: [],
            player_slugs: [],
          });
        }
        const run = runLookup.get(snapshot.run_id);
        run.snapshot_count += 1;
        run.successful_players += 1;
        if (!run.player_display_names.includes(snapshot.display_name)) {
          run.player_display_names.push(snapshot.display_name);
        }
        if (!run.player_slugs.includes(snapshot.player_slug)) {
          run.player_slugs.push(snapshot.player_slug);
        }
      });

    [...runLookup.values()].forEach((run) => {
      const runSnapshots = allSnapshots.filter((snapshot) => snapshot.run_id === run.run_id);
      const wideContext = buildWideMatchContextFromSnapshots(runSnapshots);
      run.wide_match_context = wideContext;
      runSnapshots.forEach((snapshot) => {
        snapshot.wide_match_context = wideContext;
      });
    });

    const runRecords = [...runLookup.values()].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
    const latestRun = runRecords[runRecords.length - 1] || null;
    const freshSnapshots = latestRun ? allSnapshots.filter((snapshot) => snapshot.run_id === latestRun.run_id).length : 0;
    const nowIso = new Date().toISOString();

    return {
      meta: {
        team_name: fallbackPayload?.meta?.team_name || "Overwatch Team",
        site_subtitle: fallbackPayload?.meta?.site_subtitle || "Live database-backed reporting.",
        provider_name: "influxdb",
        generated_at: nowIso,
        config_path: fallbackPayload?.meta?.config_path || "",
        project_root: fallbackPayload?.meta?.project_root || "",
        latest_run: latestRun
          ? {
              run_id: latestRun.run_id,
              timestamp: latestRun.timestamp,
              notes: "",
              wide_match_context: latestRun.wide_match_context || "mixed",
            }
          : fallbackPayload?.meta?.latest_run || { run_id: "", timestamp: "", notes: "", wide_match_context: "mixed" },
        total_tracked_players: playerConfigs.length,
        fresh_snapshots: freshSnapshots,
        player_count_with_history: players.length,
        stat_scope: "competitive-only",
        source_mode: "live",
        live_mode: true,
        live_refresh_message: `Live data refreshed ${new Date(nowIso).toLocaleString()}.`,
        live_source: liveConfig,
        failed_players: failedPlayers,
      },
      overview: fallbackPayload?.overview || {},
      players: players.sort((left, right) => String(left.display_name || "").localeCompare(String(right.display_name || ""))),
      settings: {
        removal_mode: "hide-only",
        runs: runRecords,
      },
    };
  };
  const buildLiveOverviewSiteModel = async (liveConfig, fallbackPayload) => {
    const playerConfigs = getLiveConfiguredPlayers(liveConfig);
    if (!playerConfigs.length) {
      throw new Error("No tracked players are configured for the live data source.");
    }

    const client = createLiveClient(liveConfig);
    const playerRegex = playerConfigs.map((player) => escapeInfluxRegex(player.player_id)).join("|");
    const measurementPattern = "career_stats_assists|career_stats_average|career_stats_combat|career_stats_game";
    const playerSummaryByPlayer = new Map();
    const playerSummaryResult = await queryLiveInflux(
      client,
      `SELECT last("avatar"),last("endorsement_frame"),last("endorsement_level"),last("namecard"),last("title"),last("username") FROM "player_summary" WHERE "player" =~ /^(${playerRegex})$/ GROUP BY "player"`,
      { label: `Player summary (${playerConfigs.length} players)` }
    );
    if (playerSummaryResult.ok) {
      playerSummaryResult.rows.forEach((row) => {
        if (!row.player) return;
        playerSummaryByPlayer.set(row.player, {
          time: row.time,
          avatar: row.last ?? null,
          endorsement_frame: row.last_1 ?? null,
          endorsement_level: row.last_2 ?? 0,
          namecard: row.last_3 ?? null,
          title: row.last_4 ?? null,
          username: row.last_5 ?? null,
        });
      });
    }

    const latestSeasonByPlayer = new Map();
    const latestSeasonResult = await queryLiveInflux(
      client,
      `SELECT last("season") AS "season" FROM "competitive_rank" WHERE "player" =~ /^(${playerRegex})$/ GROUP BY "player"`,
      { label: `Latest season lookup (${playerConfigs.length} players)` }
    );
    if (!latestSeasonResult.ok) {
      throw new Error(`Latest season query failed: ${latestSeasonResult.error}`);
    }
    latestSeasonResult.rows.forEach((row) => {
      const playerId = row.player;
      const season = Number(getInfluxFieldValue(row, ["season", "last"]));
      if (!playerId || !Number.isFinite(season)) return;
      latestSeasonByPlayer.set(playerId, season);
    });

    const rankRows = [];
    const playersBySeason = new Map();
    playerConfigs.forEach((player) => {
      const season = latestSeasonByPlayer.get(player.player_id);
      if (!Number.isFinite(season)) return;
      if (!playersBySeason.has(season)) {
        playersBySeason.set(season, []);
      }
      playersBySeason.get(season).push(player.player_id);
    });
    for (const [season, playerIds] of playersBySeason.entries()) {
      const seasonRegex = playerIds.map((playerId) => escapeInfluxRegex(playerId)).join("|");
      const seasonRankResult = await queryLiveInflux(
        client,
        `SELECT "tier","division","season" FROM "competitive_rank" WHERE "player" =~ /^(${seasonRegex})$/ AND "season"=${season} GROUP BY "player","role" ORDER BY time ASC`,
        { label: `Rank history season ${season} (${playerIds.length} players)` }
      );
      if (!seasonRankResult.ok) {
        throw new Error(`Rank query failed for season ${season}: ${seasonRankResult.error}`);
      }
      rankRows.push(...seasonRankResult.rows);
    }

    const seasonStartMsByPlayer = new Map();
    rankRows.forEach((row) => {
      const playerId = row.player;
      const timestampMs = new Date(row.time).getTime();
      if (!playerId || Number.isNaN(timestampMs)) return;
      const existing = seasonStartMsByPlayer.get(playerId);
      if (existing === undefined || timestampMs < existing) {
        seasonStartMsByPlayer.set(playerId, timestampMs);
      }
    });

    const seasonStartValues = [...seasonStartMsByPlayer.values()].filter((value) => Number.isFinite(value));
    let aggregateRows = [];
    if (seasonStartValues.length) {
      const globalSeasonStartMs = Math.min(...seasonStartValues);
      const aggregateResult = await queryLiveInflux(
        client,
        `SELECT * FROM /^(${measurementPattern})$/ WHERE "player" =~ /^(${playerRegex})$/ AND "gamemode"='competitive' AND "hero"='all-heroes' AND time >= ${globalSeasonStartMs}ms ORDER BY time ASC`,
        { label: `All-heroes history (${playerConfigs.length} players)` }
      );
      if (!aggregateResult.ok) {
        throw new Error(`All-heroes history query failed: ${aggregateResult.error}`);
      }
      aggregateRows = aggregateResult.rows;
    }

    let latestHeroRows = [];
    const latestHeroesResult = await queryLiveInflux(
      client,
      `SELECT last(*) FROM /^(${measurementPattern})$/ WHERE "player" =~ /^(${playerRegex})$/ AND "gamemode"='competitive' GROUP BY "player","hero"`,
      { label: `Latest hero snapshot (${playerConfigs.length} players)` }
    );
    if (latestHeroesResult.ok) {
      latestHeroRows = latestHeroesResult.rows;
    }

    const rankRowsByPlayer = new Map();
    rankRows.forEach((row) => {
      if (!rankRowsByPlayer.has(row.player)) {
        rankRowsByPlayer.set(row.player, []);
      }
      rankRowsByPlayer.get(row.player).push(row);
    });

    const aggregateRowsByPlayer = new Map();
    aggregateRows.forEach((row) => {
      const playerId = row.player;
      const threshold = seasonStartMsByPlayer.get(playerId);
      const timestampMs = new Date(row.time).getTime();
      if (!playerId || !Number.isFinite(threshold) || Number.isNaN(timestampMs) || timestampMs < threshold) return;
      if (!aggregateRowsByPlayer.has(playerId)) {
        aggregateRowsByPlayer.set(playerId, []);
      }
      aggregateRowsByPlayer.get(playerId).push(row);
    });

    const latestHeroCategoriesByPlayer = new Map();
    latestHeroRows.forEach((row) => {
      const playerId = row.player;
      const heroKey = normalizeInfluxHeroKey(row.hero);
      if (!playerId || !heroKey || heroKey === "all-heroes") return;
      if (!latestHeroCategoriesByPlayer.has(playerId)) {
        latestHeroCategoriesByPlayer.set(playerId, {});
      }
      const playerHeroes = latestHeroCategoriesByPlayer.get(playerId);
      if (!playerHeroes[heroKey]) {
        playerHeroes[heroKey] = {};
      }
      const categoryKey = String(row.measurement || "").replace(/^career_stats_/, "");
      playerHeroes[heroKey][categoryKey] = convertInfluxCategoryObject(row);
    });

    const allSnapshots = [];
    const players = [];
    const failedPlayers = [];

    playerConfigs.forEach((playerConfig) => {
      const snapshotLookup = new Map();
      const ensureSnapshotState = (timestamp) => {
        if (!snapshotLookup.has(timestamp)) {
          snapshotLookup.set(timestamp, {
            captured_at: timestamp,
            run_id: buildRunIdFromTimestamp(timestamp),
            rank_roles: {},
            aggregate_categories: {},
            rank_season: latestSeasonByPlayer.get(playerConfig.player_id) ?? null,
          });
        }
        return snapshotLookup.get(timestamp);
      };

      (rankRowsByPlayer.get(playerConfig.player_id) || []).forEach((row) => {
        if (!row.time) return;
        const state = ensureSnapshotState(row.time);
        const role = normalizeRoleLock(row.role);
        if (!role) return;
        state.rank_roles[role] = {
          role,
          raw: {
            division: row.division,
            tier: row.tier,
          },
          label: null,
          ordinal: convertRankOrdinalFromRaw({ division: row.division, tier: row.tier }),
        };
        state.rank_season = row.season;
      });

      (aggregateRowsByPlayer.get(playerConfig.player_id) || []).forEach((row) => {
        if (!row.time) return;
        const state = ensureSnapshotState(row.time);
        if (!state.aggregate_categories["all-heroes"]) {
          state.aggregate_categories["all-heroes"] = {};
        }
        const categoryKey = String(row.measurement || "").replace(/^career_stats_/, "");
        state.aggregate_categories["all-heroes"][categoryKey] = convertInfluxCategoryObject(row);
      });

      const latestHeroRecords = Object.keys(latestHeroCategoriesByPlayer.get(playerConfig.player_id) || {})
        .map((heroKey) => buildLiveHeroMetricRecord(heroKey, latestHeroCategoriesByPlayer.get(playerConfig.player_id)[heroKey]))
        .filter(Boolean)
        .sort((left, right) => {
          const timeDelta =
            numericValue(right.season_time_played_seconds, numericValue(right.time_played_seconds)) -
            numericValue(left.season_time_played_seconds, numericValue(left.time_played_seconds));
          if (timeDelta !== 0) return timeDelta;
          const gamesDelta =
            numericValue(right.season_games_played, numericValue(right.games_played)) -
            numericValue(left.season_games_played, numericValue(left.games_played));
          if (gamesDelta !== 0) return gamesDelta;
          return String(left.hero_name || "").localeCompare(String(right.hero_name || ""));
        });

      const orderedTimestamps = [...snapshotLookup.keys()].sort((left, right) => new Date(left) - new Date(right));
      const latestTimestamp = orderedTimestamps[orderedTimestamps.length - 1] || null;
      const snapshots = orderedTimestamps.map((timestamp) => {
        const state = snapshotLookup.get(timestamp);
        const rankSummary = normalizeLiveRankSummary({
          platform: "pc",
          season: state.rank_season,
          roles: Object.values(state.rank_roles).sort((left, right) => String(left.role).localeCompare(String(right.role))),
        });
        const allHeroRecord = state.aggregate_categories["all-heroes"]
          ? buildLiveHeroMetricRecord("all-heroes", state.aggregate_categories["all-heroes"])
          : null;
        const metrics = allHeroRecord
          ? {
              kda: allHeroRecord.kda,
              winrate: allHeroRecord.winrate,
              games_played: allHeroRecord.games_played,
              games_won: allHeroRecord.games_won,
              games_lost: allHeroRecord.games_lost,
              time_played_seconds: allHeroRecord.time_played_seconds,
              total: allHeroRecord.total,
              average: allHeroRecord.average,
            }
          : {
              kda: null,
              winrate: null,
              games_played: 0,
              games_won: 0,
              games_lost: 0,
              time_played_seconds: 0,
              total: {},
              average: {},
            };
        const heroes = latestTimestamp && timestamp === latestTimestamp ? latestHeroRecords : [];
        const roles = heroes.length ? aggregateRoleMetricsFromHeroes(heroes) : [];
        const preferredRole = getPreferredRoleFromRoles(roles, rankSummary);
        const profile = buildLivePlaceholderProfile(
          playerConfig.display_name,
          rankSummary,
          timestamp,
          playerSummaryByPlayer.get(playerConfig.player_id) || null
        );
        return {
          snapshot_id: `${buildRunIdFromTimestamp(timestamp)}-${playerConfig.slug}`,
          run_id: buildRunIdFromTimestamp(timestamp),
          captured_at: new Date(timestamp).toISOString(),
          player_id: playerConfig.player_id,
          player_slug: playerConfig.slug,
          display_name: playerConfig.display_name,
          battle_tag: playerConfig.battle_tag,
          notes: playerConfig.notes,
          provider: "influxdb",
          fetch_status: "success",
          wide_match_context: "mixed",
          warnings: [],
          profile,
          metrics,
          roles,
          ranks: rankSummary,
          normalized: {
            preferred_role: preferredRole,
            data_quality: "success",
            top_heroes: heroes.slice(0, 3).map((hero) => hero.hero_name),
          },
          heroes,
          raw_payloads: null,
          title: profile.title || rankSummary.best_label || "Unranked",
        };
      });

      if (!snapshots.length) {
        failedPlayers.push({
          display_name: playerConfig.display_name,
          player_id: playerConfig.player_id,
        });
      }

      allSnapshots.push(...snapshots);
      const playerRecord = buildLivePlayerRecord(playerConfig, snapshots, fallbackPayload);
      if (playerRecord) {
        playerRecord.recommendations = { comfort: [], growth: [], avoid: [] };
        players.push(playerRecord);
      }
    });

    const runLookup = new Map();
    [...allSnapshots]
      .sort((left, right) => new Date(left.captured_at) - new Date(right.captured_at))
      .forEach((snapshot) => {
        if (!runLookup.has(snapshot.run_id)) {
          runLookup.set(snapshot.run_id, {
            run_id: snapshot.run_id,
            timestamp: snapshot.captured_at,
            started_at: snapshot.captured_at,
            completed_at: snapshot.captured_at,
            notes: "",
            wide_match_context: "mixed",
            snapshot_count: 0,
            successful_players: 0,
            failed_player_count: 0,
            failed_player_names: [],
            player_display_names: [],
            player_slugs: [],
          });
        }
        const run = runLookup.get(snapshot.run_id);
        run.snapshot_count += 1;
        run.successful_players += 1;
        if (!run.player_display_names.includes(snapshot.display_name)) {
          run.player_display_names.push(snapshot.display_name);
        }
        if (!run.player_slugs.includes(snapshot.player_slug)) {
          run.player_slugs.push(snapshot.player_slug);
        }
      });

    [...runLookup.values()].forEach((run) => {
      const runSnapshots = allSnapshots.filter((snapshot) => snapshot.run_id === run.run_id);
      const wideContext = buildWideMatchContextFromSnapshots(runSnapshots);
      run.wide_match_context = wideContext;
      runSnapshots.forEach((snapshot) => {
        snapshot.wide_match_context = wideContext;
      });
    });

    const runRecords = [...runLookup.values()].sort((left, right) => new Date(left.timestamp) - new Date(right.timestamp));
    const latestRun = runRecords[runRecords.length - 1] || null;
    const freshSnapshots = latestRun ? allSnapshots.filter((snapshot) => snapshot.run_id === latestRun.run_id).length : 0;
    const nowIso = new Date().toISOString();

    logLiveEvent(`Overview model assembled for ${players.length}/${playerConfigs.length} player(s)`);
    return {
      meta: {
        team_name: fallbackPayload?.meta?.team_name || "Overwatch Team",
        site_subtitle: fallbackPayload?.meta?.site_subtitle || "Live database-backed reporting.",
        provider_name: "influxdb",
        generated_at: nowIso,
        config_path: fallbackPayload?.meta?.config_path || "",
        project_root: fallbackPayload?.meta?.project_root || "",
        latest_run: latestRun
          ? {
              run_id: latestRun.run_id,
              timestamp: latestRun.timestamp,
              notes: "",
              wide_match_context: latestRun.wide_match_context || "mixed",
            }
          : fallbackPayload?.meta?.latest_run || { run_id: "", timestamp: "", notes: "", wide_match_context: "mixed" },
        total_tracked_players: playerConfigs.length,
        fresh_snapshots: freshSnapshots,
        player_count_with_history: players.length,
        stat_scope: "competitive-only",
        source_mode: "live",
        live_mode: true,
        live_refresh_message: `Live data refreshed ${new Date(nowIso).toLocaleString()}.`,
        live_source: liveConfig,
        failed_players: failedPlayers,
      },
      overview: fallbackPayload?.overview || {},
      players: players.sort((left, right) => String(left.display_name || "").localeCompare(String(right.display_name || ""))),
      settings: {
        removal_mode: "hide-only",
        runs: runRecords,
      },
    };
  };
  const buildLivePlayerPayload = async (liveConfig, fallbackPayload, playerSlug) => {
    const siteModel = await buildLiveSiteModel(liveConfig, fallbackPayload, { playerSlugs: [playerSlug] });
    const payload = buildPagePayloadFromSiteModel(siteModel, {
      page: "player",
      context: { player_slug: playerSlug },
      payload: { player: fallbackPayload?.player || null },
    });
    logLiveEvent(`Player model assembled for ${payload?.player?.display_name || playerSlug}`);
    return payload;
  };
  const buildPagePayloadFromSiteModel = (siteModel, originalPageData) => {
    if (originalPageData.page === "player") {
      const requestedSlug = originalPageData?.context?.player_slug || originalPageData?.payload?.player?.slug || "";
      const player =
        (siteModel.players || []).find((entry) => entry.slug === requestedSlug) ||
        siteModel.players?.[0] ||
        originalPageData?.payload?.player;
      return {
        meta: siteModel.meta,
        player,
      };
    }
    return siteModel;
  };
  const withLiveStatusMessage = (payload, message, liveMode = false) => {
    const clone = deepCloneJson(payload);
    if (clone?.meta) {
      clone.meta.source_mode = liveMode ? "live" : clone.meta.source_mode || "embedded-fallback";
      clone.meta.live_mode = liveMode;
      clone.meta.live_refresh_message = message;
    }
    return clone;
  };
  const withSnapshotStatusMessage = (payload, message, sourceMode) => {
    const clone = deepCloneJson(payload);
    if (clone?.meta) {
      clone.meta.source_mode = sourceMode;
      clone.meta.live_mode = sourceMode === "live";
      clone.meta.live_refresh_message = message;
    }
    return clone;
  };
  const renderCurrentPage = (payload) => {
    if (pageData.page === "overview") {
      renderOverview(payload);
    } else if (pageData.page === "player") {
      renderPlayer(payload);
    } else if (pageData.page === "settings") {
      renderSettings(payload);
    }
  };
  const renderBootPlaceholder = (message) => {
    const detail = escapeHtml(message || "Loading live data...");
    if (pageData.page === "overview") {
      const heroMeta = document.getElementById("hero-meta");
      if (heroMeta) {
        heroMeta.innerHTML = `<div class="meta-line"><span class="badge flat">Loading</span></div><div class="meta-line">${detail}</div>`;
      }
      [
        "overview-summary",
        "team-kda-chart",
        "team-winrate-chart",
        "team-rank-chart",
        "comparison-chart",
        "hero-pool-chart",
        "player-grid",
        "team-optimizer",
      ].forEach((id) => emptyState(document.getElementById(id), message || "Loading live data..."));
      const filters = document.getElementById("overview-filters");
      if (filters) filters.innerHTML = "";
      const visibility = document.getElementById("player-visibility-controls");
      if (visibility) visibility.innerHTML = "";
      return;
    }
    if (pageData.page === "player") {
      const playerMeta = document.getElementById("player-meta");
      if (playerMeta) {
        playerMeta.innerHTML = `<div class="meta-line"><span class="badge flat">Loading</span></div><div class="meta-line">${detail}</div>`;
      }
      [
        "player-summary",
        "player-rank-chart",
        "player-kda-chart",
        "player-winrate-chart",
        "player-role-chart",
        "player-hero-usage-chart",
        "player-hero-performance-chart",
        "player-recommendations",
        "player-trajectory",
        "player-hero-leaderboards",
        "player-hero-controls",
      ].forEach((id) => emptyState(document.getElementById(id), message || "Loading player data..."));
      return;
    }
    const settingsMeta = document.getElementById("settings-meta");
    if (settingsMeta) {
      settingsMeta.innerHTML = `<div class="meta-line"><span class="badge flat">Loading</span></div><div class="meta-line">${detail}</div>`;
    }
    ["settings-summary", "settings-run-list"].forEach((id) => emptyState(document.getElementById(id), message || "Loading snapshot controls..."));
  };
  const getPublishedSnapshotUrl = () => {
    if (pageData.page === "player") {
      const slug = pageData?.context?.player_slug || pageData?.fallback?.player_slug || "";
      return `../data/players/${slug}.json`;
    }
    if (pageData.page === "settings") {
      return "data/settings.json";
    }
    return "data/overview.json";
  };
  const normalizeFetchedPagePayload = (payload) => {
    if (!payload) return null;
    if (pageData.page === "player") {
      if (payload.meta && payload.player) {
        return payload;
      }
      return buildPagePayloadFromSiteModel(payload, pageData);
    }
    if (pageData.page === "settings") {
      if (payload.meta && payload.settings) {
        return payload;
      }
      return buildPagePayloadFromSiteModel(payload, pageData);
    }
    return payload.meta && payload.players ? payload : buildPagePayloadFromSiteModel(payload, pageData);
  };
  const resolvePublishedSnapshotPayload = async () => {
    if (!["http:", "https:"].includes(window.location.protocol)) {
      return null;
    }

    let response;
    try {
      logLiveEvent(`Published fallback fetch started (${pageData.page})`, getPublishedSnapshotUrl());
      response = await fetch(getPublishedSnapshotUrl(), { method: "GET", cache: "default" });
    } catch (error) {
      return null;
    }

    if (!response.ok) {
      return null;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error("Published snapshot file is not valid JSON.");
    }

    const pagePayload = normalizeFetchedPagePayload(payload);
    logLiveEvent(`Published fallback loaded for ${pageData.page}`);
    return withSnapshotStatusMessage(
      pagePayload,
      `Live server unavailable, so the page fell back to the last published snapshot at ${new Date().toLocaleString()}.`,
      "published-snapshot"
    );
  };
  const getLiveCacheScope = () =>
    pageData.page === "player"
      ? `player:${pageData?.context?.player_slug || pageData?.fallback?.player_slug || "unknown"}`
      : pageData.page;
  const resolveLivePagePayload = async () => {
    const liveConfig = pageData.live;
    if (!liveConfig?.enabled || liveConfig.provider !== "influxdb" || !liveConfig.browser_refresh_enabled) {
      return null;
    }

    if (window.location.protocol === "https:" && String(liveConfig.query_url || "").startsWith("http://")) {
      throw new Error("Live browser fetch needs the database endpoint to be served over HTTPS when this page is hosted over HTTPS.");
    }

    const cacheScope = getLiveCacheScope();
    const cachedPayload = readLiveCache(liveConfig, cacheScope);
    if (cachedPayload) {
      logLiveEvent(`Using cached live payload (${cacheScope})`);
      return cachedPayload;
    }

    const fallbackPayload =
      pageData.page === "player"
        ? {
            meta: { team_name: pageData?.fallback?.team_name || "Overwatch Team" },
            player: {
              slug: pageData?.context?.player_slug || pageData?.fallback?.player_slug || "",
              display_name: pageData?.fallback?.player_display_name || pageData?.context?.player_slug || "Player",
            },
          }
        : {
            meta: {
              team_name: pageData?.fallback?.team_name || "Overwatch Team",
              site_subtitle: pageData?.fallback?.site_subtitle || "Live database-backed reporting.",
            },
          };
    let payload;
    if (pageData.page === "player") {
      payload = await buildLivePlayerPayload(liveConfig, fallbackPayload, pageData?.context?.player_slug || pageData?.fallback?.player_slug || "");
    } else if (pageData.page === "settings") {
      const siteModel = await buildLiveOverviewSiteModel(liveConfig, fallbackPayload);
      payload = { meta: siteModel.meta, settings: siteModel.settings };
    } else {
      payload = await buildLiveOverviewSiteModel(liveConfig, fallbackPayload);
    }
    writeLiveCache(liveConfig, cacheScope, payload);
    return payload;
  };
  const boot = async () => {
    const bootStartedAt = performance.now();
    logLiveEvent(`Page boot started (${pageData.page})`);
    renderBootPlaceholder("Loading live data...");

    try {
      const liveEnabled = pageData.live?.enabled && pageData.live?.browser_refresh_enabled;
      const livePromise = liveEnabled
        ? resolveLivePagePayload()
            .then((payload) => ({ kind: "live", payload }))
            .catch((error) => ({ kind: "live-error", error }))
        : Promise.resolve({ kind: "live-disabled", payload: null });
      const publishedPromise = resolvePublishedSnapshotPayload()
        .then((payload) => ({ kind: "published", payload }))
        .catch((error) => ({ kind: "published-error", error }));

      const firstResult = await Promise.race([livePromise, publishedPromise]);
      let publishedRendered = false;

      if (firstResult?.kind === "live" && firstResult.payload) {
        logLiveEvent(`Live payload ready after ${(performance.now() - bootStartedAt).toFixed(0)}ms`);
        renderCurrentPage(withLiveStatusMessage(firstResult.payload, `Live server refreshed ${new Date().toLocaleString()}.`, true));
        return;
      }

      if (firstResult?.kind === "published" && firstResult.payload) {
        logLiveEvent(`Published fallback painted after ${(performance.now() - bootStartedAt).toFixed(0)}ms`);
        renderCurrentPage(firstResult.payload);
        publishedRendered = true;
      }

      if (liveEnabled) {
        const liveResult = firstResult?.kind === "live" || firstResult?.kind === "live-error" ? firstResult : await livePromise;
        if (liveResult?.kind === "live" && liveResult.payload) {
          logLiveEvent(`Live payload ready after ${(performance.now() - bootStartedAt).toFixed(0)}ms`);
          renderCurrentPage(withLiveStatusMessage(liveResult.payload, `Live server refreshed ${new Date().toLocaleString()}.`, true));
          return;
        }
        if (liveResult?.kind === "live-error") {
          logLiveWarn("Live refresh failed, trying the published snapshot fallback.", liveResult.error);
        }
      }

      if (!publishedRendered) {
        const publishedResult =
          firstResult?.kind === "published" || firstResult?.kind === "published-error" ? firstResult : await publishedPromise;
        if (publishedResult?.kind === "published" && publishedResult.payload) {
          logLiveEvent(`Published fallback ready after ${(performance.now() - bootStartedAt).toFixed(0)}ms`);
          renderCurrentPage(publishedResult.payload);
          return;
        }
        if (publishedResult?.kind === "published-error") {
          throw publishedResult.error;
        }
      }

      throw new Error("No live or published payload was available for this page.");
    } catch (error) {
      logLiveWarn("Live and published refresh both failed.", error);
      renderBootPlaceholder(`Live refresh failed: ${error?.message || "Unknown error"}`);
    }
  };

  void boot();
})();
