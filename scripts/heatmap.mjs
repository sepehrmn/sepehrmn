#!/usr/bin/env node
// scripts/heatmap.mjs
// Generates assets/heatmap.svg from live GitHub contribution data.
// Zero npm dependencies; uses the global `fetch` (Node 20+).
//
// Design (responding to /github.com/sepehrmn README feedback):
//   - Weekly-grid SVG matching GitHub's contribution calendar.
//   - Cells with high commit ratios (commits/total contributions) render as
//     neon cyan; PR/issue-only days render as muted gray. This visually
//     distinguishes commit-dominant weeks from PR-dominant weeks — something
//     the upstream github-readme-activity-graph cannot do because it applies
//     a single accent to the whole stack.
//   - SMIL <animate> elements pulse the top-quartile commit-dominant cells,
//     scaled as a fraction of total contributions so the visual energy stays
//     proportional regardless of overall activity volume.
//   - Background is transparent; SVG is light/dark mode aware via
//     `prefers-color-scheme`.
//
// In CI (`.github/workflows/heatmap.yml`) `GITHUB_TOKEN` is auto-injected.
// Locally, an authenticated run is optional — the script degrades to a public
// contribution fetch and writes an empty-grid SVG if even that fails.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "assets", "heatmap.svg");
const USERNAME = process.env.GH_USERNAME || "sepehrmn";
const TOKEN = process.env.GH_TOKEN; // optional locally; required for private events

if (!TOKEN) {
  console.warn(
    "[heatmap] GH_TOKEN not set — using unauthenticated public data. " +
      "Configure GH_TOKEN in workflow secrets for private contribution coverage."
  );
}

// ---------------------------------------------------------------------------
// 0. Helpers.
// ---------------------------------------------------------------------------
const XML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const escapeXML = (s) => String(s).replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);
// Note on SMIL <animate> survival: GitHub's camo image proxy forwards SVG
// markup verbatim, including SMIL animation elements. As long as this SVG
// is served from raw.githubusercontent.com (or another GitHub-camo-friendly
// host), the pulse animation players will see in a <picture>/<img> tag.

// ---------------------------------------------------------------------------
// 1. Fetch GraphQL contributionCalendar (last 365 days) + per-type totals.
// ---------------------------------------------------------------------------
const GRAPHQL_URL = "https://api.github.com/graphql";
const GRAPHQL_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              contributionLevel
              date
              weekday
            }
          }
        }
        pullRequestContributions(first: 0) { totalCount }
        issueContributions(first: 0) { totalCount }
        pullRequestReviewContributions(first: 0) { totalCount }
      }
    }
  }
`;

async function fetchCalendar(login) {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(TOKEN ? { Authorization: `bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { login } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GraphQL ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data?.user?.contributionsCollection ?? null;
}

// ---------------------------------------------------------------------------
// 2. REST /events/public for precise per-day commit counts (last ~90 days).
//    Gracefully degrades on auth/rate limits — we still get reasonable
//    per-day data via the GraphQL contribution calendar.
// ---------------------------------------------------------------------------
async function fetchPushEventsPerDay(login) {
  const perDay = new Map();
  let page = 1;
  while (page <= 3) {
    const url = `https://api.github.com/users/${encodeURIComponent(
      login
    )}/events/public?per_page=100&page=${page}`;
    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/vnd.github+json", ...(TOKEN ? { Authorization: `bearer ${TOKEN}` } : {}) },
      });
    } catch (err) {
      console.warn(`[heatmap] REST events fetch network error: ${err.message}`);
      return perDay;
    }
    if (!res.ok) {
      // Auth/rate-limit failures here should NOT abort the pipeline — we have
      // GraphQL data for the calendar; commit precision just degrades.
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        console.warn(
          `[heatmap] REST events ${res.status} — falling back to GraphQL-only commit ratio.`
        );
      }
      return perDay;
    }
    const events = await res.json().catch(() => []);
    if (!Array.isArray(events) || events.length === 0) break;
    for (const ev of events) {
      if (ev?.type !== "PushEvent") continue;
      const day = String(ev.created_at ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const size = ev.payload?.size ?? 0;
      perDay.set(day, (perDay.get(day) ?? 0) + size);
    }
    page += 1;
  }
  return perDay;
}

// ---------------------------------------------------------------------------
// 3. Combine calendar + events to per-day metrics. Uses empirical commit
//    ratio from the period covered by REST events (last ~90 days) as a
//    fallback for older days, where per-day commit counts aren't exposed.
// ---------------------------------------------------------------------------
function combine(days, pushEvents, totals) {
  const knownDays = days.filter((d) => pushEvents.has(d.date));
  const knownCommits = knownDays.reduce(
    (s, d) => s + Math.min(pushEvents.get(d.date) ?? 0, d.contributionCount ?? 0),
    0
  );
  const knownTotal = knownDays.reduce((s, d) => s + (d.contributionCount ?? 0), 0);
  // Empirical commit ratio from the precise window. If the events API was
  // empty, fall back to a ratio derived from the GitHubGraph per-type totals.
  let ratio = knownTotal > 0 ? knownCommits / knownTotal : null;
  if (ratio === null && totals) {
    const tCommits = Number(totals.commits ?? 0);
    const tPrs = Number(totals.prs ?? 0);
    const tIssues = Number(totals.issues ?? 0);
    const tReviews = Number(totals.reviews ?? 0);
    const tAll = tCommits + tPrs + tIssues + tReviews;
    ratio = tAll > 0 ? tCommits / tAll : 0.65;
  }
  if (ratio === null) ratio = 0; // truly unreachable in practice — every collapse path above supplies a value

  return days.map((d) => {
    const total = d.contributionCount ?? 0;
    const precise = pushEvents.get(d.date);
    const commits =
      typeof precise === "number" && precise > 0
        ? Math.min(precise, total)
        : Math.round(total * ratio);
    return {
      date: d.date,
      weekday: d.weekday,
      total,
      commits,
      ratio: total > 0 ? commits / total : 0,
      level: d.contributionLevel ?? "NONE",
    };
  });
}

// ---------------------------------------------------------------------------
// 4. Empty-grid fallback for the case where BOTH GraphQL and REST failed.
//    Generates a 365-day empty calendar so workflow artifacts still commit.
// ---------------------------------------------------------------------------
function placeholderMetrics() {
  const today = new Date();
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = d.toISOString().slice(0, 10);
    days.push({
      date: iso,
      weekday: d.getUTCDay(),
      contributionCount: 0,
      contributionLevel: "NONE",
    });
  }
  return {
    metrics: days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      total: 0,
      commits: 0,
      ratio: 0,
      level: "NONE",
    })),
    warning:
      "Live contribution data could not be fetched — both GraphQL and REST " +
      "endpoints failed (likely unauthenticated local run). Showing empty grid.",
  };
}

// ---------------------------------------------------------------------------
// 5. Render SVG.
// ---------------------------------------------------------------------------
const CELL = 13;
const GAP = 3;
const DAY_LABEL_COL = 24;
const MONTH_LABEL_ROW = 18;
const PADDING_X = 16;
const PADDING_Y = 12;
const FOOTER_ROW = 26;

// Cell class: returns a CSS class that the <style> block styles per
// color-scheme. Returning a class instead of an inline color avoids the
// rgb-string enumeration that broke light-mode coverage.
function metricClass(metric) {
  if (metric.total === 0) return "cell-empty";
  const commitHeavy = metric.ratio >= 0.5 && metric.commits >= 2;
  if (!commitHeavy) {
    if (metric.total >= 6) return "cell-pr-high";
    if (metric.total >= 3) return "cell-pr-mid";
    return "cell-pr-low";
  }
  if (metric.commits >= 5) return "cell-c-peak";
  if (metric.commits >= 3) return "cell-c-mid";
  return "cell-c-low";
}

// Pulse cells in top quartile by COMMIT count among active days, AND where
// commits dominate. Threshold is fractional so high-volume users don't have
// every cell pulsing.
function shouldPulse(metric, allMetrics) {
  if (metric.total === 0) return false;
  const active = allMetrics.filter((m) => m.total > 0 && m.ratio >= 0.5 && m.commits >= 2);
  if (active.length === 0) return false;
  const sorted = [...active].sort((a, b) => b.commits - a.commits);
  const quartileIdx = Math.max(0, Math.floor(sorted.length * 0.25) - 1);
  const quartileThreshold = sorted[quartileIdx]?.commits ?? Infinity;
  return metric.commits >= quartileThreshold && metric.ratio >= 0.5 && metric.commits >= 2;
}

function renderSVG(metrics, warning) {
  const weeks = [];
  let currentWeek = new Array(7).fill(null);
  for (const d of metrics) {
    const idx = d.weekday;
    currentWeek[idx] = d;
    if (idx === 6) {
      weeks.push(currentWeek);
      currentWeek = new Array(7).fill(null);
    }
  }
  if (currentWeek.some((d) => d !== null)) weeks.push(currentWeek);

  const totalWeeks = weeks.length;
  const gridW = totalWeeks * (CELL + GAP);
  const gridH = 7 * (CELL + GAP);
  const width = PADDING_X + DAY_LABEL_COL + gridW + PADDING_X;
  const height = PADDING_Y + MONTH_LABEL_ROW + gridH + FOOTER_ROW;

  const totalContributions = metrics.reduce((s, m) => s + m.total, 0);
  const totalCommits = metrics.reduce((s, m) => s + m.commits, 0);
  const startDate = metrics[0]?.date ?? "—";
  const endDate = metrics[metrics.length - 1]?.date ?? "—";

  // Month labels — one per month transition.
  const monthLabels = [];
  let lastMonth = "";
  weeks.forEach((week, wi) => {
    const firstDay = week.find((d) => d);
    if (!firstDay) return;
    const month = String(firstDay.date ?? "").slice(0, 7);
    if (month && month !== lastMonth) {
      lastMonth = month;
      const label = new Date(firstDay.date).toLocaleString("en-US", { month: "short" });
      monthLabels.push({ x: PADDING_X + DAY_LABEL_COL + wi * (CELL + GAP), label });
    }
  });
  const monthLabelsSvg = monthLabels
    .map(
      (m) =>
        `<text x="${m.x}" y="${PADDING_Y + MONTH_LABEL_ROW - 4}" class="label">${escapeXML(m.label)}</text>`
    )
    .join("");

  const dayLabelsSvg = ["Mon", "Wed", "Fri"]
    .map((label, i) => {
      const weekdayIndex = i === 0 ? 1 : i === 1 ? 3 : 5;
      return `<text x="${PADDING_X}" y="${
        PADDING_Y + MONTH_LABEL_ROW + weekdayIndex * (CELL + GAP) + CELL - 2
      }" class="day-label">${escapeXML(label)}</text>`;
    })
    .join("");

  const cellsSvg = weeks
    .map((week, wi) =>
      week
        .map((day, di) => {
          if (!day) return "";
          const x = PADDING_X + DAY_LABEL_COL + wi * (CELL + GAP);
          const y = PADDING_Y + MONTH_LABEL_ROW + di * (CELL + GAP);
          const cls = metricClass(day);
          const stroke = day.total === 0 ? "#1f2937" : "none";
          const pulse = shouldPulse(day, metrics);
          const tip = `${day.date} · ${day.commits} commits / ${day.total} contributions`;
          return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" ry="2" class="${escapeXML(cls)}" stroke="${escapeXML(stroke)}"      data-date="${escapeXML(day.date)}" data-commits="${escapeXML(String(day.commits))}" data-total="${escapeXML(String(day.total))}""><title>${escapeXML(tip)}</title>${
            pulse
              ? `<animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" begin="${(wi * 0.03 + di * 0.05).toFixed(2)}s"/>`
              : ""
          }</rect>`;
        })
        .join("")
    )
    .join("");

  const legendY = PADDING_Y + MONTH_LABEL_ROW + gridH + 16;  const swatches = [
    "cell-empty", "cell-pr-low", "cell-pr-mid", "cell-pr-high",
    "cell-c-low", "cell-c-mid", "cell-c-peak",
  ] 
    .map(
      (c, i) =>
        `<rect x="${PADDING_X + i * (CELL + GAP)}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2" ry="2" class="${escapeXML(c)}"/>`
    )
    .join("");
  const legendText = `<text x="${PADDING_X + 7 * (CELL + GAP) + 8}" y="${
    legendY + CELL - 3
  }" class="legend">PR-only \u2192 commit-heavy ... More commits</text>`;

  const warningBanner = warning
    ? `<text x="${width / 2}" y="${height - 2}" text-anchor="middle" class="warning">${escapeXML(warning)}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Activity heatmap — ${totalCommits} commits across ${totalContributions} contributions from ${startDate} to ${endDate}">
  <style>
    .label { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .day-label { font: 500 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .legend { font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .summary { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #67e8f9; }
    .warning { font: 500 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fbbf24; }
    /* Cell palette — single source of truth, class-driven. Default = dark.
       IMPORTANT: .cell-empty's light-mode #ebedf0 is load-bearing — it's the
       lightest contrast anchor against #ebedf0 backgrounds, so any future
       refactor must keep this distinguishable from the *-pr-* set. */
    .cell-empty { fill: #161b22; /* dark loader */ }
    .cell-pr-low { fill: #6e6e78; }
    .cell-pr-mid { fill: #7d7d87; }
    .cell-pr-high { fill: #8c8c96; }
    .cell-c-low { fill: #0891b2; }
    .cell-c-mid { fill: #22d3ee; }
    .cell-c-peak { fill: #67e8f9; }
    @media (prefers-color-scheme: light) {
      .label { fill: #1f2328; }
      .day-label { fill: #57606a; }
      .legend { fill: #1f2328; }
      .summary { fill: #0891b2; }
      .warning { fill: #b45309; }
      /* Inverted palette so cells stay legible on white. */
      .cell-empty { fill: #ebedf0; }
      .cell-pr-low { fill: #d4d4dc; }
      .cell-pr-mid { fill: #c0c0c8; }
      .cell-pr-high { fill: #a8a8b0; }
      .cell-c-low { fill: #0369a1; }
      .cell-c-mid { fill: #0c4a6e; }
      .cell-c-peak { fill: #0c2a4a; }
      rect[stroke="#1f2937"] { stroke: #d0d7de; }
    }
  </style>
  <rect width="${width}" height="${height}" fill="transparent"/>
  ${monthLabelsSvg}
  ${dayLabelsSvg}
  ${cellsSvg}
  <text x="${PADDING_X}" y="${legendY}" class="legend">${totalCommits} commits / ${totalContributions} contributions</text>
  ${swatches}
  ${legendText}
  <text x="${width - PADDING_X}" y="${legendY}" text-anchor="end" class="summary">${escapeXML(startDate)} → ${escapeXML(endDate)}</text>
  ${warningBanner}
</svg>`;
}

// ---------------------------------------------------------------------------
// 6. Pipeline.
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[heatmap] fetching data for ${USERNAME}…`);
  let metrics = [];
  let warning = null;

  try {
    const collection = await fetchCalendar(USERNAME);
    if (!collection) throw new Error("empty contributionsCollection");
    const weeks = collection.contributionCalendar.weeks ?? [];
    const flatDays = weeks.flatMap((w) => w.contributionDays ?? []);
    // Infer commits via remainder: GitHub's contribution heatmap caps each
    // day at 4 visible contributions, but per-type totals reflect raw event
    // counts for the same window — so a slight negative drift is possible.
    // Clamp at 0 and treat the remainder as commit count.
    const prs = collection.pullRequestContributions?.totalCount ?? 0;
    const issues = collection.issueContributions?.totalCount ?? 0;
    const reviews = collection.pullRequestReviewContributions?.totalCount ?? 0;
    const totals = {
      prs,
      issues,
      reviews,
      commits: Math.max(
        0,
        collection.contributionCalendar.totalContributions - prs - issues - reviews
      ),
    };
    const pushEvents = await fetchPushEventsPerDay(USERNAME);
    metrics = combine(flatDays, pushEvents, totals);
    console.log(
      `[heatmap] built metrics for ${flatDays.length} days; ` +
        `${totalContributionsString(metrics)}; ` +
        `${pushEvents.size} days with precise commit data from REST events`
    );
  } catch (err) {
    console.warn(`[heatmap] falling back to empty grid: ${err.message}`);
    const fb = placeholderMetrics();
    metrics = fb.metrics;
    warning = fb.warning;
  }

  const svg = renderSVG(metrics, warning);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, svg, "utf8");
  console.log(`[heatmap] wrote ${OUT_PATH} (${svg.length} bytes)`);
}

function totalContributionsString(metrics) {
  const total = metrics.reduce((s, m) => s + m.total, 0);
  const commits = metrics.reduce((s, m) => s + m.commits, 0);
  return `${commits} commits / ${total} contributions`;
}

main().catch((err) => {
  console.error("[heatmap] FATAL:", err?.message ?? err);
  process.exit(1);
});
