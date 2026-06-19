#!/usr/bin/env node
// scripts/weekdays.mjs
// Generates assets/weekdays.svg from live GitHub contribution data.
// Zero npm dependencies; uses the global `fetch` (Node 20+).
//
// Why this exists instead of a 365-day grid: GitHub already renders the
// native year-long contribution heatmap on /github.com/sepehrmn, so copying
// it on the README is redundant. This chart answers a *different* question:
// "what's my weekday rhythm?" — a stat the year-long grid cannot surface.
// 7 stacked bars (Mon→Sun) over the last ~13 weeks, where each bar splits
// into commits (cyan) vs. PR+issue+review (gray).
//
// Data sources:
//   1. GraphQL — authoritative bar HEIGHT (per-weekday sum of contributionCount
//      over the last 91 days, taken from contributionsCollection.contributionCalendar).
//      Also returns macro per-type totals (commits/PRs/issues/reviews) used as the
//      fallback ratio when the events API is silent.
//   2. REST /users/{login}/events/public — drives the bar's INNER split (commits
//      vs. other) via PushEvent.size and PullRequest/IssuesEvent with action=opened
//      (matching GitHub's own contribution-graph semantics) plus
//      PullRequestReviewEvent. Last ~90 days, max 300 events; sampling artifact
//      is noted in the chart caption.
//
// In CI (`.github/workflows/weekdays.yml`) `GITHUB_TOKEN` is auto-injected.
// Locally, an authenticated run is optional — the script degrades to public
// data and renders a no-data warning if both APIs fail.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "assets", "weekdays.svg");
const USERNAME = process.env.GH_USERNAME || "sepehrmn";
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.warn(
    "[weekdays] GH_TOKEN not set — using unauthenticated public data. " +
      "Configure GH_TOKEN in workflow secrets for private contribution coverage."
  );
}

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
const WINDOW_DAYS = 91; // ~13 weeks; matches REST events ~90-day ceiling.

// GitHub GraphQL `weekday`: 0=Sun..6=Sat. We want Mon..Sun, so remap:
//   Sun→6, Mon→0, Tue→1, ..., Sat→5.
const githubWeekdayToMonFirst = (weekday) => (Number(weekday) + 6) % 7;

// ---------------------------------------------------------------------------
// 1. GraphQL — full contribution calendar + per-type totals.
// ---------------------------------------------------------------------------
const GRAPHQL_URL = "https://api.github.com/graphql";
const GRAPHQL_QUERY = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { contributionCount date weekday }
          }
        }
        pullRequestContributions(first: 0) { totalCount }
        issueContributions(first: 0) { totalCount }
        pullRequestReviewContributions(first: 0) { totalCount }
      }
    }
  }
`;

async function fetchCollection(login) {
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
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data?.user?.contributionsCollection ?? null;
}

// ---------------------------------------------------------------------------
// 2. REST events — per-weekday commit/PR/issue/review counts.
//    Only count actions that match GitHub's own contribution graph semantics:
//    - PushEvent: payload.size (commits pushed, not number of pushes).
//    - IssuesEvent + PullRequestEvent with payload.action === "opened".
//    - PullRequestReviewEvent (all review events).
//    Closed/reopened/assigned/etc. would inflate the denominator and crush
//    the apparent commit ratio, so they're deliberately skipped.
// ---------------------------------------------------------------------------
async function fetchWeekdayEventCounts(login) {
  const counts = {
    commits: new Array(7).fill(0),
    others: new Array(7).fill(0),
    sampleEvents: 0,
  };
  for (let page = 1; page <= 3; page += 1) {
    const url = `https://api.github.com/users/${encodeURIComponent(
      login
    )}/events/public?per_page=100&page=${page}`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          ...(TOKEN ? { Authorization: `bearer ${TOKEN}` } : {}),
        },
      });
    } catch (err) {
      console.warn(`[weekdays] REST events fetch network error: ${err.message}`);
      return counts;
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        console.warn(
          `[weekdays] REST events ${res.status} — falling back to GraphQL macro ratio.`
        );
      }
      return counts;
    }
    const events = await res.json().catch(() => []);
    if (!Array.isArray(events) || events.length === 0) break;
    counts.sampleEvents += events.length;
    for (const ev of events) {
      const ts = String(ev.created_at ?? "");
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) continue;
      const dow = githubWeekdayToMonFirst(d.getUTCDay());
      if (ev?.type === "PushEvent") {
        counts.commits[dow] += Number(ev.payload?.size ?? 0);
      } else if (ev?.type === "IssuesEvent") {
        if (ev.payload?.action === "opened") counts.others[dow] += 1;
      } else if (ev?.type === "PullRequestEvent") {
        if (ev.payload?.action === "opened") counts.others[dow] += 1;
      } else if (ev?.type === "PullRequestReviewEvent") {
        counts.others[dow] += 1;
      }
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 3. Combine: per-weekday total (from GraphQL) + per-weekday split (events).
//    Fallback split comes from the user's macro annual GraphQL totals, NOT a
//    hardcoded constant — so the chart still reads sensibly when the events
//    API is silent.
// ---------------------------------------------------------------------------
function aggregate(days, eventCounts, totals) {
  const macro = totals ?? { commits: 0, prs: 0, issues: 0, reviews: 0 };
  const macroAll = macro.commits + macro.prs + macro.issues + macro.reviews;
  const macroCommitRatio = macroAll > 0 ? macro.commits / macroAll : null;

  const recent =
    days.length > WINDOW_DAYS ? days.slice(-WINDOW_DAYS) : days.slice();

  const weekdayTotal = new Array(7).fill(0);
  for (const day of recent) {
    const idx = githubWeekdayToMonFirst(day.weekday);
    weekdayTotal[idx] += Number(day.contributionCount ?? 0);
  }

  const perDay = DAY_LABELS.map((label, i) => {
    const total = weekdayTotal[i];
    const evCommits = eventCounts.commits[i];
    const evOthers = eventCounts.others[i];
    const evSum = evCommits + evOthers;
    // Per-weekday REST ratio if we have signal; otherwise annual macro ratio.
    const ratio = evSum > 0 ? evCommits / evSum : macroCommitRatio;
    const commits = ratio == null ? 0 : Math.round(total * ratio);
    return {
      label,
      total,
      commits,
      others: Math.max(0, total - commits),
      commitsRatio: ratio ?? 0,
    };
  });

  const peakTotal = perDay.reduce((m, d) => Math.max(m, d.total), 0);
  return {
    perDay,
    peakTotal,
    windowDays: recent.length,
    sampleEvents: eventCounts.sampleEvents,
  };
}

// ---------------------------------------------------------------------------
// 4. No-data placeholder (still valid SVG so workflow artifact commits).
// ---------------------------------------------------------------------------
function placeholder() {
  return {
    perDay: DAY_LABELS.map((label) => ({
      label,
      total: 0,
      commits: 0,
      others: 0,
      commitsRatio: 0,
    })),
    peakTotal: 0,
    windowDays: WINDOW_DAYS,
    sampleEvents: 0,
    warning:
      "Live contribution data could not be fetched — both GraphQL and REST endpoints failed. Run the action with a valid GH_TOKEN to populate.",
  };
}

// ---------------------------------------------------------------------------
// 5. Render SVG.
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
  const { perDay, peakTotal, warning, windowDays, sampleEvents } = model;
  // Avoid divide-by-zero when the window is entirely empty.
  const yMax = Math.max(peakTotal, 1);

  const bars = perDay
    .map((day, i) => {
      const x = PLOT_LEFT + i * (BAR_W + BAR_GAP);
      const cx = x + BAR_W / 2;
      const totalH = (day.total / yMax) * PLOT_HEIGHT;
      const commitsH = day.commits > 0 ? (day.commits / yMax) * PLOT_HEIGHT : 0;
      const othersH = Math.max(0, totalH - commitsH);
      const baseY = PLOT_BOTTOM - totalH;
      const commitsY = PLOT_BOTTOM - commitsH;
      const othersY = commitsY - othersH;
      const isPeak = day.total > 0 && day.total === peakTotal;
      const tip = `${day.label}: ${day.total} contributions · ${day.commits} commits / ${day.others} PR+issue+review across ${windowDays} days${sampleEvents ? ` (${sampleEvents} events sampled)` : ""}`;
      const tipEsc = escapeXML(tip);
      return [
        // Bottom segment = commits (cyan brand accent).
        commitsH > 0
          ? `<rect x="${x}" y="${commitsY}" width="${BAR_W}" height="${commitsH}" rx="3" ry="3" class="bar-commits"><title>${tipEsc}</title>${
              isPeak
                ? `<animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite"/>`
                : ""
            }</rect>`
          : "",
        // Top segment = others (muted gray).
        othersH > 0
          ? `<rect x="${x}" y="${othersY}" width="${BAR_W}" height="${othersH}" rx="3" ry="3" class="bar-others"><title>${tipEsc}</title></rect>`
          : "",
        // Value above bar.
        `<text x="${cx}" y="${baseY - 6}" text-anchor="middle" class="value">${day.total}</text>`,
        // Day label below baseline.
        `<text x="${cx}" y="${PLOT_BOTTOM + 18}" text-anchor="middle" class="day">${escapeXML(
          day.label
        )}</text>`,
      ].join("");
    })
    .join("");

  const baseline = `<line x1="${PLOT_LEFT}" y1="${PLOT_BOTTOM}" x2="${PLOT_RIGHT}" y2="${PLOT_BOTTOM}" class="baseline"/>`;

  const title = `<text x="${PLOT_LEFT}" y="20" class="title">Activity by weekday</text>`;
  // When events API is silent, signal that to the reader so the cyan/gray split
  // isn't mistaken for empirical data — it falls back to annual macro totals.
  const subtitle = sampleEvents > 0
    ? `<text x="${PLOT_RIGHT}" y="20" text-anchor="end" class="subtitle">Last ${windowDays} days · ${sampleEvents} events sampled</text>`
    : `<text x="${PLOT_RIGHT}" y="20" text-anchor="end" class="subtitle">Last ${windowDays} days · no public events — split uses yearly ratio</text>`;
  const caption = `<text x="${PLOT_LEFT}" y="${
    H - 8
  }" class="caption">cyan = commits · gray = open PR + issue + review · split ratio sampled from up to 300 recent events · complements GitHub's native 365-day heatmap</text>`;
  const warningBanner = warning
    ? `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="warning">${escapeXML(
        warning
      )}</text>`
    : "";

  const aria = peakTotal > 0
    ? `Activity by weekday — peak ${peakTotal} contributions in a single weekday over the last ${windowDays} days across ${sampleEvents} sampled events`
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
    .bar-commits { fill: #22d3ee; }
    .bar-others { fill: #6e6e78; }
    @media (prefers-color-scheme: light) {
      .title { fill: #0891b2; }
      .subtitle { fill: #57606a; }
      .value { fill: #1f2328; }
      .day { fill: #57606a; }
      .caption { fill: #6e7681; }
      .warning { fill: #b45309; }
      .baseline { stroke: #d0d7de; }
      .bar-commits { fill: #0c4a6e; }
      .bar-others { fill: #d4d4dc; }
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
// 6. Pipeline.
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[weekdays] fetching data for ${USERNAME}…`);
  let model;
  try {
    const collection = await fetchCollection(USERNAME);
    if (!collection) throw new Error("empty contributionsCollection");
    const flatDays = (collection.contributionCalendar?.weeks ?? []).flatMap(
      (w) => w.contributionDays ?? []
    );
    const prs = collection.pullRequestContributions?.totalCount ?? 0;
    const issues = collection.issueContributions?.totalCount ?? 0;
    const reviews = collection.pullRequestReviewContributions?.totalCount ?? 0;
    const macroTotals = {
      prs,
      issues,
      reviews,
      commits: Math.max(
        0,
        collection.contributionCalendar.totalContributions - prs - issues - reviews
      ),
    };
    const eventCounts = await fetchWeekdayEventCounts(USERNAME);
    model = aggregate(flatDays, eventCounts, macroTotals);
    console.log(
      `[weekdays] built ${model.perDay.length}-bar model across ${model.windowDays} days; peak=${model.peakTotal}; ${model.sampleEvents} events sampled.`
    );
  } catch (err) {
    console.warn(`[weekdays] falling back to no-data placeholder: ${err.message}`);
    model = placeholder();
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
