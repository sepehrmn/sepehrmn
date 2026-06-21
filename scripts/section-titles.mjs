#!/usr/bin/env node
// scripts/section-titles.mjs
// Generates assets/title-<slug>.svg — one terminal-prompt "command line" banner
// per README section, so the whole profile reads as a single terminal session
// (the hero is line 00; each section is a numbered command 01..04). Each banner:
// an accent SPINE, a two-digit INDEX, a "~/sep ❯" prompt, the section LABEL
// (neutral ink, never the accent — so it passes contrast on both grounds), a
// right-aligned static "# …" comment, an animated swept hairline rule, and a
// blinking block cursor (staggered per section so they never strobe in unison).
// Theme-adaptive (prefers-color-scheme), reduced-motion safe, zero deps.
// Run: `node scripts/section-titles.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, MONO, escapeXML, charLen, sweepDefs, CURBLINK_KEYFRAMES } from "./tokens.mjs";
import { PROJECTS, REPOS, AGENTS, RAILS, CHANNELS } from "./data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, "..", "assets");

const W = 860;
const H = 52;
const BASE = 33; // text baseline
const LABEL_X = 132;

const SECTIONS = [
  { slug: "pulse",     index: "01", label: "THE PULSE",     comment: "# active since 2014", accent: "pulse",     begin: "0s" },
  { slug: "work",      index: "02", label: "SELECTED WORK", comment: `# ${PROJECTS.length} projects`,    accent: "work",      begin: "0.4s" },
  { slug: "toolbox",   index: "03", label: "THE TOOLBOX",         comment: `# ${RAILS.length} stacks`,      accent: "toolbox",   begin: "0.8s" },
  { slug: "agentic",   index: "04", label: "AGENTIC ENGINEERING", comment: `# ${AGENTS.length} in the loop`, accent: "agentic",   begin: "1.2s" },
  { slug: "elsewhere", index: "05", label: "ELSEWHERE",           comment: `# ${CHANNELS} channels`,        accent: "elsewhere", begin: "1.6s" },
];

const HEADING = {
  pulse: "The pulse",
  work: "Selected work",
  toolbox: "The toolbox",
  agentic: "Agentic engineering",
  elsewhere: "Elsewhere",
};

function render(s) {
  const [accentD, accentL] = PALETTE.accents[s.accent];
  const [inkD, inkL] = PALETTE.ink;
  const [mutedD, mutedL] = PALETTE.muted;
  const [ruleD, ruleL] = PALETTE.rule;

  const labelW = charLen(s.label, 14, 4);
  const ruleX1 = LABEL_X;
  const ruleX2 = 760;
  const cursorX = LABEL_X + labelW + 10;

  // Sweep spans the rule; bright band travels across it once per loop.
  const sweepId = `sweep-${s.slug}`;
  const sweep = sweepDefs(sweepId, {
    x1from: ruleX1 - 120, x1to: ruleX2, x2from: ruleX1, x2to: ruleX2 + 120, color: accentD, dur: "3.2s",
  });

  const aria = HEADING[s.slug];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <title>${escapeXML(aria)}</title>
  <defs>
    ${sweep}
  </defs>
  <style>
    .idx    { font: 700 13px ${MONO}; fill: ${accentD}; letter-spacing: 1px; }
    .prompt { font: 600 14px ${MONO}; fill: ${mutedD}; }
    .caret  { fill: ${accentD}; }
    .label  { font: 700 14px ${MONO}; fill: ${inkD}; letter-spacing: 4px; }
    .cap    { font: 600 11px ${MONO}; fill: ${mutedD}; letter-spacing: 2px; }
    .spine  { stroke: ${accentD}; stroke-width: 4; stroke-linecap: round; }
    .rule   { stroke: ${ruleD}; stroke-width: 1; }
    .cursor { fill: ${accentD}; animation: curblink 1s steps(1) ${s.begin} infinite; }
    ${CURBLINK_KEYFRAMES}
    @media (prefers-color-scheme: light) {
      .idx { fill: ${accentL}; }
      .prompt { fill: ${mutedL}; }
      .caret { fill: ${accentL}; }
      .label { fill: ${inkL}; }
      .cap { fill: ${mutedL}; }
      .spine { stroke: ${accentL}; }
      .rule { stroke: ${ruleL}; }
      .cursor { fill: ${accentL}; }
    }
    @media (prefers-reduced-motion: reduce) {
      animate { display: none; }
      .cursor { animation: none; visibility: hidden; }
    }
  </style>
  <path d="M4 13 V39" class="spine"/>
  <text x="22" y="${BASE}" class="idx">${s.index}</text>
  <text x="50" y="${BASE}" class="prompt">~/sep <tspan class="caret">&#10095;</tspan></text>
  <text x="${LABEL_X}" y="${BASE}" class="label" textLength="${labelW}" lengthAdjust="spacingAndGlyphs">${escapeXML(s.label)}</text>
  <text x="${ruleX2}" y="${BASE}" text-anchor="end" class="cap">${escapeXML(s.comment)}</text>
  <line x1="${ruleX1}" y1="42.5" x2="${ruleX2}" y2="42.5" class="rule"/>
  <rect x="${ruleX1}" y="41" width="${ruleX2 - ruleX1}" height="3" rx="1.5" fill="url(#${sweepId})"/>
  <rect x="${cursorX}" y="22" width="9" height="14" rx="1" class="cursor"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
// Subordinate sub-header (e.g. "More repositories" inside 02 Selected work).
// Same terminal grammar as the section banners, but deliberately SMALLER and
// DIMMER — no index, a muted (not bright-ink) label, a thinner half-opacity
// spine, and a tighter viewBox — so it reads as a child of its section rather
// than a sixth top-level command. Embedded at a smaller width in the README.
// ---------------------------------------------------------------------------
function renderSub({ label, comment, accent }) {
  const [accentD, accentL] = PALETTE.accents[accent];
  const [mutedD, mutedL] = PALETTE.muted;
  const [ruleD, ruleL] = PALETTE.rule;

  const SW = 600;
  const SH = 44;
  const SBASE = 28;
  const PROMPT_X = 14;
  const SLABEL_X = 86;
  const RULE_X2 = 540;
  const labelW = charLen(label, 13, 3);
  const cursorX = SLABEL_X + labelW + 8;

  const sweepId = "sweep-sub";
  const sweep = sweepDefs(sweepId, {
    x1from: SLABEL_X - 110, x1to: RULE_X2, x2from: SLABEL_X, x2to: RULE_X2 + 110, color: accentD, dur: "3.4s",
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" width="${SW}" height="${SH}" role="img" aria-label="${escapeXML(label.toLowerCase())}">
  <title>${escapeXML(label.toLowerCase())}</title>
  <defs>
    ${sweep}
  </defs>
  <style>
    .prompt { font: 600 13px ${MONO}; fill: ${mutedD}; }
    .caret  { fill: ${accentD}; }
    .label  { font: 700 13px ${MONO}; fill: ${mutedD}; letter-spacing: 3px; }
    .cap    { font: 600 10px ${MONO}; fill: ${mutedD}; letter-spacing: 1.5px; }
    .spine  { stroke: ${accentD}; stroke-width: 3; stroke-linecap: round; stroke-opacity: 0.8; }
    .rule   { stroke: ${ruleD}; stroke-width: 1; }
    .cursor { fill: ${accentD}; opacity: 0.85; animation: curblink 1s steps(1) 0.4s infinite; }
    ${CURBLINK_KEYFRAMES}
    @media (prefers-color-scheme: light) {
      .prompt { fill: ${mutedL}; }
      .caret  { fill: ${accentL}; }
      .label  { fill: ${mutedL}; }
      .cap    { fill: ${mutedL}; }
      .spine  { stroke: ${accentL}; }
      .rule   { stroke: ${ruleL}; }
      .cursor { fill: ${accentL}; }
    }
    @media (prefers-reduced-motion: reduce) {
      animate { display: none; }
      .cursor { animation: none; visibility: hidden; }
    }
  </style>
  <path d="M4 13 V31" class="spine"/>
  <text x="${PROMPT_X}" y="${SBASE}" class="prompt">~/sep <tspan class="caret">&#10095;</tspan></text>
  <text x="${SLABEL_X}" y="${SBASE}" class="label" textLength="${labelW}" lengthAdjust="spacingAndGlyphs">${escapeXML(label)}</text>
  <text x="${RULE_X2}" y="${SBASE}" text-anchor="end" class="cap">${escapeXML(comment)}</text>
  <line x1="${SLABEL_X}" y1="37" x2="${RULE_X2}" y2="37" class="rule"/>
  <rect x="${SLABEL_X}" y="35.5" width="${RULE_X2 - SLABEL_X}" height="3" rx="1.5" fill="url(#${sweepId})"/>
  <rect x="${cursorX}" y="18" width="8" height="13" rx="1" class="cursor"/>
</svg>
`;
}

mkdirSync(ASSETS, { recursive: true });
for (const s of SECTIONS) {
  const out = resolve(ASSETS, `title-${s.slug}.svg`);
  writeFileSync(out, render(s), "utf8");
  console.log(`[section-titles] wrote ${out}`);
}

const moreOut = resolve(ASSETS, "title-more.svg");
writeFileSync(moreOut, renderSub({ label: "MORE REPOSITORIES", comment: `# ${REPOS.length} repos`, accent: "work" }), "utf8");
console.log(`[section-titles] wrote ${moreOut}`);
