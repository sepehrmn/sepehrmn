#!/usr/bin/env node
// scripts/toolbox-rails.mjs
// Generates assets/rail-<slug>.svg — a slim, full-width amber "category rail" for
// each Toolbox group (AI/ML, Backend, Cloud, Frontend). It replaces the old bold
// markdown label: an accent spine, the category LABEL (neutral ink), a right-
// anchored "# N tools" count, and a swept hairline that reaches the right margin
// — so each centred icon cluster below it is framed edge-to-edge instead of
// hugging the left. Subordinate to the section-title banners (no prompt / index /
// cursor). Theme-adaptive, reduced-motion safe, zero deps.
// Run: `node scripts/toolbox-rails.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, MONO, escapeXML, charLen, sweepDefs } from "./tokens.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, "..", "assets");

const W = 860;
const H = 30;
const BASE = 20;
const LABEL_X = 24;
const RIGHT = 760;

const [amberD, amberL] = PALETTE.accents.toolbox;
const [inkD, inkL] = PALETTE.ink;
const [mutedD, mutedL] = PALETTE.muted;
const [ruleD, ruleL] = PALETTE.rule;

const RAILS = [
  { slug: "aiml",     label: "AI / ML",            count: 8, begin: "0s" },
  { slug: "backend",  label: "BACKEND &amp; SYSTEMS", count: 7, begin: "0.3s" },
  { slug: "cloud",    label: "CLOUD &amp; DEVOPS",     count: 8, begin: "0.6s" },
  { slug: "frontend", label: "FRONTEND &amp; WEB",     count: 7, begin: "0.9s" },
];

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
    @media (prefers-color-scheme: light) {
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
