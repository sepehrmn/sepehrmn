#!/usr/bin/env node
// scripts/work-graph.mjs
// Generates assets/work-graph.svg — the "Selected work" project relationship
// graph, from a declarative {nodes, edges} spec so the geometry is correct and
// easy to edit:
//   • edges are trimmed to each node's boundary (rect or circle) so a line never
//     runs under a node;
//   • each edge is a gentle quadratic Bézier that bows AWAY from the graph
//     centroid (keeps the layout open and separates the bridge crossing);
//   • each edge is stroked with a gradient from the source node's colour to the
//     target node's colour — no arrowheads, just connections.
// The connections to/from NCP are rendered as PERSISTENT, live links (glow +
// gentle pulse + bi-directional flowing packets, like an always-open websocket)
// to contrast with the calmer static edges.
// Theme-adaptive (prefers-color-scheme), reduced-motion safe. Zero deps.
// Run: `node scripts/work-graph.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "assets", "work-graph.svg");

const W = 860;
const H = 460;

// ---------------------------------------------------------------------------
// Spec. Positions are node centres; colours are per-project accents.
//   kind: "cube" (large square hub) | "hub" (large circle) | "pill" | "chip"
// ---------------------------------------------------------------------------
const nodes = {
  engram:      { x: 110, y: 230, color: "#22d3ee", kind: "cube", private: true },
  pidrs:       { x: 250, y: 86,  color: "#34d399", kind: "chip", label: "pid-rs" },
  ncp:         { x: 250, y: 230, color: "#fbbf24", kind: "pill", label: "NCP" },
  prisoma:     { x: 460, y: 130, color: "#a78bfa", kind: "hub",  private: true },
  crebain:     { x: 460, y: 332, color: "#f472b6", kind: "triangle" },
  cobotatlas:  { x: 690, y: 180, color: "#60a5fa", kind: "chip", label: "cobot-atlas" },
  cobotrelief: { x: 690, y: 280, color: "#fb7185", kind: "chip", label: "cobot-relief" },
};
for (const [id, n] of Object.entries(nodes)) n.label = n.label || id;

const edges = [
  { a: "engram",      b: "ncp" },
  { a: "ncp",         b: "prisoma" },
  { a: "ncp",         b: "crebain" },
  { a: "pidrs",       b: "prisoma" },
  { a: "cobotatlas",  b: "prisoma" },
  { a: "cobotrelief", b: "prisoma" },
  { a: "crebain",     b: "cobotatlas" },
  { a: "crebain",     b: "cobotrelief" },
];

// ---------------------------------------------------------------------------
// Geometry.
// ---------------------------------------------------------------------------
const HUB_R = 46;
const CUBE = 92; // engram square, matched to prisoma's diameter
const TRI_CIRCUM = 53; // crebain triangle circumradius (~92 wide, like the others)
const TRI_R = 42; // boundary radius used to trim edges to the triangle
const CHIP_H = 32;
const GAP = 7;

const escapeXML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

function nodeWidth(n) {
  if (n.kind === "hub") return HUB_R * 2;
  if (n.kind === "cube" || n.kind === "triangle") return CUBE;
  const pad = n.kind === "pill" ? 28 : 36;
  return Math.round(n.label.length * 7.8 + pad);
}
function halfExtents(n) {
  if (n.kind === "hub") return { hw: HUB_R, hh: HUB_R, circle: true };
  if (n.kind === "triangle") return { hw: TRI_R, hh: TRI_R, circle: true };
  if (n.kind === "cube") return { hw: CUBE / 2, hh: CUBE / 2, circle: false };
  return { hw: nodeWidth(n) / 2, hh: CHIP_H / 2, circle: false };
}
function boundaryDist(n, ux, uy) {
  const { hw, hh, circle } = halfExtents(n);
  if (circle) return hw;
  const tx = Math.abs(ux) < 1e-6 ? Infinity : hw / Math.abs(ux);
  const ty = Math.abs(uy) < 1e-6 ? Infinity : hh / Math.abs(uy);
  return Math.min(tx, ty);
}

const centroid = (() => {
  const ns = Object.values(nodes);
  return {
    x: ns.reduce((s, n) => s + n.x, 0) / ns.length,
    y: ns.reduce((s, n) => s + n.y, 0) / ns.length,
  };
})();

const f1 = (v) => Number(v.toFixed(1));

// ---------------------------------------------------------------------------
// Build edges.
// ---------------------------------------------------------------------------
const gradDefs = [];
const calmEdges = [];
const liveEdges = [];
const flows = [];

edges.forEach((e, i) => {
  const A = nodes[e.a];
  const B = nodes[e.b];
  const live = e.a === "ncp" || e.b === "ncp";
  const ux0 = B.x - A.x, uy0 = B.y - A.y;
  const len = Math.hypot(ux0, uy0);
  const ux = ux0 / len, uy = uy0 / len;

  const dA = boundaryDist(A, ux, uy) + GAP;
  const dB = boundaryDist(B, -ux, -uy) + GAP;
  const p0 = { x: A.x + dA * ux, y: A.y + dA * uy };
  const p1 = { x: B.x - dB * ux, y: B.y - dB * uy };

  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  let nx = -(p1.y - p0.y), ny = p1.x - p0.x;
  const nlen = Math.hypot(nx, ny) || 1;
  nx /= nlen; ny /= nlen;
  const out = (mid.x - centroid.x) * nx + (mid.y - centroid.y) * ny;
  const sign = out >= 0 ? 1 : -1;
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const bow = sign * Math.min(0.16 * chord, 26);
  const c = { x: mid.x + bow * nx, y: mid.y + bow * ny };
  const d = `M ${f1(p0.x)} ${f1(p0.y)} Q ${f1(c.x)} ${f1(c.y)} ${f1(p1.x)} ${f1(p1.y)}`;

  const gid = `eg${i}`;
  gradDefs.push(
    `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${f1(p0.x)}" y1="${f1(p0.y)}" x2="${f1(p1.x)}" y2="${f1(p1.y)}">` +
      `<stop offset="0%" stop-color="${A.color}"/><stop offset="100%" stop-color="${B.color}"/></linearGradient>`
  );

  if (live) {
    // Persistent, "alive" link: glowing gradient base with a slow opacity pulse…
    liveEdges.push(
      `<path d="${d}" fill="none" stroke="url(#${gid})" stroke-width="3" stroke-linecap="round" class="edge-live">` +
        `<animate attributeName="opacity" values="0.7;1;0.7" dur="2.8s" begin="${(i * 0.3).toFixed(2)}s" repeatCount="indefinite"/></path>`
    );
    // …and bi-directional flowing packets (forward bright, reverse dim).
    flows.push(
      `<path d="${d}" class="flow"><animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.5s" repeatCount="indefinite"/></path>`,
      `<path d="${d}" class="flow flow-rev"><animate attributeName="stroke-dashoffset" from="0" to="24" dur="2.1s" repeatCount="indefinite"/></path>`
    );
  } else {
    calmEdges.push(
      `<path d="${d}" fill="none" stroke="url(#${gid})" stroke-width="2" stroke-linecap="round" class="edge"/>`
    );
  }
});

// ---------------------------------------------------------------------------
// Nodes.
// ---------------------------------------------------------------------------
function lock(cx, cy, scale, color) {
  return `<g transform="translate(${f1(cx - 6 * scale)} ${f1(cy - 7.5 * scale)}) scale(${scale})">` +
    `<path d="M2 6 V4.4 a4 4 0 0 1 8 0 V6" fill="none" stroke="${color}" stroke-width="1.5"/>` +
    `<rect x="0" y="6" width="12" height="9" rx="1.6" fill="${color}"/></g>`;
}

const nodeEls = Object.values(nodes).map((n) => {
  if (n.kind === "hub") {
    return `<g>
    <circle cx="${n.x}" cy="${n.y}" r="${HUB_R}" class="hub">
      <animate attributeName="r" values="${HUB_R};${HUB_R + 2};${HUB_R}" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    ${n.private ? lock(n.x, n.y - 24, 1, "var(--hub-accent)") : ""}
    <text x="${n.x}" y="${n.y + 12}" text-anchor="middle" class="hub-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "cube") {
    const x = n.x - CUBE / 2, y = n.y - CUBE / 2;
    return `<g>
    <rect x="${x}" y="${y}" width="${CUBE}" height="${CUBE}" rx="16" class="cube"/>
    ${n.private ? lock(n.x, n.y - 22, 1, "var(--cube-accent)") : ""}
    <text x="${n.x}" y="${n.y + 12}" text-anchor="middle" class="cube-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "triangle") {
    const dx = TRI_CIRCUM * Math.sqrt(3) / 2; // half base width
    const top = `${n.x},${f1(n.y - TRI_CIRCUM)}`;
    const bl = `${f1(n.x - dx)},${f1(n.y + TRI_CIRCUM / 2)}`;
    const br = `${f1(n.x + dx)},${f1(n.y + TRI_CIRCUM / 2)}`;
    return `<g>
    <polygon points="${top} ${br} ${bl}" class="tri" stroke-linejoin="round"/>
    <text x="${n.x}" y="${n.y + 20}" text-anchor="middle" class="tri-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  const w = nodeWidth(n);
  const x = n.x - w / 2;
  const y = n.y - CHIP_H / 2;
  if (n.kind === "pill") {
    return `<g>
    <rect x="${f1(x)}" y="${y}" width="${w}" height="${CHIP_H}" rx="${CHIP_H / 2}" class="chip" stroke="${n.color}"/>
    <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" class="chip-label" style="fill:${n.color}">${escapeXML(n.label)}</text>
  </g>`;
  }
  const glyph = n.private
    ? lock(x + 15, n.y, 0.62, n.color)
    : `<circle cx="${f1(x + 15)}" cy="${n.y}" r="4" fill="${n.color}"/>`;
  return `<g>
    <rect x="${f1(x)}" y="${y}" width="${w}" height="${CHIP_H}" rx="8" class="chip" stroke="${n.color}"/>
    ${glyph}
    <text x="${f1(x + 27)}" y="${n.y + 5}" class="chip-label">${escapeXML(n.label)}</text>
  </g>`;
});

// ---------------------------------------------------------------------------
// Assemble.
// ---------------------------------------------------------------------------
const aria =
  "Project graph — engram (private) and crebain connect through the always-on NCP protocol to prisoma, a private hub; pid-rs, cobot-atlas and cobot-relief connect to prisoma; cobot-atlas and cobot-relief also connect to crebain.";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    <radialGradient id="hubGrad" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#241a44"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="cubeGrad" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="#0b2b33"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="triGrad" cx="50%" cy="56%" r="70%">
      <stop offset="0%" stop-color="#2b1020"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="edgeGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    ${gradDefs.join("\n    ")}
  </defs>
  <style>
    :root { --hub-accent: #a78bfa; --cube-accent: #22d3ee; }
    .cap        { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; letter-spacing: 2px; }
    .edge       { opacity: 0.55; }
    .edge-live  { filter: url(#edgeGlow); }
    .flow       { fill: none; stroke: #e2faff; stroke-width: 2.4; stroke-dasharray: 1.5 9; stroke-linecap: round; opacity: 0.9; }
    .flow-rev   { stroke-width: 1.8; opacity: 0.45; }
    .chip       { fill: #0d1117; stroke-width: 1.5; }
    .chip-label { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .hub        { fill: url(#hubGrad); stroke: #a78bfa; stroke-width: 2; filter: url(#soft); }
    .hub-label  { font: 700 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c4b5fd; }
    .cube       { fill: url(#cubeGrad); stroke: #22d3ee; stroke-width: 2; filter: url(#soft); }
    .cube-label { font: 700 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #67e8f9; }
    .tri        { fill: url(#triGrad); stroke: #f472b6; stroke-width: 2; filter: url(#soft); }
    .tri-label  { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #f9a8d4; }
    .panel      { fill: #ffffff; fill-opacity: 0.022; stroke: #ffffff; stroke-opacity: 0.07; }
    @media (prefers-color-scheme: light) {
      :root { --hub-accent: #7c3aed; --cube-accent: #0891b2; }
      .cap { fill: #57606a; }
      .flow { stroke: #22d3ee; }
      .chip { fill: #ffffff; }
      .chip-label { fill: #1f2328; }
      .hub { fill: #ffffff; stroke: #7c3aed; }
      .hub-label { fill: #6d28d9; }
      .cube { fill: #ffffff; stroke: #0891b2; }
      .cube-label { fill: #0891b2; }
      .tri { fill: #ffffff; stroke: #db2777; }
      .tri-label { fill: #be185d; }
      .panel { fill: #0b1f2a; fill-opacity: 0.025; stroke: #0b1f2a; stroke-opacity: 0.08; }
    }
    @media (prefers-reduced-motion: reduce) { animate { display: none; } }
  </style>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" class="panel"/>
  <text x="40" y="40" class="cap">THE&#160;SYSTEM&#160;&#8212;&#160;HOW&#160;THE&#160;WORK&#160;CONNECTS</text>

  <g class="edges">
    ${calmEdges.join("\n    ")}
    ${liveEdges.join("\n    ")}
  </g>
  <g class="flows">
    ${flows.join("\n    ")}
  </g>
  <g class="nodes">
    ${nodeEls.join("\n  ")}
  </g>
</svg>
`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, svg, "utf8");
console.log(`[work-graph] wrote ${OUT_PATH} (${svg.length} bytes)`);
