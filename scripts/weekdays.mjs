#!/usr/bin/env node
// scripts/weekdays.mjs
// Generates assets/weekdays.svg from live GitHub contribution data.
// Zero npm dependencies; uses the global `fetch` (Node 20+).
//
// Why this exists instead of a 365-day grid: GitHub already renders the
// native year-long contribution heatmap on github.com/<user>, so copying
// it on the README is redundant. This chart answers a *different* question:
// "what's my weekday rhythm?" — a stat the year-long grid cannot surface.
// 7 bars (Mon→Sun) showing per-weekday contribution totals over the last
// ~13 weeks (91 days), with the peak weekday highlighted and animated.
//
// DATA SOURCE — server-rendered HTML fragment, NOT the API:
//   https://github.com/users/{login}/contributions
// This is a *different host* (github.com, not api.github.com) that returns a
// server-rendered HTML fragment of the user's last ~365 contribution days.
// It is NOT subject to the api.github.com rate limit, which matters because
// GitHub Actions runners share IP ranges with massive unauthenticated
// traffic and so the 60/hr unauthenticated API limit is permanently
// exhausted there (the GraphQL user(login:) query 403s on every CI run).
// The default GITHUB_TOKEN can't rescue us either — it's repo-scoped and
// can't satisfy the user-scoped contributionsCollection query.
//
// The fragment encodes each day as:
//   <td class="ContributionCalendar-day" data-date="YYYY-MM-DD" data-level="0..4">
// with a sibling <tool-tip> holding the human-readable count, e.g.
//   "31 contributions on June 13th."  /  "No contributions on June 14th."
// We parse date + count out of the tool-tip text (authoritative; data-level
// is only a 0..4 bucket). The fragment is server-rendered HTML, so no JS,
// no JSON blob to hunt for.
//
// TRADEOFF: the fragment has no per-type breakdown (commits vs PR vs issue),
// so this chart shows per-weekday TOTAL contributions (no cyan/gray split).
// That's the honest representation of what this data source can support.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "assets", "weekdays.svg");
const USERNAME = process.env.GH_USERNAME || "sepehrmn";

// ---------------------------------------------------------------------------
// 0. Helpers
// ---------------------------------------------------------------------------
const XML_ENTITIES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const escapeXML = (s) => String(s).replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WINDOW_DAYS = 91; // ~13 weeks; one quarter of activity.

// GitHub's calendar week starts on Sunday. We want Monday-first bars, so a
// JS Date.getUTCDay() of 0 (Sun) maps to index 6, 1 (Mon)→0, … 6 (Sat)→5.
const toMonFirst = (jsDow) => (Number(jsDow) + 6) % 7;

// ---------------------------------------------------------------------------
// 1. Fetch the server-rendered contribution fragment and parse per-day counts.
//    Returns [{date, count, weekday}], in DOCUMENT order (NOT chronological —
//    see note below). count is 0 for empty days; weekday is Mon-first 0..6.
// ---------------------------------------------------------------------------
const FRAGMENT_URL = (login) =>
  `https://github.com/users/${encodeURIComponent(login)}/contributions`;

// Parse "<N> contributions on <Month> <day>." or "No contributions on …"
// out of a <tool-tip> body. Returns 0 for "No contributions" / unparseable.
const parseTipCount = (tipText) => {
  const m = tipText.match(/(\d+)\s+contributions?\b/i);
  return m ? Number(m[1]) : 0; // "No contributions …" → 0
};

// IMPORTANT: the fragment lists days in ROW-MAJOR order — all Sundays first
// (one per week, across columns), then all Mondays, etc. — NOT chronologically.
// We must therefore NOT rely on entry order for recency; instead each cell
// carries its own data-date and we filter by date in aggregate(). Pairing
// dates[i] ↔ tips[i] IS valid because the two appear interleaved 1:1 in
// document order (verified: every data-date is immediately followed by its
// own tool-tip). Both regexes preserve that order.
async function fetchDailyCounts(login) {
  const res = await fetch(FRAGMENT_URL(login), {
    headers: {
      // A real browser UA: github.com sometimes varies markup for bots, and a
      // UA also avoids any bot-throttle heuristics. No auth needed — this is a
      // public, server-rendered page.
      "User-Agent":
        "Mozilla/5.0 (compatible; sepehrmn-profile-weekdays-chart/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`contributions fragment ${res.status}: ${body.slice(0, 160)}`);
  }
  const html = await res.text();

  const dates = [...html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"/g)].map(
    (m) => m[1]
  );
  const tipBlocks = [...html.matchAll(/<tool-tip[^>]*>([\s\S]*?)<\/tool-tip>/g)].map(
    (m) => m[1].trim()
  );

  if (dates.length === 0) {
    throw new Error("no data-date cells found in contributions fragment");
  }

  // Defensive: if the counts and dates don't line up 1:1 (GitHub changes
  // markup), fall back to data-level buckets so the chart still renders.
  const useTips = tipBlocks.length === dates.length;
  if (!useTips) {
    console.warn(
      `[weekdays] tool-tip count (${tipBlocks.length}) != date count (${dates.length}) — ` +
        `markup may have changed; falling back to data-level buckets (0..4 only, less precise).`
    );
  }
  const LEVEL_MIDPOINTS = [0, 1, 3, 7, 12];
  const levels = [...html.matchAll(/data-level="(\d)"/g)].map((m) => Number(m[1]));

  return dates.map((date, i) => {
    const d = new Date(date + "T00:00:00Z");
    return {
      date,
      count: useTips
        ? parseTipCount(tipBlocks[i] ?? "")
        : LEVEL_MIDPOINTS[levels[i]] ?? 0,
      weekday: Number.isNaN(d.getTime()) ? -1 : toMonFirst(d.getUTCDay()),
      precise: useTips,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Aggregate → per-weekday totals over the last WINDOW_DAYS.
//    Filters by DATE (not array position): the fragment is row-major, so the
//    "last N entries" are NOT the most recent N days. Each cell carries its own
//    precomputed weekday, so we avoid re-parsing dates here too.
// ---------------------------------------------------------------------------
function aggregate(daily) {
  // "Today" = newest date present in the fragment (robust to the fragment
  // lagging a day or two behind real-time, and to CI timezone quirks).
  const allDates = daily
    .map((d) => d.date)
    .filter(Boolean)
    .sort();
  const newest = allDates[allDates.length - 1];
  const newestMs = newest ? Date.parse(newest + "T00:00:00Z") : Date.now();
  const cutoffMs = newestMs - WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const weekdayTotal = new Array(7).fill(0);
  let used = 0;
  for (const cell of daily) {
    const t = cell.date ? Date.parse(cell.date + "T00:00:00Z") : NaN;
    if (Number.isNaN(t) || t < cutoffMs || t > newestMs) continue;
    if (cell.weekday >= 0 && cell.weekday < 7) {
      weekdayTotal[cell.weekday] += cell.count;
      used += 1;
    }
  }
  const perDay = DAY_LABELS.map((label, i) => ({
    label,
    total: weekdayTotal[i],
  }));
  const peakTotal = perDay.reduce((m, d) => Math.max(m, d.total), 0);
  const grandTotal = perDay.reduce((s, d) => s + d.total, 0);
  return {
    perDay,
    peakTotal,
    grandTotal,
    windowDays: WINDOW_DAYS,
    cellsUsed: used,
  };
}

// ---------------------------------------------------------------------------
// 3. No-data placeholder (still valid SVG so the workflow artifact commits).
// ---------------------------------------------------------------------------
function placeholder(errorMessage) {
  const fallback =
    "Live contribution data could not be fetched — the github.com contributions fragment failed. Retry on the next daily cron.";
  const warning = errorMessage
    ? `Live contribution data could not be fetched: ${errorMessage}`
    : fallback;
  return {
    perDay: DAY_LABELS.map((label) => ({ label, total: 0 })),
    peakTotal: 0,
    grandTotal: 0,
    windowDays: WINDOW_DAYS,
    cellsUsed: 0,
    warning,
  };
}

// ---------------------------------------------------------------------------
// 4. Render SVG.
// ---------------------------------------------------------------------------
const W = 760;
const H = 200;
const PAD_LEFT = 40;
const PAD_RIGHT = 40;
const PLOT_TOP = 36;
const PLOT_BOTTOM = 150;
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const PLOT_LEFT = PAD_LEFT;
const PLOT_RIGHT = W - PAD_RIGHT;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const BAR_W = 56;
const BAR_GAP = (PLOT_WIDTH - 7 * BAR_W) / 6; // ≈48

function renderSVG(model) {
  const { perDay, peakTotal, grandTotal, warning, windowDays } = model;
  // Avoid divide-by-zero when the window is entirely empty.
  const yMax = Math.max(peakTotal, 1);

  const bars = perDay
    .map((day, i) => {
      const x = PLOT_LEFT + i * (BAR_W + BAR_GAP);
      const cx = x + BAR_W / 2;
      const totalH = (day.total / yMax) * PLOT_HEIGHT;
      const baseY = PLOT_BOTTOM - totalH;
      const isPeak = day.total > 0 && day.total === peakTotal;
      const tip = `${day.label}: ${day.total} contributions over the last ${windowDays} days`;
      const tipEsc = escapeXML(tip);
      return [
        totalH > 0
          ? `<rect x="${x}" y="${baseY}" width="${BAR_W}" height="${totalH}" rx="3" ry="3" class="bar"><title>${tipEsc}</title>${
              isPeak
                ? `<animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite"/>`
                : ""
            }</rect>`
          : "",
        `<text x="${cx}" y="${baseY - 6}" text-anchor="middle" class="value">${day.total}</text>`,
        `<text x="${cx}" y="${PLOT_BOTTOM + 18}" text-anchor="middle" class="day">${escapeXML(
          day.label
        )}</text>`,
      ].join("");
    })
    .join("");

  const baseline = `<line x1="${PLOT_LEFT}" y1="${PLOT_BOTTOM}" x2="${PLOT_RIGHT}" y2="${PLOT_BOTTOM}" class="baseline"/>`;

  const title = `<text x="${PLOT_LEFT}" y="20" class="title">Activity by weekday</text>`;
  const subtitle = grandTotal > 0
    ? `<text x="${PLOT_RIGHT}" y="20" text-anchor="end" class="subtitle">${grandTotal} contributions · last ${windowDays} days</text>`
    : `<text x="${PLOT_RIGHT}" y="20" text-anchor="end" class="subtitle">last ${windowDays} days</text>`;
  const caption = `<text x="${PLOT_LEFT}" y="${
    H - 8
  }" class="caption">total contributions per weekday (Mon→Sun) · animated bar marks the peak day · complements GitHub's native 365-day heatmap</text>`;
  const warningBanner = warning
    ? `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="warning">${escapeXML(
        warning
      )}</text>`
    : "";

  const aria = peakTotal > 0
    ? `Activity by weekday — ${grandTotal} contributions over the last ${windowDays} days, peak ${peakTotal} on a single weekday`
    : `Activity by weekday — no data over the last ${windowDays} days`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <style>
    .title { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #67e8f9; }
    .subtitle { font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .value { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .day { font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .caption { font: 400 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; }
    .warning { font: 500 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fbbf24; }
    .baseline { stroke: #30363d; stroke-width: 1; }
    .bar { fill: #22d3ee; }
    @media (prefers-color-scheme: light) {
      .title { fill: #0891b2; }
      .subtitle { fill: #57606a; }
      .value { fill: #1f2328; }
      .day { fill: #57606a; }
      .caption { fill: #6e7681; }
      .warning { fill: #b45309; }
      .baseline { stroke: #d0d7de; }
      .bar { fill: #0891b2; }
    }
  </style>
  <rect width="${W}" height="${H}" fill="transparent"/>
  ${title}
  ${subtitle}
  ${baseline}
  ${bars}
  ${caption}
  ${warningBanner}
</svg>`;
}

// ---------------------------------------------------------------------------
// 5. Pipeline.
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[weekdays] fetching contributions fragment for ${USERNAME}…`);
  let model;
  try {
    const daily = await fetchDailyCounts(USERNAME);
    const oldest = daily[0]?.date;
    const newest = daily[daily.length - 1]?.date;
    console.log(
      `[weekdays] parsed ${daily.length} day cells. precise=${daily.every((d) => d.precise)}`
    );
    model = aggregate(daily);
    console.log(
      `[weekdays] built ${model.perDay.length}-bar model over last ${model.windowDays} days ` +
        `(${model.cellsUsed} cells summed); total=${model.grandTotal}; peak=${model.peakTotal}.`
    );
  } catch (err) {
    const msg = String(err?.message ?? err);
    console.warn(`[weekdays] failed (reason below); using placeholder: ${msg}`);
    model = placeholder(msg);
  }

  const svg = renderSVG(model);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, svg, "utf8");
  console.log(`[weekdays] wrote ${OUT_PATH} (${svg.length} bytes)`);
}

main().catch((err) => {
  console.error("[weekdays] FATAL:", err?.message ?? err);
  process.exit(1);
});
