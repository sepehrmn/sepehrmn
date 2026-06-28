#!/usr/bin/env node
// scripts/connect.mjs
// Generates assets/connect.svg, the "Elsewhere" sign-off: an OPEN CHANNEL panel
// that closes the terminal session. The email is rendered terminal-style with a
// blinking cursor, but it is DISPLAY-ONLY (a real clickable mailto lives in the
// markdown just beneath, since links inside an <img>-SVG don't click on GitHub).
// A cyan packet runs along the comms rail (the work-graph .flow grammar) and a
// pink sweep brackets the top, mirroring the cyan sweep that opens the hero.
// Theme-adaptive, reduced-motion safe, zero deps. Run: `node scripts/connect.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, MONO, escapeXML, charLen, sweepDefs, CURBLINK_KEYFRAMES } from "./tokens.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "assets", "connect.svg");

const W = 860;
const H = 132;
const X = 40; // left text column (after the spine)
const RIGHT = 820;

const [inkD, inkL] = PALETTE.ink;
const [mutedD, mutedL] = PALETTE.muted;
const [ruleD, ruleL] = PALETTE.rule;
const [pinkD, pinkL] = PALETTE.accents.elsewhere;
const [flowD, flowL] = PALETTE.flow;
const panelD = PALETTE.panel.dark;
const panelL = PALETTE.panel.light;

// Email shown as a command. The address segments are split so '@' and '.' take
// the accent; everything else is ink. Real mailto is separate, in the README.
const PROMPT = "❯ "; // ❯ + nbsp
const EMAIL_PLAIN = PROMPT + "mail sepmhn@gmail.com";
const cursorX = X + charLen(EMAIL_PLAIN, 16, 0) + 6;

// Comms rail with a single travelling packet (flow dash grammar).
const railY = 116;

// Top bracket sweep: pink, travelling LEFT→RIGHT (matching the hero's opening
// cyan sweep and every other panel; the bright band enters from the left edge).
const sweepFwd = sweepDefs("sweepFwd", {
  x1from: -120, x1to: RIGHT, x2from: 0, x2to: RIGHT + 120, color: pinkD, dur: "3.6s",
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Open channel: reach me at sepmhn@gmail.com; always open to interesting problems.">
  <title>Open channel</title>
  <defs>
    ${sweepFwd}
  </defs>
  <style>
    :root { color-scheme: light dark; }
    .panel { fill: ${panelD.fill}; fill-opacity: ${panelD.fillOpacity}; stroke: ${panelD.stroke}; stroke-opacity: ${panelD.strokeOpacity}; }
    .spine { stroke: ${pinkD}; stroke-width: 4; stroke-linecap: round; }
    .cap   { font: 600 11px ${MONO}; fill: ${mutedD}; letter-spacing: 2px; }
    .cmd   { font: 500 16px ${MONO}; fill: ${mutedD}; }
    .addr  { font: 500 16px ${MONO}; fill: ${inkD}; }
    .at    { font: 500 16px ${MONO}; fill: ${pinkD}; }
    .prompt{ font: 500 16px ${MONO}; fill: ${pinkD}; }
    .tag   { font: 400 13px ${MONO}; fill: ${mutedD}; }
    .rail  { stroke: ${ruleD}; stroke-width: 1; }
    .flow  { fill: none; stroke: ${flowD}; stroke-width: 2.4; stroke-dasharray: 1.5 9; stroke-linecap: round; opacity: 0.9; }
    .cursor{ fill: ${pinkD}; animation: curblink 1s steps(1) infinite; }
    ${CURBLINK_KEYFRAMES}
    text { paint-order: stroke; stroke: #0d1117; stroke-width: 2.6; stroke-linejoin: round; }
    @media (prefers-color-scheme: light) {
      text { stroke: #ffffff; }
      .panel { fill: ${panelL.fill}; fill-opacity: ${panelL.fillOpacity}; stroke: ${panelL.stroke}; stroke-opacity: ${panelL.strokeOpacity}; }
      .spine { stroke: ${pinkL}; }
      .cap, .cmd, .tag { fill: ${mutedL}; }
      .addr { fill: ${inkL}; }
      .at, .prompt, .cursor { fill: ${pinkL}; }
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
  <path d="M6 20 V112" class="spine"/>

  <text x="${X}" y="34" class="cap">// OPEN CHANNEL // REACH ME</text>

  <text x="${X}" y="76">
    <tspan class="prompt">${escapeXML(PROMPT)}</tspan><tspan class="cmd">mail </tspan><tspan class="addr">sepmhn</tspan><tspan class="at">@</tspan><tspan class="addr">gmail</tspan><tspan class="at">.</tspan><tspan class="addr">com</tspan>
  </text>
  <rect x="${cursorX.toFixed(0)}" y="63" width="9" height="17" rx="1" class="cursor"/>

  <text x="${X}" y="100" class="tag">// always open to interesting problems</text>

  <line x1="${X}" y1="${railY}" x2="${RIGHT}" y2="${railY}" class="rail"/>
  <path d="M${X} ${railY} H${RIGHT}" class="flow">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.5s" repeatCount="indefinite"/>
  </path>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, "utf8");
console.log(`[connect] wrote ${OUT} (${svg.length} bytes)`);
