#!/usr/bin/env node
// scripts/work-graph.mjs
// Generates assets/work-graph.svg — the "Selected work" project relationship
// graph, from a declarative {nodes, edges} spec so the geometry is correct and
// easy to edit:
//   • edges are trimmed to each node's true boundary (rect, circle, or polygon)
//     so a line never runs under a node;
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
//   large: cube · hub (circle) · triangle · hexagon · trapezoid · voxel (iso
//   cube)   |   small: pill · chip
// ---------------------------------------------------------------------------
const nodes = {
  engram:      { x: 110, y: 230, color: "#22d3ee", kind: "cube", private: true },
  pidrs:       { x: 250, y: 86,  color: "#34d399", kind: "trapezoid", label: "pid-rs" },
  ncp:         { x: 250, y: 230, color: "#fbbf24", kind: "pill", label: "NCP" },
  prisoma:     { x: 460, y: 130, color: "#a78bfa", kind: "triangle", private: true },
  crebain:     { x: 460, y: 332, color: "#f472b6", kind: "hub" },
  cobotatlas:  { x: 690, y: 150, color: "#60a5fa", kind: "chip", label: "cobot-atlas" },
  melkor:      { x: 690, y: 250, color: "#fb923c", kind: "hexagon" },
  cobotrelief: { x: 690, y: 350, color: "#fb7185", kind: "chip", label: "cobot-relief" },
  cortexel:    { x: 110, y: 360, color: "#e879f9", kind: "voxel" },
};
for (const [id, n] of Object.entries(nodes)) n.label = n.label || id;

const edges = [
  { a: "engram",      b: "ncp" },
  { a: "ncp",         b: "prisoma" },
  { a: "ncp",         b: "crebain" },
  { a: "pidrs",       b: "prisoma" },
  { a: "cobotatlas",  b: "prisoma" },
  { a: "melkor",      b: "prisoma" },
  { a: "cobotrelief", b: "prisoma" },
  { a: "crebain",     b: "cobotatlas" },
  { a: "crebain",     b: "melkor" },
  { a: "crebain",     b: "cobotrelief" },
  { a: "cortexel",    b: "engram" },
];

// ---------------------------------------------------------------------------
// Geometry.
// ---------------------------------------------------------------------------
const HUB_R = 46;
const CUBE = 92; // engram square, matched to a hub's diameter
const TRI_CIRCUM = 53; // prisoma triangle circumradius (~92 wide, like the others)
const HEX_CIRCUM = 40; // melkor hexagon circumradius (flat-top: 80 wide, ~69 tall)
const TRAP_TW = 20; // pid-rs trapezoid: top half-width
const TRAP_BW = 40; // …bottom half-width (wider base — a truncated triangle)
const TRAP_HH = 24; // …half-height
const VOX_W = 32; // cortexel voxel (iso cube): horizontal half-width
const VOX_H = 36; // …half-height to the top/bottom vertices
const CHIP_H = 32;
const GAP = 7;

const escapeXML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

function nodeWidth(n) {
  if (n.kind === "hub") return HUB_R * 2;
  if (n.kind === "cube") return CUBE;
  const pad = n.kind === "pill" ? 28 : 36;
  return Math.round(n.label.length * 7.8 + pad);
}
function halfExtents(n) {
  if (n.kind === "hub") return { hw: HUB_R, hh: HUB_R, circle: true };
  if (n.kind === "cube") return { hw: CUBE / 2, hh: CUBE / 2, circle: false };
  return { hw: nodeWidth(n) / 2, hh: CHIP_H / 2, circle: false };
}

// Centre-relative polygon silhouette for the angular shapes (null => fall back
// to the rect/circle box in halfExtents). Kept in lockstep with the render
// geometry so edges trim to the TRUE outline — exact for a triangle/trapezoid
// whose boundary distance swings a lot with direction (no single radius works).
function nodePolygon(n) {
  if (n.kind === "triangle") {
    const dx = (TRI_CIRCUM * Math.sqrt(3)) / 2;
    return [{ x: 0, y: -TRI_CIRCUM }, { x: dx, y: TRI_CIRCUM / 2 }, { x: -dx, y: TRI_CIRCUM / 2 }];
  }
  if (n.kind === "hexagon") {
    const R = HEX_CIRCUM, dy = (R * Math.sqrt(3)) / 2;
    return [{ x: R, y: 0 }, { x: R / 2, y: -dy }, { x: -R / 2, y: -dy }, { x: -R, y: 0 }, { x: -R / 2, y: dy }, { x: R / 2, y: dy }];
  }
  if (n.kind === "trapezoid") {
    return [{ x: -TRAP_TW, y: -TRAP_HH }, { x: TRAP_TW, y: -TRAP_HH }, { x: TRAP_BW, y: TRAP_HH }, { x: -TRAP_BW, y: TRAP_HH }];
  }
  if (n.kind === "voxel") {
    return [{ x: 0, y: -VOX_H }, { x: VOX_W, y: -VOX_H / 2 }, { x: VOX_W, y: VOX_H / 2 }, { x: 0, y: VOX_H }, { x: -VOX_W, y: VOX_H / 2 }, { x: -VOX_W, y: -VOX_H / 2 }];
  }
  return null;
}

// Distance from a node centre to its polygon boundary along unit dir (ux,uy):
// the nearest positive ray–edge intersection. Ray P = s·D from the centre.
function polyBoundary(verts, ux, uy) {
  let best = Infinity;
  for (let i = 0; i < verts.length; i++) {
    const A = verts[i], B = verts[(i + 1) % verts.length];
    const Ex = B.x - A.x, Ey = B.y - A.y;
    const det = Ex * uy - ux * Ey;
    if (Math.abs(det) < 1e-9) continue;
    const s = (Ex * A.y - A.x * Ey) / det; // distance along the ray
    const t = (ux * A.y - uy * A.x) / det; // position along the edge [0,1]
    if (s >= 0 && t >= -1e-9 && t <= 1 + 1e-9 && s < best) best = s;
  }
  return Number.isFinite(best) ? best : 0;
}

function boundaryDist(n, ux, uy) {
  const poly = nodePolygon(n);
  if (poly) return polyBoundary(poly, ux, uy);
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
    ${n.private ? lock(n.x, n.y - 8, 1, "var(--tri-accent)") : ""}
    <text x="${n.x}" y="${n.y + 20}" text-anchor="middle" class="tri-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "hexagon") {
    const R = HEX_CIRCUM;
    const dy = (R * Math.sqrt(3)) / 2; // flat-top hexagon half-height
    const pts = [
      `${f1(n.x + R)},${n.y}`,
      `${f1(n.x + R / 2)},${f1(n.y - dy)}`,
      `${f1(n.x - R / 2)},${f1(n.y - dy)}`,
      `${f1(n.x - R)},${n.y}`,
      `${f1(n.x - R / 2)},${f1(n.y + dy)}`,
      `${f1(n.x + R / 2)},${f1(n.y + dy)}`,
    ].join(" ");
    return `<g>
    <polygon points="${pts}" class="hex" stroke-linejoin="round"/>
    ${n.private ? lock(n.x, n.y - 20, 1, "#fb923c") : ""}
    <text x="${n.x}" y="${n.y + 5}" text-anchor="middle" class="hex-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "trapezoid") {
    const pts = [
      `${f1(n.x - TRAP_TW)},${f1(n.y - TRAP_HH)}`,
      `${f1(n.x + TRAP_TW)},${f1(n.y - TRAP_HH)}`,
      `${f1(n.x + TRAP_BW)},${f1(n.y + TRAP_HH)}`,
      `${f1(n.x - TRAP_BW)},${f1(n.y + TRAP_HH)}`,
    ].join(" ");
    return `<g>
    <polygon points="${pts}" class="trap" stroke-linejoin="round"/>
    <text x="${n.x}" y="${f1(n.y + 6)}" text-anchor="middle" class="trap-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "voxel") {
    // Isometric cube: a hexagonal silhouette split into top / left / right faces
    // (shaded brightest → dimmest) so it reads as a 3-D "voxel" block.
    const T = `${n.x},${f1(n.y - VOX_H)}`;
    const UR = `${f1(n.x + VOX_W)},${f1(n.y - VOX_H / 2)}`;
    const UL = `${f1(n.x - VOX_W)},${f1(n.y - VOX_H / 2)}`;
    const C = `${n.x},${n.y}`;
    const LR = `${f1(n.x + VOX_W)},${f1(n.y + VOX_H / 2)}`;
    const LL = `${f1(n.x - VOX_W)},${f1(n.y + VOX_H / 2)}`;
    const B = `${n.x},${f1(n.y + VOX_H)}`;
    return `<g>
    <g filter="url(#soft)">
      <polygon points="${T} ${UR} ${C} ${UL}" class="vox-top" stroke-linejoin="round"/>
      <polygon points="${UL} ${C} ${B} ${LL}" class="vox-left" stroke-linejoin="round"/>
      <polygon points="${UR} ${C} ${B} ${LR}" class="vox-right" stroke-linejoin="round"/>
    </g>
    <text x="${n.x}" y="${f1(n.y + VOX_H + 16)}" text-anchor="middle" class="vox-label">${escapeXML(n.label)}</text>
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
  "Project graph — engram (private) and crebain connect through the always-on NCP protocol to prisoma, a private hub; pid-rs, cobot-atlas, melkor and cobot-relief connect to prisoma; cobot-atlas, melkor and cobot-relief also connect to crebain; cortexel connects to engram.";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    <radialGradient id="hubGrad" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#2b1020"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="cubeGrad" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="#0b2b33"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="triGrad" cx="50%" cy="56%" r="70%">
      <stop offset="0%" stop-color="#241a44"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="hexGrad" cx="50%" cy="45%" r="70%">
      <stop offset="0%" stop-color="#2a1608"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="trapGrad" cx="50%" cy="56%" r="70%">
      <stop offset="0%" stop-color="#06281d"/>
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
    :root { --hub-accent: #f472b6; --cube-accent: #22d3ee; --tri-accent: #a78bfa; }
    .cap        { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; letter-spacing: 2px; }
    .edge       { opacity: 0.55; }
    .edge-live  { filter: url(#edgeGlow); }
    .flow       { fill: none; stroke: #e2faff; stroke-width: 2.4; stroke-dasharray: 1.5 9; stroke-linecap: round; opacity: 0.9; }
    .flow-rev   { stroke-width: 1.8; opacity: 0.45; }
    .chip       { fill: #0d1117; stroke-width: 1.5; }
    .chip-label { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .hub        { fill: url(#hubGrad); stroke: #f472b6; stroke-width: 2; filter: url(#soft); }
    .hub-label  { font: 700 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #f9a8d4; }
    .cube       { fill: url(#cubeGrad); stroke: #22d3ee; stroke-width: 2; filter: url(#soft); }
    .cube-label { font: 700 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #67e8f9; }
    .tri        { fill: url(#triGrad); stroke: #a78bfa; stroke-width: 2; filter: url(#soft); }
    .tri-label  { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c4b5fd; }
    .hex        { fill: url(#hexGrad); stroke: #fb923c; stroke-width: 2; filter: url(#soft); }
    .hex-label  { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fdba74; }
    .trap       { fill: url(#trapGrad); stroke: #34d399; stroke-width: 2; filter: url(#soft); }
    .trap-label { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6ee7b7; }
    .vox-top    { fill: #e879f9; fill-opacity: 0.55; stroke: #e879f9; stroke-width: 1.4; }
    .vox-left   { fill: #e879f9; fill-opacity: 0.28; stroke: #e879f9; stroke-width: 1.4; }
    .vox-right  { fill: #e879f9; fill-opacity: 0.13; stroke: #e879f9; stroke-width: 1.4; }
    .vox-label  { font: 700 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #f0abfc; }
    .panel      { fill: #ffffff; fill-opacity: 0.022; stroke: #ffffff; stroke-opacity: 0.07; }
    @media (prefers-color-scheme: light) {
      :root { --hub-accent: #db2777; --cube-accent: #0891b2; --tri-accent: #7c3aed; }
      .cap { fill: #57606a; }
      .flow { stroke: #22d3ee; }
      .chip { fill: #ffffff; }
      .chip-label { fill: #1f2328; }
      .hub { fill: #ffffff; stroke: #db2777; }
      .hub-label { fill: #be185d; }
      .cube { fill: #ffffff; stroke: #0891b2; }
      .cube-label { fill: #0891b2; }
      .tri { fill: #ffffff; stroke: #7c3aed; }
      .tri-label { fill: #6d28d9; }
      .hex { fill: #ffffff; stroke: #c2410c; }
      .hex-label { fill: #c2410c; }
      .trap { fill: #ffffff; stroke: #059669; }
      .trap-label { fill: #059669; }
      .vox-top { fill: #c026d3; fill-opacity: 0.30; stroke: #c026d3; }
      .vox-left { fill: #c026d3; fill-opacity: 0.16; stroke: #c026d3; }
      .vox-right { fill: #c026d3; fill-opacity: 0.07; stroke: #c026d3; }
      .vox-label { fill: #c026d3; }
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
