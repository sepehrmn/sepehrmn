#!/usr/bin/env node
// scripts/repo-tree.mjs
// Generates assets/repo-tree.svg, a `tree ~/sep` directory listing of the public
// "More repositories" for the Selected-work sub-section. Twin of connect.svg /
// agents.svg grammar (rounded panel, accent spine, top sweep, blinking cursor,
// comms-rail flow) but VIOLET-accented to inherit the parent "02 Selected work"
// section (subordinate, not a new hero). The sub-header banner (title-more.svg)
// carries the section title, so the panel itself opens straight on the command.
// The ├─/└─ branches are drawn paths, not glyphs. The star/fork badges
// auto-refresh from the live repos when a token is present (the work-cards cron
// runs this too); baked-in values are the fallback. Display-only (the README
// carries the real click row). Theme-adaptive, reduced-motion safe, zero deps.
// Run: `node scripts/repo-tree.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, MONO, escapeXML, charLen, sweepDefs, CURBLINK_KEYFRAMES } from "./tokens.mjs";
import { REPOS } from "./data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "assets", "repo-tree.svg");

// Live badge refresh (mirrors work-cards.mjs). With a token, read each badged
// repo's current star/fork count; baked-in `count` is the no-token fallback.
async function hydrateBadges(list) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  if (!token) {
    console.warn("[repo-tree] no token; using baked-in badge counts.");
    return;
  }
  for (const r of list) {
    if (!r.repo || !r.metric) continue;
    try {
      const res = await fetch(`https://api.github.com/repos/${r.repo}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "sepahead-repo-tree/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const live = r.metric === "forks" ? j.forks_count : j.stargazers_count;
      if (typeof live === "number") r.count = live;
    } catch (e) {
      console.warn(`[repo-tree] ${r.metric} fetch failed for ${r.repo} (${e.message}); keeping ${r.count}.`);
    }
  }
}
await hydrateBadges(REPOS);

// ---------------------------------------------------------------------------
// Layout (everything derives from REPOS.length, so the tree reflows on edit).
// ---------------------------------------------------------------------------
const W = 860;
const X = 40;
const RIGHT = 820;
const TRUNK_X = 48;
const NAME_X = 72;
const NOTE_RIGHT = 812;
const PROMPT_Y = 40;
const ROOT_Y = 72;
const ROW0_Y = 102;
const PITCH = 30;
const n = REPOS.length;
const lastBaseline = ROW0_Y + (n - 1) * PITCH;
const H = lastBaseline + 36;
const trunkBottom = lastBaseline - 4;
const railY = H - 20;
const spineEnd = H - 18;

const [inkD, inkL] = PALETTE.ink;
const [mutedD, mutedL] = PALETTE.muted;
const [ruleD, ruleL] = PALETTE.rule;
const [vioD, vioL] = PALETTE.accents.work;
const [flowD, flowL] = PALETTE.flow;
const pD = PALETTE.panel.dark;
const pL = PALETTE.panel.light;

const HEADER = "❯ tree ~/sep --pub --sort activity";
const cmdCursorX = X + charLen(HEADER, 14, 0) + 6;

const sweepFwd = sweepDefs("sweepFwd", { x1from: -120, x1to: RIGHT, x2from: 0, x2to: RIGHT + 120, color: vioD, dur: "3.4s" });

const rows = REPOS.map((r, i) => {
  const baseline = ROW0_Y + i * PITCH;
  const cy = baseline - 4;
  let badge = "";
  if (r.metric && r.count != null) {
    const bx = NAME_X + charLen(r.name, 14, 0) + 12;
    const text = r.metric === "forks" ? `forks ${r.count}` : `&#9733;${r.count}`;
    badge = `<text x="${bx}" y="${baseline}" class="badge">${text}</text>`;
  }
  return `  <path d="M${TRUNK_X} ${cy} H68" class="branch"/><text x="${NAME_X}" y="${baseline}" class="name">${escapeXML(r.name)}</text>${badge}<text x="${NOTE_RIGHT}" y="${baseline}" text-anchor="end" class="note">// ${escapeXML(r.area)}</text>`;
}).join("\n");

const aria =
  "More repositories: a directory tree of " + n + " public repos under sepahead. " +
  REPOS.map((r) => {
    const tag = r.metric === "stars" ? ` (${r.count} stars)` : r.metric === "forks" ? ` (forked by ${r.count})` : "";
    return `${r.name}${tag}: ${r.full}.`;
  }).join(" ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <title>More repositories</title>
  <defs>${sweepFwd}</defs>
  <style>
    :root { color-scheme: light dark; }
    .panel { fill: ${pD.fill}; fill-opacity: ${pD.fillOpacity}; stroke: ${pD.stroke}; stroke-opacity: ${pD.strokeOpacity}; }
    .spine { stroke: ${vioD}; stroke-width: 4; stroke-linecap: round; }
    .prompt{ font: 600 14px ${MONO}; fill: ${vioD}; }
    .cmd   { font: 600 14px ${MONO}; fill: ${inkD}; }
    .arg, .flag { font: 600 14px ${MONO}; fill: ${mutedD}; }
    .val, .root { font: 600 14px ${MONO}; fill: ${vioD}; }
    .branch{ stroke: ${vioD}; stroke-opacity: 0.55; stroke-width: 1.4; fill: none; stroke-linecap: round; }
    .name  { font: 600 14px ${MONO}; fill: ${inkD}; }
    .badge { font: 600 11px ${MONO}; fill: ${vioD}; }
    .note  { font: 400 12.5px ${MONO}; fill: ${mutedD}; }
    .rail  { stroke: ${ruleD}; stroke-width: 1; }
    .flow  { fill: none; stroke: ${flowD}; stroke-width: 2.4; stroke-dasharray: 1.5 9; stroke-linecap: round; opacity: 0.9; }
    .cursor{ fill: ${vioD}; animation: curblink 1s steps(1) infinite; }
    ${CURBLINK_KEYFRAMES}
    text { paint-order: stroke; stroke: #0d1117; stroke-width: 2.6; stroke-linejoin: round; }
    @media (prefers-color-scheme: light) {
      text { stroke: #ffffff; }
      .panel { fill: ${pL.fill}; fill-opacity: ${pL.fillOpacity}; stroke: ${pL.stroke}; stroke-opacity: ${pL.strokeOpacity}; }
      .spine, .branch { stroke: ${vioL}; }
      .prompt, .val, .root, .badge { fill: ${vioL}; }
      .cursor { fill: ${vioL}; }
      .cmd, .name { fill: ${inkL}; }
      .arg, .flag, .note { fill: ${mutedL}; }
      .rail { stroke: ${ruleL}; }
      .flow { stroke: ${flowL}; }
    }
    @media (prefers-reduced-motion: reduce) {
      animate { display: none; }
      .cursor { animation: none; visibility: hidden; }
      .flow { display: none; }
    }
  </style>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" class="panel"/>
  <rect x="${X}" y="0.5" width="${RIGHT - X}" height="3" rx="1.5" fill="url(#sweepFwd)"/>
  <path d="M6 16 V${spineEnd}" class="spine"/>

  <text x="${X}" y="${PROMPT_Y}"><tspan class="prompt">&#10095; </tspan><tspan class="cmd">tree </tspan><tspan class="arg">~/sep </tspan><tspan class="flag">--pub --sort </tspan><tspan class="val">activity</tspan></text>
  <rect x="${cmdCursorX.toFixed(0)}" y="${PROMPT_Y - 13}" width="9" height="15" rx="1" class="cursor"/>

  <text x="${X}" y="${ROOT_Y}" class="root">sepahead/</text>
  <path d="M${TRUNK_X} ${ROOT_Y + 8} V${trunkBottom}" class="branch"/>
${rows}

  <line x1="${X}" y1="${railY}" x2="${RIGHT}" y2="${railY}" class="rail"/>
  <path d="M${X} ${railY} H${RIGHT}" class="flow">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.5s" repeatCount="indefinite"/>
  </path>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, "utf8");
console.log(`[repo-tree] wrote ${OUT} (${svg.length} bytes)`);
