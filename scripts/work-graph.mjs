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
// NCP's connections are PERSISTENT, live links: a glowing spine plus TWO
// near-equal counter-flowing packet lanes (full-duplex, the edge echo of NCP's
// dual-lane gate glyph).
// A few nodes carry bespoke, animated "logos": NCP is a dual-lane safety gate
// (perception ⇄ action through one checkpoint); cortexel is a voxel NEURAL
// NETWORK matted in a render-viewport with an incoming agent VizSpec; crebain
// is its own raven-in-crosshair mark. The whole panel is wrapped in a
// "provenance instrument" frame (amber corner brackets).
// Theme-adaptive (prefers-color-scheme), reduced-motion safe. Zero deps.
// Run: `node scripts/work-graph.mjs`.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "assets", "work-graph.svg");

// crebain's brand mark (raven-in-crosshair) embedded as a base64 data-URI, so
// the self-contained SVG renders the real logo with zero external requests
// (an <img>-embedded SVG can't fetch external URLs, but data: URIs are fine).
const CREBAIN_LOGO =
  "data:image/png;base64," +
  readFileSync(resolve(__dirname, "..", "pics", "crebain-logo.png")).toString("base64");

const W = 860;
const H = 460;

// ---------------------------------------------------------------------------
// Spec. Positions are node centres; colours are per-project accents.
//   large: cube · hub (circle) · triangle · hexagon
//   bespoke logos: gate (NCP) · voxel-net (cortexel) · raven (crebain) | chip
// ---------------------------------------------------------------------------
const nodes = {
  engram:      { x: 110, y: 230, color: "#22d3ee", kind: "cube", private: true },
  pidrs:       { x: 250, y: 98,  color: "#34d399", kind: "hub", label: "pid-rs", r: 36 },
  ncp:         { x: 250, y: 230, color: "#fbbf24", kind: "gate", label: "NCP" },
  prisoma:     { x: 460, y: 130, color: "#a78bfa", kind: "triangle", private: true },
  crebain:     { x: 460, y: 332, color: "#f472b6", kind: "raven" },
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
const NET_R = 26; // cortexel voxel-net trim radius (only the up-edge to engram uses it)
const RAVEN_R = 36; // crebain crosshair-reticle ring radius
const CHIP_H = 32;
const GAP = 7;

const escapeXML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

function nodeWidth(n) {
  if (n.kind === "hub") return (n.r || HUB_R) * 2;
  if (n.kind === "cube") return CUBE;
  const pad = (n.kind === "gate") ? 28 : 36;
  return Math.round(n.label.length * 7.8 + pad);
}
function halfExtents(n) {
  if (n.kind === "hub") return { hw: (n.r || HUB_R), hh: (n.r || HUB_R), circle: true };
  if (n.kind === "voxel") return { hw: NET_R, hh: NET_R, circle: true };
  if (n.kind === "raven") return { hw: 38, hh: 38, circle: true };
  if (n.kind === "cube") return { hw: CUBE / 2, hh: CUBE / 2, circle: false };
  return { hw: nodeWidth(n) / 2, hh: CHIP_H / 2, circle: false };
}

// Centre-relative polygon silhouette for the angular shapes (null => fall back
// to the rect/circle box in halfExtents). Kept in lockstep with the render
// geometry so edges trim to the TRUE outline.
function nodePolygon(n) {
  if (n.kind === "triangle") {
    const dx = (TRI_CIRCUM * Math.sqrt(3)) / 2;
    return [{ x: 0, y: -TRI_CIRCUM }, { x: dx, y: TRI_CIRCUM / 2 }, { x: -dx, y: TRI_CIRCUM / 2 }];
  }
  if (n.kind === "hexagon") {
    const R = HEX_CIRCUM, dy = (R * Math.sqrt(3)) / 2;
    return [{ x: R, y: 0 }, { x: R / 2, y: -dy }, { x: -R / 2, y: -dy }, { x: -R, y: 0 }, { x: -R / 2, y: dy }, { x: R / 2, y: dy }];
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
    // Glowing gradient spine with a slow opacity pulse…
    liveEdges.push(
      `<path d="${d}" fill="none" stroke="url(#${gid})" stroke-width="3" stroke-linecap="round" class="edge-live">` +
        `<animate attributeName="opacity" values="0.7;1;0.7" dur="2.8s" begin="${(i * 0.3).toFixed(2)}s" repeatCount="indefinite"/></path>`
    );
    // …plus TWO near-equal counter-flowing packet lanes, offset across the chord
    // normal (nx,ny) so they read full-duplex at any edge angle — the edge echo
    // of NCP's dual-lane gate. 21 = two dash periods (jump-free); matched dur.
    const off = 2.4;
    const dF = `M ${f1(p0.x + off * nx)} ${f1(p0.y + off * ny)} Q ${f1(c.x + off * nx)} ${f1(c.y + off * ny)} ${f1(p1.x + off * nx)} ${f1(p1.y + off * ny)}`;
    const dR = `M ${f1(p0.x - off * nx)} ${f1(p0.y - off * ny)} Q ${f1(c.x - off * nx)} ${f1(c.y - off * ny)} ${f1(p1.x - off * nx)} ${f1(p1.y - off * ny)}`;
    flows.push(
      `<path d="${dF}" class="flow"><animate attributeName="stroke-dashoffset" from="21" to="0" dur="1.7s" repeatCount="indefinite"/></path>`,
      `<path d="${dR}" class="flow flow-rev"><animate attributeName="stroke-dashoffset" from="0" to="21" dur="1.7s" repeatCount="indefinite"/></path>`
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
    const r = n.r || HUB_R;
    return `<g>
    <circle cx="${n.x}" cy="${n.y}" r="${r}" class="hub">
      <animate attributeName="r" values="${r};${r + 2};${r}" dur="3.2s" repeatCount="indefinite"/>
    </circle>
    ${n.private ? lock(n.x, n.y - 24, 1, "var(--hub-accent)") : ""}
    <text x="${n.x}" y="${n.y + (n.private ? 12 : 6)}" text-anchor="middle" class="hub-label">${escapeXML(n.label)}</text>
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
  if (n.kind === "gate") {
    // NCP — TWO LANES, ONE GATE: an upper PERCEPTION lane (body→brain, packets
    // right→left, dashed best-effort) + a lower ACTION lane (brain→body, left→
    // right, solid express, SAFETY-GATED — its packet dwells to be verify-
    // stamped then releases). Counter-flowing packets = two-way at a glance;
    // dashed-vs-solid = the QoS asymmetry. The lanes fan straight into the live
    // edges (prisoma=perception/top, crebain=action/bottom, engram=centre trunk).
    return `<g>
    <g filter="url(#soft)">
      <path d="M224 222 H243 M257 222 H276" class="gate-wire-perc"/>
      <path d="M224 238 H243 M257 238 H276" class="gate-wire"/>
      <circle cx="224" cy="222" r="2.2" class="gate-port"/>
      <circle cx="276" cy="222" r="2.2" class="gate-port"/>
      <circle cx="224" cy="238" r="2.2" class="gate-port"/>
      <circle cx="276" cy="238" r="2.2" class="gate-port"/>
      <rect x="247.5" y="214" width="5" height="32" rx="2.5" class="gate-bar">
        <animate attributeName="fill-opacity" values="0.16;0.32;0.16" dur="2.8s" repeatCount="indefinite"/>
      </rect>
      <polyline points="246.6,238.6 249.4,241.2 253.2,235.6" class="gate-tick">
        <animate attributeName="stroke-opacity" values="0.75;0.75;1;0.75;0.75" keyTimes="0;0.5;0.58;0.72;1" dur="2.6s" repeatCount="indefinite"/>
        <animate attributeName="stroke-width" values="1.6;1.6;2.4;1.6;1.6" keyTimes="0;0.52;0.6;0.74;1" dur="2.6s" repeatCount="indefinite"/>
      </polyline>
      <circle cx="250" cy="222" r="2.6" class="gate-packet-perc">
        <animate attributeName="cx" values="276;224" dur="1.9s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.7;0.35;0.7;0.5;0.7" dur="1.9s" repeatCount="indefinite"/>
      </circle>
      <circle cx="240" cy="238" r="3" class="gate-packet">
        <animate attributeName="cx" values="224;248;248;254;276" keyTimes="0;0.34;0.56;0.62;1" dur="2.6s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;1;0.3;1;1" keyTimes="0;0.34;0.56;0.62;1" dur="2.6s" repeatCount="indefinite"/>
      </circle>
    </g>
    <text x="${n.x}" y="262" text-anchor="middle" class="gate-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "voxel") {
    // cortexel — a VOXEL NEURAL NETWORK (three iso voxel-neurons + flowing
    // synapses) matted inside a render VIEWPORT (corner brackets => it's a
    // rendered figure = visualisation), with a "</>" VizSpec caret firing one
    // inbound directive packet (an agent requests the render = agentic).
    const vw = 9, vbh = 8, rh = vw / 2;
    const T = { x: n.x, y: n.y - 25 };
    const L = { x: n.x - 20, y: n.y + 13 };
    const R = { x: n.x + 20, y: n.y + 13 };
    const cube = (c) => {
      const cyt = c.y - vbh / 2;
      const bt = `${f1(c.x)},${f1(cyt - rh)}`;
      const rr = `${f1(c.x + vw)},${f1(cyt)}`;
      const ft = `${f1(c.x)},${f1(cyt + rh)}`;
      const lf = `${f1(c.x - vw)},${f1(cyt)}`;
      const rb = `${f1(c.x + vw)},${f1(cyt + vbh)}`;
      const fb = `${f1(c.x)},${f1(cyt + rh + vbh)}`;
      const lb = `${f1(c.x - vw)},${f1(cyt + vbh)}`;
      return `<polygon points="${lf} ${ft} ${fb} ${lb}" class="vox-left" stroke-linejoin="round"/>` +
        `<polygon points="${rr} ${ft} ${fb} ${rb}" class="vox-right" stroke-linejoin="round"/>` +
        `<polygon points="${bt} ${rr} ${ft} ${lf}" class="vox-top" stroke-linejoin="round"/>`;
    };
    const syn = (a, b) => `<line x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}" class="vox-syn"/>`;
    const flow = (a, b, dur) =>
      `<path d="M${f1(a.x)} ${f1(a.y)} L${f1(b.x)} ${f1(b.y)}" class="flow"><animate attributeName="stroke-dashoffset" from="24" to="0" dur="${dur}" repeatCount="indefinite"/></path>`;
    return `<g>
    <g filter="url(#soft)">
      ${syn(T, L)} ${syn(T, R)} ${syn(L, R)}
      ${flow(T, L, "1.5s")} ${flow(T, R, "1.5s")} ${flow(L, R, "1.9s")}
      ${cube(L)} ${cube(R)} ${cube(T)}
      <polyline points="65,319 61,323 65,327" class="vox-spec"/>
      <polyline points="69,319 73,323 69,327" class="vox-spec"/>
      <line x1="68" y1="318" x2="65" y2="328" class="vox-spec"/>
      <path d="M73 323 H81" class="flow"><animate attributeName="stroke-dashoffset" from="10.5" to="0" dur="1.6s" repeatCount="indefinite"/></path>
    </g>
    <path d="M77 331 V327 A4 4 0 0 1 81 323 H89" class="vp-frame"><animate attributeName="stroke-opacity" values="0.7;0.7;1;0.7" keyTimes="0;0.45;0.6;1" dur="1.6s" repeatCount="indefinite"/></path>
    <path d="M143 377 V381 A4 4 0 0 1 139 385 H131" class="vp-frame"/>
    <text x="${n.x}" y="${f1(n.y + 38)}" text-anchor="middle" class="vox-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "raven") {
    // crebain — its real brand mark (a faceted raven head + red eye in a tactical
    // crosshair reticle), embedded verbatim as a base64 PNG.
    const cx = n.x, cy = n.y, S = 90;
    return `<g>
    <image href="${CREBAIN_LOGO}" x="${f1(cx - S / 2)}" y="${f1(cy - S / 2)}" width="${S}" height="${S}" preserveAspectRatio="xMidYMid meet"/>
    <text x="${cx}" y="${f1(cy + S / 2 + 8)}" text-anchor="middle" class="raven-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  // small "chip" nodes
  const w = nodeWidth(n);
  const x = n.x - w / 2;
  const y = n.y - CHIP_H / 2;
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
// Frame — a "provenance instrument": four amber corner brackets, all in NCP's
// amber (the connective protocol literally framing the work it connects).
// ---------------------------------------------------------------------------
const frame = `<g class="frame">
    <line x1="27" y1="11" x2="833" y2="11" class="wg-rule"/>
    <path d="M 37 11 H 27 A 16 16 0 0 0 11 27 V 37" class="wg-bracket"/>
    <path d="M 823 11 H 833 A 16 16 0 0 1 849 27 V 37" class="wg-bracket"/>
    <path d="M 849 423 V 433 A 16 16 0 0 1 833 449 H 823" class="wg-bracket"/>
    <path d="M 37 449 H 27 A 16 16 0 0 1 11 433 V 423" class="wg-bracket"/>
  </g>`;

// ---------------------------------------------------------------------------
// Assemble.
// ---------------------------------------------------------------------------
const aria =
  "Project graph — engram (private) and crebain connect through the always-on, two-way NCP protocol to prisoma, a private hub; pid-rs, cobot-atlas, melkor and cobot-relief connect to prisoma; cobot-atlas, melkor and cobot-relief also connect to crebain; cortexel connects to engram.";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    <radialGradient id="hubGrad" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#06281d"/>
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
    <radialGradient id="ravenGrad" cx="50%" cy="45%" r="70%">
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
    :root { --hub-accent: #34d399; --cube-accent: #22d3ee; --tri-accent: #a78bfa; }
    .cap        { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; letter-spacing: 2px; }
    .edge       { opacity: 0.55; }
    .edge-live  { filter: url(#edgeGlow); }
    .flow       { fill: none; stroke: #e2faff; stroke-width: 2.4; stroke-dasharray: 1.5 9; stroke-linecap: round; opacity: 0.9; }
    .flow-rev   { stroke-width: 2; opacity: 0.78; }
    .chip       { fill: #0d1117; stroke-width: 1.5; }
    .chip-label { font: 600 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .hub        { fill: url(#hubGrad); stroke: #34d399; stroke-width: 2; filter: url(#soft); }
    .hub-label  { font: 700 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6ee7b7; }
    .cube       { fill: url(#cubeGrad); stroke: #22d3ee; stroke-width: 2; filter: url(#soft); }
    .cube-label { font: 700 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #67e8f9; }
    .tri        { fill: url(#triGrad); stroke: #a78bfa; stroke-width: 2; filter: url(#soft); }
    .tri-label  { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c4b5fd; }
    .hex        { fill: url(#hexGrad); stroke: #fb923c; stroke-width: 2; filter: url(#soft); }
    .hex-label  { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fdba74; }
    .gate-wire      { fill: none; stroke: #fbbf24; stroke-width: 2.6; stroke-linecap: round; opacity: 0.92; }
    .gate-wire-perc { fill: none; stroke: #fbbf24; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 5 4; opacity: 0.6; }
    .gate-bar       { fill: #fbbf24; fill-opacity: 0.16; stroke: #fbbf24; stroke-width: 2; }
    .gate-port      { fill: #fbbf24; }
    .gate-tick      { fill: none; stroke: #fde68a; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .gate-packet    { fill: #fde68a; }
    .gate-packet-perc { fill: #fde68a; opacity: 0.7; }
    .gate-label     { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fbbf24; text-anchor: middle; }
    .vox-top    { fill: #e879f9; fill-opacity: 0.6; stroke: #e879f9; stroke-width: 1.3; }
    .vox-left   { fill: #e879f9; fill-opacity: 0.32; stroke: #e879f9; stroke-width: 1.3; }
    .vox-right  { fill: #e879f9; fill-opacity: 0.15; stroke: #e879f9; stroke-width: 1.3; }
    .vox-syn    { stroke: #e879f9; stroke-width: 1.4; stroke-opacity: 0.5; stroke-linecap: round; }
    .vox-spec   { fill: none; stroke: #f0abfc; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }
    .vp-frame   { fill: none; stroke: #e879f9; stroke-width: 1.4; stroke-opacity: 0.7; stroke-linecap: round; stroke-linejoin: round; }
    .vox-label  { font: 700 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #f0abfc; }
    .raven-ring  { fill: none; stroke: #f472b6; stroke-width: 1.6; stroke-opacity: 0.6; }
    .raven-tick  { stroke: #f472b6; stroke-width: 1.6; stroke-linecap: round; stroke-opacity: 0.75; }
    .raven-dot   { fill: #34d399; }
    .raven-body  { fill: url(#ravenGrad); fill-opacity: 0.85; stroke: #f472b6; stroke-width: 1.3; }
    .raven-facet { fill: none; stroke: #f472b6; stroke-width: 0.9; stroke-opacity: 0.55; stroke-linecap: round; }
    .raven-eye   { fill: #fb4d4d; }
    .raven-label { font: 700 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #f9a8d4; }
    .wg-rule    { stroke: #30363d; stroke-width: 1; stroke-opacity: 0.55; }
    .wg-bracket { fill: none; stroke: #fbbf24; stroke-width: 1.5; stroke-linecap: round; stroke-opacity: 0.85; }
    .panel      { fill: #ffffff; fill-opacity: 0.022; stroke: #ffffff; stroke-opacity: 0.07; }
    @media (prefers-color-scheme: light) {
      :root { --hub-accent: #059669; --cube-accent: #0891b2; --tri-accent: #7c3aed; }
      .cap { fill: #57606a; }
      .flow { stroke: #22d3ee; }
      .chip { fill: #ffffff; }
      .chip-label { fill: #1f2328; }
      .hub { fill: #ffffff; stroke: #059669; }
      .hub-label { fill: #059669; }
      .cube { fill: #ffffff; stroke: #0891b2; }
      .cube-label { fill: #0891b2; }
      .tri { fill: #ffffff; stroke: #7c3aed; }
      .tri-label { fill: #6d28d9; }
      .hex { fill: #ffffff; stroke: #c2410c; }
      .hex-label { fill: #c2410c; }
      .gate-wire { stroke: #b45309; }
      .gate-wire-perc { stroke: #b45309; }
      .gate-bar { fill: #b45309; stroke: #b45309; }
      .gate-port { fill: #b45309; }
      .gate-tick { stroke: #b45309; }
      .gate-packet { fill: #b45309; }
      .gate-packet-perc { fill: #b45309; }
      .gate-label { fill: #b45309; }
      .vox-top { fill: #c026d3; fill-opacity: 0.3; stroke: #c026d3; }
      .vox-left { fill: #c026d3; fill-opacity: 0.16; stroke: #c026d3; }
      .vox-right { fill: #c026d3; fill-opacity: 0.07; stroke: #c026d3; }
      .vox-syn { stroke: #c026d3; }
      .vox-spec { stroke: #c026d3; }
      .vp-frame { stroke: #c026d3; }
      .vox-label { fill: #c026d3; }
      .raven-ring { stroke: #db2777; }
      .raven-tick { stroke: #db2777; }
      .raven-dot { fill: #059669; }
      .raven-body { fill: #ffffff; fill-opacity: 0.9; stroke: #db2777; }
      .raven-facet { stroke: #db2777; }
      .raven-eye { fill: #dc2626; }
      .raven-label { fill: #be185d; }
      .wg-rule { stroke: #d0d7de; stroke-opacity: 0.9; }
      .wg-bracket { stroke: #b45309; }
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
  ${frame}
</svg>
`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, svg, "utf8");
console.log(`[work-graph] wrote ${OUT_PATH} (${svg.length} bytes)`);
