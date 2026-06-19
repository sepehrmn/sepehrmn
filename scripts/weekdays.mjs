#!/usr/bin/env node
// scripts/weekdays.mjs
// Generates assets/weekdays.svg from live GitHub contribution data.
// Zero npm dependencies; uses the global `fetch` (Node 20+).
//
// What this renders: a DONUT chart of each weekday's % share of contributions
// over the last ~13 weeks (91 days). A week is a cycle, so a ring reads more
// naturally than bars — and because the slices are shares of the whole, the
// weekend-heavy / midweek-dip pattern is obvious at a glance. The center
// holds the 91-day total; the legend (right) gives the exact % per day; the
// peak slice (the biggest weekday) glows and pulses. GitHub already renders a
// native 365-day heatmap on github.com/<user>, so we don't duplicate it —
// this surfaces the weekly rhythm that grid cannot.
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
// so each slice is the per-weekday TOTAL contribution count, expressed as a
// % of the 91-day total. That's the honest representation of this source.

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
// 4. Render SVG — a percentage DONUT chart.
//    Layout: title/subtitle top; donut centered-left; legend right; caption.
//    Each weekday is an annular slice ∝ its % share of the 91-day total.
// ---------------------------------------------------------------------------
const W = 760;
const H = 340;
// Donut geometry. Centered-left so the legend has room on the right. CY sits
// ~24px below the title baseline to give the ring clear breathing room from
// the header (the prior value left only ~8px and read as cramped). H grew to
// 340 to keep the bottom edge comfortably inside the viewBox.
const CX = 188;
const CY = 192;
const R_OUT = 132; // outer radius
const R_IN = 86; // inner radius (donut hole)
// Gap between slices, expressed as a fraction of the full circle. ~1.4°.
const GAP_FRAC = 0.004;
const LEGEND_X = 388;
// Vertically center the 7-row legend block on the donut center.
// 7 rows × 24px = 168px tall; centered on CY means top = CY - 84 + 12.
const LEGEND_TOP = 120;
const LEGEND_ROW_H = 24;

// Convert a % position around the ring (0..1, 0 = 12 o'clock, clockwise) to
// a point on the circle of radius `rad` centered at (CX, CY).
const ringPoint = (frac, rad) => {
  const ang = -Math.PI / 2 + frac * 2 * Math.PI; // start at top, clockwise
  return { x: CX + rad * Math.cos(ang), y: CY + rad * Math.sin(ang) };
};

// Build an annular-segment <path d> for a slice spanning [pct0, pct1] (both
// 0..1 fractions of the circle). Two arcs (outer CW, inner CCW) joined into
// a ring segment. largeArc flag set when the slice exceeds half the circle.
const describeSlice = (pct0, pct1) => {
  const sweep = pct1 - pct0;
  const large = sweep > 0.5 ? 1 : 0;
  const o0 = ringPoint(pct0, R_OUT);
  const o1 = ringPoint(pct1, R_OUT);
  const i1 = ringPoint(pct1, R_IN);
  const i0 = ringPoint(pct0, R_IN);
  return [
    `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)}`,
    `A ${R_OUT} ${R_OUT} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${R_IN} ${R_IN} 0 ${large} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}`,
    "Z",
  ].join(" ");
};

function renderSVG(model) {
  const { perDay, peakTotal, grandTotal, warning, windowDays } = model;

  // Per-slice percentages. If grandTotal is 0 (no data) the placeholder ring
  // is drawn instead — handled below.
  const slices = perDay.map((day, i) => {
    const pct = grandTotal > 0 ? day.total / grandTotal : 0;
    return {
      ...day,
      pct,
      // Always 1 decimal: every weekday is a single/double-digit %, and 1dp
      // reads cleanly while matching the data exactly (e.g. 8.7%, 9.2%).
      pctLabel: (pct * 100).toFixed(1),
      isPeak: day.total > 0 && day.total === peakTotal,
      index: i,
    };
  });

  // Cumulative sweep boundaries with a symmetric gap shrunken from each slice.
  let acc = 0;
  const arcs = slices.map((s) => {
    const start = acc;
    acc += s.pct;
    const end = acc;
    // Inset both edges by half the gap (clamped so a 0%-slice vanishes).
    const g = s.pct > 0 ? GAP_FRAC / 2 : 0;
    return { ...s, start: start + g, end: Math.max(start + g, end - g) };
  });

  const slicePaths = arcs
    .map((s, i) => {
      const d = describeSlice(s.start, s.end);
      // Base <path d> holds the FINAL arc so a non-SMIL renderer (image
      // proxy, RSS reader) still shows the complete donut. SMIL animates a
      // staggered fade+scale reveal (grow-in from the hole outward), which
      // reads as the ring assembling clockwise without risking malformed
      // morphing of the path's `d`.
      const begin = `${(0.15 + i * 0.1).toFixed(2)}s`;
      const title = `${s.label}: ${s.total} contributions · ${(s.pct * 100).toFixed(1)}% of the last ${windowDays} days`;
      const titleEsc = escapeXML(title);
      const cls = `slice${s.isPeak ? " slice-peak" : ""}`;
      const transformOrigin = `${CX} ${CY}`;
      return `<path d="${d}" class="${cls}" style="transform-origin:${transformOrigin};opacity:1" transform="scale(1)"><title>${titleEsc}</title>${
        s.isPeak
          ? `<animate attributeName="opacity" values="1;0.68;1" dur="2.6s" begin="1.3s" repeatCount="indefinite"/>`
          : ""
      }<animateTransform attributeName="transform" type="scale" values="0.82;1" begin="${begin}" dur="0.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>${
        !s.isPeak
          ? `<animate attributeName="opacity" values="0;1" begin="${begin}" dur="0.6s" fill="freeze"/>`
          : ""
      }</path>`;
    })
    .join("\n    ");

  // Per-slice 3-letter day labels, placed at each slice's angular midpoint on
  // the ring's mid-radius. Skipped for slices too small to host a label (the
  // legend on the right still carries every day + its %).
  const MID_R = (R_OUT + R_IN) / 2;
  const sliceLabels = arcs
    .map((s, i) => {
      // Only skip slices too small to host a label. Even the smallest weekday
      // here (~8.7% ≈ 31°) fits a 3-letter code at 12px, so the bar is low;
      // this guard mainly protects against a near-zero slice. The legend on
      // the right still carries every day + its % regardless.
      if (s.end - s.start < 0.05) return "";
      const mid = (s.start + s.end) / 2;
      const p = ringPoint(mid, MID_R);
      return `<text x="${p.x.toFixed(2)}" y="${(p.y + 4).toFixed(2)}" text-anchor="middle" class="slice-label">${escapeXML(s.label)}</text>`;
    })
    .join("\n    ");

  // Center headline: total contributions over the window.
  const centerNum = grandTotal > 0 ? escapeXML(String(grandTotal)) : "—";
  const centerSub = grandTotal > 0 ? `${windowDays} days` : "no data";
  const centerLabel = `<text x="${CX}" y="${CY - 4}" text-anchor="middle" class="center-num">${centerNum}</text>
    <text x="${CX}" y="${CY + 18}" text-anchor="middle" class="center-sub">${escapeXML(centerSub)}</text>`;

  // Legend: 7 rows, swatch + "Day XX.X%".
  const legendRows = slices
    .map((s, i) => {
      const y = LEGEND_TOP + i * LEGEND_ROW_H;
      const cls = `legend-label${s.isPeak ? " legend-peak" : ""}`;
      return `<rect x="${LEGEND_X}" y="${y - 9}" width="12" height="12" rx="2" class="legend-swatch${s.isPeak ? " swatch-peak" : ""}"/>
      <text x="${LEGEND_X + 22}" y="${y}" class="${cls}">${escapeXML(s.label)}</text>
      <text x="${LEGEND_X + 196}" y="${y}" text-anchor="end" class="${cls}">${s.pctLabel}%</text>`;
    })
    .join("\n    ");

  // When there's no real data, draw a faint full ring outline so the donut
  // shape still reads, and the warning banner (below) explains why.
  const placeholderRing =
    grandTotal === 0
      ? `<circle cx="${CX}" cy="${CY}" r="${(R_OUT + R_IN) / 2}" fill="none" stroke="#30363d" stroke-width="${R_OUT - R_IN}" stroke-opacity="0.5"/>`
      : "";

  const title = `<text x="40" y="36" class="title">Where the week goes</text>`;
  const subtitle =
    grandTotal > 0
      ? `<text x="${W - 40}" y="36" text-anchor="end" class="subtitle">share of ${grandTotal} contributions · last ${windowDays} days</text>`
      : `<text x="${W - 40}" y="36" text-anchor="end" class="subtitle">last ${windowDays} days</text>`;
  const warningBanner = warning
    ? `<text x="${W / 2}" y="${H - 16}" text-anchor="middle" class="warning">${escapeXML(
        warning
      )}</text>`
    : "";

  const peakLabel = peakTotal > 0 ? slices.find((s) => s.isPeak)?.label : null;
  const aria =
    grandTotal > 0
      ? `Weekday contribution share over the last ${windowDays} days — ${grandTotal} total, peak ${peakLabel} at ${(slices.find((s) => s.isPeak)?.pct * 100).toFixed(1)}%`
      : `Weekday contribution share over the last ${windowDays} days — no data`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <style>
    .title { font: 600 15px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #67e8f9; }
    .subtitle { font: 500 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .center-num { font: 700 34px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #22d3ee; letter-spacing: -1px; }
    .center-sub { font: 500 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8b949e; }
    .legend-label { font: 500 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .legend-peak { font-weight: 700; fill: #22d3ee; }
    .legend-swatch { fill: #22d3ee; fill-opacity: 0.55; }
    .swatch-peak { fill-opacity: 1; }
    .slice-label { font: 700 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #0b1f24; }
    .warning { font: 500 10px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fbbf24; }
    .slice { fill: #22d3ee; fill-opacity: 0.82; }
    .slice-peak { fill: #22d3ee; fill-opacity: 1; filter: url(#glow); }
    @media (prefers-color-scheme: light) {
      .title { fill: #0891b2; }
      .subtitle { fill: #57606a; }
      .center-num { fill: #0891b2; }
      .center-sub { fill: #57606a; }
      .legend-label { fill: #1f2328; }
      .legend-peak { fill: #0891b2; }
      .slice-label { fill: #ffffff; }
      .warning { fill: #b45309; }
      .slice { fill: #0891b2; }
      .slice-peak { fill: #0891b2; }
    }
    @media (prefers-reduced-motion: reduce) {
      animate, animateTransform { display: none; }
    }
  </style>
  <rect width="${W}" height="${H}" fill="transparent"/>
  ${title}
  ${subtitle}
  <g class="donut">
    ${placeholderRing}
    ${slicePaths}
    ${sliceLabels}
    ${centerLabel}
  </g>
  <g class="legend">
    ${legendRows}
  </g>
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
