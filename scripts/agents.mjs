#!/usr/bin/env node
// scripts/agents.mjs
// Generates assets/agents.svg — the "AGENTS // MANIFEST" panel for the Agentic
// Engineering section: a twin of connect.svg / work-cards.svg (rounded panel,
// emerald spine, top sweep, blinking cursor, comms-rail flow) styled as a live
// roster of the AI coding agents in the loop. Each row: a pulsing status pip,
// the agent name, an emerald role chip, and a muted "// note". The lead agent
// gets a ringed pip. Display-only (the README carries the real click row).
// Theme-adaptive, reduced-motion safe, zero deps. Run: `node scripts/agents.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, MONO, escapeXML, charLen, sweepDefs, CURBLINK_KEYFRAMES } from "./tokens.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "assets", "agents.svg");

const AGENTS = [
  { name: "Pi",          role: "lead",       note: "mono · the agent", lead: true },
  { name: "Claude Code", role: "engineer",   note: "deep refactors" },
  { name: "Codex",       role: "generalist", note: "broad coverage" },
  { name: "Cursor",      role: "editor",     note: "in-IDE pair" },
  { name: "Amp",         role: "autonomous", note: "long-horizon runs" },
  { name: "Aider",       role: "surgical",   note: "git-native edits" },
];

const W = 860;
const X = 40;
const RIGHT = 820;
const ROW0_Y = 92;
const PITCH = 30;
const H = ROW0_Y + AGENTS.length * PITCH + 40; // 312 for 6

const [inkD, inkL] = PALETTE.ink;
const [mutedD, mutedL] = PALETTE.muted;
const [ruleD, ruleL] = PALETTE.rule;
const [emD, emL] = PALETTE.accents.agentic;
const [flowD, flowL] = PALETTE.flow;
const pD = PALETTE.panel.dark;
const pL = PALETTE.panel.light;

const HEADER = "❯ roster --status live";
const cmdCursorX = X + charLen(HEADER, 14, 0) + 6;

const rows = AGENTS.map((a, i) => {
  const y = ROW0_Y + i * PITCH;
  const cy = y - 4;
  const nameW = charLen(a.name, 15, 0);
  const chipX = X + 22 + nameW + 14;
  const chipW = Math.round(a.role.length * 8 + 18);
  const noteX = chipX + chipW + 12;
  const ring = a.lead
    ? `<circle cx="${X + 6}" cy="${cy}" r="7" fill="none" stroke="var(--em)" stroke-opacity="0.5"/>`
    : "";
  return `  <g>
    ${ring}
    <circle cx="${X + 6}" cy="${cy}" r="4" class="pip">
      <animate attributeName="opacity" values="1;0.35;1" dur="1.8s" begin="${(i * 0.25).toFixed(2)}s" repeatCount="indefinite"/>
    </circle>
    <text x="${X + 22}" y="${y + 5}" class="name">${escapeXML(a.name)}</text>
    <rect x="${chipX}" y="${y - 9}" width="${chipW}" height="22" rx="6" class="chip"/>
    <text x="${chipX + chipW / 2}" y="${y + 5}" text-anchor="middle" class="chip-label">${escapeXML(a.role)}</text>
    <text x="${noteX}" y="${y + 4}" class="note">// ${escapeXML(a.note)}</text>
  </g>`;
}).join("\n");

const sweepFwd = sweepDefs("sweepFwd", {
  x1from: -120, x1to: RIGHT, x2from: 0, x2to: RIGHT + 120, color: emD, dur: "3.4s",
});

const railY = H - 22;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Agents manifest — the AI coding agents I build with. Pi (lead, mono the agent); Claude Code (engineer, deep refactors); Codex (generalist, broad coverage); Cursor (editor, in-IDE pair); Amp (autonomous, long-horizon runs); Aider (surgical, git-native edits). The loop never sleeps.">
  <title>Agents manifest</title>
  <defs>${sweepFwd}</defs>
  <style>
    :root { --em: ${emD}; }
    .panel { fill: ${pD.fill}; fill-opacity: ${pD.fillOpacity}; stroke: ${pD.stroke}; stroke-opacity: ${pD.strokeOpacity}; }
    .spine { stroke: ${emD}; stroke-width: 4; stroke-linecap: round; }
    .cap   { font: 600 11px ${MONO}; fill: ${mutedD}; letter-spacing: 2px; }
    .prompt{ font: 600 14px ${MONO}; fill: ${emD}; }
    .cmd   { font: 600 14px ${MONO}; fill: ${inkD}; }
    .flag  { font: 600 14px ${MONO}; fill: ${mutedD}; }
    .live  { font: 600 14px ${MONO}; fill: ${emD}; }
    .name  { font: 600 15px ${MONO}; fill: ${inkD}; }
    .chip  { fill: ${pD.fill}; fill-opacity: 0.04; stroke: ${emD}; stroke-width: 1.3; }
    .chip-label { font: 600 11px ${MONO}; fill: ${emD}; }
    .note  { font: 400 12.5px ${MONO}; fill: ${mutedD}; }
    .pip   { fill: ${emD}; }
    .rail  { stroke: ${ruleD}; stroke-width: 1; }
    .flow  { fill: none; stroke: ${flowD}; stroke-width: 2.4; stroke-dasharray: 1.5 9; stroke-linecap: round; opacity: 0.9; }
    .tag   { font: 400 13px ${MONO}; fill: ${mutedD}; }
    .cursor{ fill: ${emD}; animation: curblink 1s steps(1) infinite; }
    ${CURBLINK_KEYFRAMES}
    @media (prefers-color-scheme: light) {
      :root { --em: ${emL}; }
      .panel { fill: ${pL.fill}; fill-opacity: ${pL.fillOpacity}; stroke: ${pL.stroke}; stroke-opacity: ${pL.strokeOpacity}; }
      .spine { stroke: ${emL}; }
      .cap, .flag, .note, .tag { fill: ${mutedL}; }
      .prompt, .live, .chip-label, .cursor { fill: ${emL}; }
      .chip { stroke: ${emL}; }
      .pip { fill: ${emL}; }
      .cmd, .name { fill: ${inkL}; }
      .rail { stroke: ${ruleL}; }
      .flow { stroke: ${flowL}; }
    }
    @media (prefers-reduced-motion: reduce) {
      animate { display: none; }
      .cursor { animation: none; visibility: hidden; }
      .flow { display: none; }
      .pip { opacity: 1; }
    }
  </style>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" class="panel"/>
  <rect x="${X}" y="0.5" width="${RIGHT - X}" height="3" rx="1.5" fill="url(#sweepFwd)"/>
  <path d="M6 20 V${H - 20}" class="spine"/>

  <text x="${X}" y="34" class="cap">// AGENTS &#8212; MANIFEST</text>
  <text x="${X}" y="60"><tspan class="prompt">&#10095; </tspan><tspan class="cmd">roster </tspan><tspan class="flag">--status </tspan><tspan class="live">live</tspan></text>
  <rect x="${cmdCursorX.toFixed(0)}" y="47" width="9" height="15" rx="1" class="cursor"/>

${rows}

  <text x="${X}" y="${railY - 8}" class="tag">// the loop never sleeps</text>
  <line x1="${X}" y1="${railY}" x2="${RIGHT}" y2="${railY}" class="rail"/>
  <path d="M${X} ${railY} H${RIGHT}" class="flow">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.5s" repeatCount="indefinite"/>
  </path>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, "utf8");
console.log(`[agents] wrote ${OUT} (${svg.length} bytes)`);
