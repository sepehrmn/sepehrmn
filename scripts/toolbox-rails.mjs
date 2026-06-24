#!/usr/bin/env node
// scripts/toolbox-rails.mjs
// Generates assets/rail-<slug>.svg, a slim amber "category rail" for each Toolbox
// group (AI/ML, Backend, Cloud, Frontend): an accent spine, the category LABEL
// (neutral ink), a right-anchored "# N tools" count, and a swept hairline. The
// content is flush-LEFT and spans the full width, edge-to-edge with the section
// title, no left or right margin; the README left-aligns the whole toolbox. No
// prompt / index / cursor. Theme-adaptive, reduced-motion safe, zero deps.
// Run: `node scripts/toolbox-rails.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, MONO, escapeXML, charLen, sweepDefs } from "./tokens.mjs";
import { RAILS } from "./data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, "..", "assets");

const W = 860;
const H = 30;
const BASE = 20;
const LABEL_X = 24;  // flush left, no left margin
const RIGHT = 856;   // content reaches the right edge, no right gap, edge-to-edge with the title

const [amberD, amberL] = PALETTE.accents.toolbox;
const [inkD, inkL] = PALETTE.ink;
const [mutedD, mutedL] = PALETTE.muted;
const [ruleD, ruleL] = PALETTE.rule;

function render(r) {
  // label width uses the visible text length (entities count as 1 char)
  const visible = r.label.replace(/&amp;/g, "&");
  const labelW = charLen(visible, 13, 3);
  const ruleX1 = LABEL_X + labelW + 16;
  const sweepId = `rail-${r.slug}`;
  const sweep = sweepDefs(sweepId, {
    x1from: ruleX1 - 110, x1to: RIGHT, x2from: ruleX1, x2to: RIGHT + 110, color: amberD, dur: "3.2s",
  })
    // stagger: set each rail's sweep begin so they don't pulse in unison
    .replace(/dur="3.2s"/g, `dur="3.2s" begin="${r.begin}"`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(visible)} stack">
  <title>${escapeXML(visible)} stack</title>
  <defs>${sweep}</defs>
  <style>
    .label { font: 700 13px ${MONO}; fill: ${inkD}; letter-spacing: 3px; }
    .cap   { font: 600 10px ${MONO}; fill: ${mutedD}; letter-spacing: 2px; }
    .spine { stroke: ${amberD}; stroke-width: 4; stroke-linecap: round; }
    .rule  { stroke: ${ruleD}; stroke-width: 1; }
    text { paint-order: stroke; stroke: #0d1117; stroke-width: 2.6; stroke-linejoin: round; }
    @media (prefers-color-scheme: light) {
      text { stroke: #ffffff; }
      .label { fill: ${inkL}; }
      .cap { fill: ${mutedL}; }
      .spine { stroke: ${amberL}; }
      .rule { stroke: ${ruleL}; }
    }
    @media (prefers-reduced-motion: reduce) { animate { display: none; } }
  </style>
  <path d="M4 6 V24" class="spine"/>
  <text x="${LABEL_X}" y="${BASE}" class="label" textLength="${labelW}" lengthAdjust="spacingAndGlyphs">${r.label}</text>
  <text x="${RIGHT}" y="${BASE}" text-anchor="end" class="cap"># ${r.count} tools</text>
  <line x1="${ruleX1}" y1="24.5" x2="${RIGHT}" y2="24.5" class="rule"/>
  <rect x="${ruleX1}" y="23" width="${RIGHT - ruleX1}" height="3" rx="1.5" fill="url(#${sweepId})"/>
</svg>
`;
}

mkdirSync(ASSETS, { recursive: true });
for (const r of RAILS) {
  const out = resolve(ASSETS, `rail-${r.slug}.svg`);
  writeFileSync(out, render(r), "utf8");
  console.log(`[toolbox-rails] wrote ${out}`);
}
