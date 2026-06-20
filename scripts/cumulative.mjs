#!/usr/bin/env node
// scripts/cumulative.mjs
// Generates assets/cumulative.svg — an annual contribution bar chart
// (2020 → current year) with a headline cumulative total.
// Zero npm dependencies; uses the global `fetch` (Node 20+).
//
// DESIGN COUSIN of weekdays.svg: same design language (brand cyan, monospace,
// dark/light theming via internal prefers-color-scheme, SMIL animation gated
// by prefers-reduced-motion). Bolder than weekdays: vertical gradient bars,
// a glowing peak bar, a left-to-right draw-in on load, and a large headline
// cumulative total.
//
// DATA SOURCE — server-rendered HTML fragment, NOT the API (same rationale as
// weekdays.mjs). The endpoint github.com/users/{login}/contributions accepts a
// ?from=YYYY-01-01 query param that returns that FULL calendar year, and embeds
// the per-year total in an <h2 id="js-contribution-activity-description">:
//     <h2 ...>1,676\n contributions\n in 2024</h2>
// We loop from=2020-01-01 .. from=<currentYear>-01-01 and parse that total
// (one regex per year, robust to the whitespace/newlines between tokens).
// This host is NOT api.github.com, so it is not subject to the 60/hr
// unauthenticated rate limit that is permanently exhausted on Actions runners.
//
// FALLBACK: if the <h2> regex misses for a given year (markup drift), sum the
// per-day <tool-tip> counts for that year instead (same regex pair weekdays.mjs
// uses), so the bar still renders with accurate data.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "assets", "cumulative.svg");
const USERNAME = process.env.GH_USERNAME || "sepahead";
// NO TOKEN by design. The public per-year <h2> total already INCLUDES this
// user's private contributions (the profile has "Include private contributions
// on my profile" enabled — verified: the unauthenticated h2 equals the
// authenticated contributionsCollection total). So the unauthenticated numbers
// are already complete, and we avoid a PAT that could expose private repos.
// First year of activity on GitHub for this user (created 2014, but
// contribution tracking is only meaningful from 2020 onward per the chart's
// scope — matches the prior external chart's from=2020-01-01).
const START_YEAR = Number(process.env.CUMULATIVE_START_YEAR) || 2020;

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

// 1,234 -> "1,234" (en-US grouping). Browsers render SVG <text> locale-agnostic.
const fmt = (n) => Number(n).toLocaleString("en-US");

// Current UTC year — the in-progress year is included as its own bar.
const currentYear = () => new Date().getUTCFullYear();

// ---------------------------------------------------------------------------
// 1. Fetch per-year totals from the contribution fragment.
//    Returns [{year, total}], ascending by year. Uses the embedded <h2> total;
//    falls back to summing per-day <tool-tip> counts if the <h2> is absent.
// ---------------------------------------------------------------------------
const FRAGMENT_URL = (login, year) =>
  `https://github.com/users/${encodeURIComponent(
    login
  )}/contributions?from=${year}-01-01`;

// Parse "<N> contributions on <Month> <day>." for the fallback path.
const parseTipCount = (tipText) => {
  const m = tipText.match(/(\d+)\s+contributions?\b/i);
  return m ? Number(m[1]) : 0;
};


async function fetchYearTotal(login, year) {
  const res = await fetch(FRAGMENT_URL(login, year), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; sepahead-profile-cumulative-chart/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `contributions fragment ${res.status} for ${year}: ${body.slice(0, 160)}`
    );
  }
  const html = await res.text();

  // Primary: the embedded <h2> "... contributions in YYYY" total.
  const h2 = html.match(/([\d,]+)\s+contributions\s+in\s+\d{4}/i);
  if (h2) {
    return { year, total: Number(h2[1].replace(/,/g, "")), source: "h2" };
  }

  // Fallback: sum per-day <tool-tip> counts (same pair as weekdays.mjs).
  const tipBlocks = [
    ...html.matchAll(/<tool-tip[^>]*>([\s\S]*?)<\/tool-tip>/g),
  ].map((m) => m[1].trim());
  const total = tipBlocks.reduce((s, t) => s + parseTipCount(t), 0);
  console.warn(
    `[cumulative] <h2> total missing for ${year}; summed ${tipBlocks.length} tool-tips → ${total}.`
  );
  return { year, total, source: "tooltip-sum" };
}

async function fetchYearTotals(login, startYear, endYear) {
  const out = [];
  for (let year = startYear; year <= endYear; year += 1) {
    out.push(await fetchYearTotal(login, year));
  }
  return out; // ascending by year
}

// ---------------------------------------------------------------------------
// 2. Build the render model (add cumulative + flag the in-progress year).
// ---------------------------------------------------------------------------
function buildModel(years) {
  let cumulative = 0;
  let peak = 0;
  let peakYear = years[0]?.year ?? START_YEAR;
  const rows = years.map((y) => {
    cumulative += y.total;
    if (y.total > peak) {
      peak = y.total;
      peakYear = y.year;
    }
    return { ...y, cumulative, isCurrent: y.year === currentYear() };
  });
  return {
    rows,
    peak,
    peakYear,
    cumulative,
    startYear: years[0]?.year ?? START_YEAR,
  };
}

// ---------------------------------------------------------------------------
// 3. No-data placeholder (still valid SVG so the workflow artifact commits).
// ---------------------------------------------------------------------------
function placeholder(errorMessage) {
  const warning = errorMessage
    ? `Live contribution data could not be fetched: ${errorMessage}`
    : "Live contribution data could not be fetched.";
  return {
    rows: [],
    peak: 0,
    peakYear: START_YEAR,
    cumulative: 0,
    startYear: START_YEAR,
    warning,
  };
}

// ---------------------------------------------------------------------------
// 4. Render SVG.
//    Layout: headline total top-left; a bar per year; faint gridlines.
//    Bars: vertical cyan gradient, glowing + pulsing peak, staggered draw-in.
// ---------------------------------------------------------------------------
const W = 820;
const H = 280;
const PAD_LEFT = 56;
const PAD_RIGHT = 28;
const HEAD_TOP = 26; // headline number
const PLOT_TOP = 92;
const PLOT_BOTTOM = 224; // baseline; year labels sit below
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP;
const PLOT_LEFT = PAD_LEFT;
const PLOT_RIGHT = W - PAD_RIGHT;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;

// "Nice" rounded-up max for the y-axis (e.g. 1996 -> 2000; 1676 -> 2000).
const niceMax = (v) => {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
};

function renderSVG(model) {
  const { rows, peak, peakYear, cumulative, warning, startYear } = model;
  const yMax = niceMax(peak);
  const n = rows.length || 1;

  // Bar geometry: even spacing across the plot width.
  const slot = PLOT_WIDTH / n;
  const barW = Math.min(slot * 0.62, 64);

  // Gridlines: 4 horizontal lines at 0, 25/50/75/100% of yMax.
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  const gridlines = gridSteps
    .map((frac) => {
      const y = PLOT_BOTTOM - frac * PLOT_HEIGHT;
      const val = Math.round(frac * yMax);
      return `<line x1="${PLOT_LEFT}" y1="${y.toFixed(1)}" x2="${PLOT_RIGHT}" y2="${y.toFixed(1)}" class="grid"/>
<text x="${PLOT_LEFT - 10}" y="${(y + 3).toFixed(1)}" text-anchor="end" class="axis">${val >= 1000 ? (val / 1000) + "k" : val}</text>`;
    })
    .join("\n  ");

  const bars = rows
    .map((row, i) => {
      const cx = PLOT_LEFT + slot * i + slot / 2;
      const x = cx - barW / 2;
      const h = yMax > 0 ? (row.total / yMax) * PLOT_HEIGHT : 0;
      const y = PLOT_BOTTOM - h;
      const isPeak = peak > 0 && row.total === peak;
      // Staggered draw-in: each bar starts from the baseline and grows.
      const begin = 0.15 + i * 0.13; // seconds
      const dur = 0.7; // seconds
      // Peak pulse starts only AFTER the draw-in finishes (begin + dur), so
      // the glow doesn't throb while the bar is still rising.
      const pulseBegin = begin + dur;
      const title = `${row.year}: ${fmt(row.total)} contributions${
        row.isCurrent ? " (year in progress)" : ""
      } · cumulative ${fmt(row.cumulative)}`;
      const titleEsc = escapeXML(title);
      return `
  <g>
    ${isPeak ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="5" class="bar-glow"/>` : ""}
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="5" class="bar${isPeak ? " peak" : ""}">
      <title>${titleEsc}</title>
      <animate attributeName="height" from="0" to="${h.toFixed(1)}" begin="${begin.toFixed(2)}s" dur="${dur}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>
      <animate attributeName="y" from="${PLOT_BOTTOM}" to="${y.toFixed(1)}" begin="${begin.toFixed(2)}s" dur="${dur}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>
      ${isPeak ? `<animate attributeName="opacity" values="1;0.65;1" dur="2.6s" begin="${pulseBegin.toFixed(2)}s" repeatCount="indefinite"/>` : ""}
    </rect>
    <g class="bar-label">
      <text x="${cx.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" class="value">${fmt(row.total)}
        <animate attributeName="y" from="${PLOT_BOTTOM}" to="${(y - 8).toFixed(1)}" begin="${begin.toFixed(2)}s" dur="${dur}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>
        <animate attributeName="opacity" from="0" to="1" begin="${(begin + dur * 0.6).toFixed(2)}s" dur="${(dur * 0.4).toFixed(2)}s" fill="freeze"/>
      </text>
    </g>
    <text x="${cx.toFixed(1)}" y="${PLOT_BOTTOM + 22}" text-anchor="middle" class="year${isPeak ? " year-peak" : ""}">${row.year}</text>
  </g>`;
    })
    .join("");

  const headlineNum = fmt(cumulative);
  const lastYear = rows.length ? rows[rows.length - 1].year : currentYear();
  const rangeLabel = `${startYear}–${lastYear}`;
  const warningBanner = warning
    ? `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="warning">${escapeXML(
        warning
      )}</text>`
    : "";

  const aria = cumulative > 0
    ? `Cumulative contributions ${rangeLabel}: ${fmt(cumulative)} total, peak ${fmt(peak)} in a single year`
    : `Cumulative contributions ${rangeLabel}: no data`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="100%" stop-color="#0891b2"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <style>
    .headline { font: 700 38px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #22d3ee; letter-spacing: -1px; }
    .sub { font: 500 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .value { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .year { font: 500 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .year-peak { font-weight: 700; fill: #22d3ee; }
    .axis { font: 400 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; }
    .warning { font: 500 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fbbf24; }
    .grid { stroke: #21262d; stroke-width: 1; }
    .baseline { stroke: #30363d; stroke-width: 1; }
    .bar { fill: url(#barGrad); }
    .bar-glow { fill: #22d3ee; filter: url(#glow); opacity: 0.55; }
    .bar-label { opacity: 1; }
    @media (prefers-color-scheme: light) {
      .headline { fill: #0891b2; }
      .sub { fill: #57606a; }
      .value { fill: #1f2328; }
      .year { fill: #57606a; }
      .year-peak { fill: #0891b2; }
      .axis { fill: #6e7681; }
      .warning { fill: #b45309; }
      .grid { stroke: #eaeef2; }
      .baseline { stroke: #d0d7de; }
    }
    @media (prefers-reduced-motion: reduce) {
      animate, animateTransform { display: none; }
    }
  </style>
  <rect width="${W}" height="${H}" fill="transparent"/>
  <text x="${PAD_LEFT}" y="${HEAD_TOP + 36}" class="headline">${headlineNum}</text>
  <text x="${PAD_LEFT}" y="${HEAD_TOP + 56}" class="sub">total contributions since ${startYear}</text>
  ${peak > 0
    ? `<text x="${PLOT_RIGHT}" y="${HEAD_TOP}" text-anchor="end" class="sub">peak ${fmt(peak)} in ${peakYear}</text>`
    : ""}
  ${gridlines}
  <line x1="${PLOT_LEFT}" y1="${PLOT_BOTTOM}" x2="${PLOT_RIGHT}" y2="${PLOT_BOTTOM}" class="baseline"/>
  ${bars}
  ${warningBanner}
</svg>`;
}

// ---------------------------------------------------------------------------
// 5. Pipeline.
// ---------------------------------------------------------------------------
async function main() {
  const end = currentYear();
  console.log(
    `[cumulative] fetching per-year totals for ${USERNAME}, ${START_YEAR}–${end}…`
  );
  let model;
  try {
    const years = await fetchYearTotals(USERNAME, START_YEAR, end);
    const summary = years.map((y) => `${y.year}=${y.total}`).join(" ");
    console.log(`[cumulative] ${summary}`);
    model = buildModel(years);
    console.log(
      `[cumulative] ${model.rows.length} bars; cumulative=${model.cumulative}; peak=${model.peak} in ${model.peakYear} (sources: ${years
        .map((y) => `${y.year}:${y.source}`)
        .join(", ")}).`
    );
  } catch (err) {
    const msg = String(err?.message ?? err);
    console.warn(`[cumulative] failed (reason below); using placeholder: ${msg}`);
    model = placeholder(msg);
  }

  const svg = renderSVG(model);
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, svg, "utf8");
  console.log(`[cumulative] wrote ${OUT_PATH} (${svg.length} bytes)`);
}

main().catch((err) => {
  console.error("[cumulative] FATAL:", err?.message ?? err);
  process.exit(1);
});
