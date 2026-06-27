#!/usr/bin/env node
// scripts/work-graph.mjs
// Generates assets/work-graph.svg, the "Selected work" project relationship
// graph, from a declarative {nodes, edges} spec so the geometry is correct and
// easy to edit:
//   • edges are trimmed to each node's true boundary (rect, circle, or polygon)
//     so a line never runs under a node;
//   • each edge is a gentle quadratic Bézier that bows AWAY from the graph
//     centroid (keeps the layout open and separates the bridge crossing);
//   • each edge is stroked with a gradient from the source node's colour to the
//     target node's colour; no arrowheads, just connections.
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

// engram's mark: the torus-automations brand logo, embedded the same way so the
// self-contained SVG renders it with zero external requests.
const TORUS_LOGO =
  "data:image/png;base64," +
  readFileSync(resolve(__dirname, "..", "pics", "torus-automations-logo.png")).toString("base64");

const W = 860;
const H = 460;

// ---------------------------------------------------------------------------
// Spec. Positions are node centres; colours are per-project accents.
//   large: cube · hub (circle) · triangle · logo (image)
//   bespoke logos: gate (NCP) · voxel-net (cortexel) · raven (crebain) | chip
// ---------------------------------------------------------------------------
const nodes = {
  engram:      { x: 110, y: 230, color: "#9fb3c8", kind: "logo", private: true },
  pidrs:       { x: 250, y: 98,  color: "#34d399", kind: "hub", label: "pid-rs", r: 36 },
  ncp:         { x: 250, y: 230, color: "#fbbf24", kind: "gate", label: "NCP" },
  prisoma:     { x: 460, y: 130, color: "#a78bfa", kind: "triangle", private: true },
  crebain:     { x: 460, y: 332, color: "#9caf88", kind: "raven" },
  cobotatlas:  { x: 690, y: 150, color: "#60a5fa", kind: "chip", label: "cobot-atlas", dataset: true },
  melkor:      { x: 690, y: 250, color: "#fb923c", kind: "cube" },
  reliefatlas: { x: 690, y: 350, color: "#fb7185", kind: "chip", label: "relief-atlas", dataset: true },
  cortexel:    { x: 110, y: 360, color: "#e879f9", kind: "voxel" },
};
// Uppercase every label in the SOURCE (not via CSS text-transform, which
// librsvg and other SVG renderers ignore — content-case renders everywhere).
for (const [id, n] of Object.entries(nodes)) n.label = (n.label || id).toUpperCase();

const edges = [
  { a: "engram",      b: "ncp" },
  { a: "ncp",         b: "prisoma" },
  { a: "ncp",         b: "crebain" },
  { a: "pidrs",       b: "prisoma" },
  { a: "cobotatlas",  b: "prisoma" },
  { a: "melkor",      b: "prisoma" },
  { a: "reliefatlas", b: "prisoma" },
  { a: "crebain",     b: "cobotatlas" },
  { a: "crebain",     b: "melkor" },
  { a: "crebain",     b: "reliefatlas" },
  { a: "cortexel",    b: "engram" },
];

// ---------------------------------------------------------------------------
// Geometry.
// ---------------------------------------------------------------------------
const HUB_R = 46;
const CUBE = 92; // melkor square, matched to a hub's diameter
const TRI_CIRCUM = 53; // prisoma triangle circumradius (~92 wide, like the others)
const NET_R = 26; // cortexel voxel-net trim radius (only the up-edge to engram uses it)
const CHIP_H = 32;
const GAP = 7;

const escapeXML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

function nodeWidth(n) {
  if (n.kind === "hub") return (n.r || HUB_R) * 2;
  if (n.kind === "cube") return CUBE;
  // gate (NCP): the dual-lane glyph is hand-tuned at fixed coords and its label
  // floats below it, so size to the glyph (~7.8px/char), not the tracked label.
  if (n.kind === "gate") return Math.round(n.label.length * 7.8 + 28);
  // chips: the label sits INSIDE the rect, now bold + 2.5px tracked (10.3px/char)
  // so widen to keep it clear of the right edge.
  return Math.round(n.label.length * 10.3 + 36);
}
function halfExtents(n) {
  if (n.kind === "hub") return { hw: (n.r || HUB_R), hh: (n.r || HUB_R), circle: true };
  if (n.kind === "voxel") return { hw: NET_R, hh: NET_R, circle: true };
  if (n.kind === "raven") return { hw: 30, hh: 30, circle: true };
  if (n.kind === "logo") return { hw: 30, hh: 30, circle: true };
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
    // normal (nx,ny) so they read full-duplex at any edge angle, the edge echo
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

// A small stacked-isometric-plates glyph for a chip, reads as "a layered
// collection of 3-D mesh samples" (a dataset). Sits where the chip's accent dot does.
function datasetPlates(cx, cy, color) {
  const hw = 5, hh = 2.6, dy = 3.4, op = [0.16, 0.24, 0.34];
  return [-dy, 0, dy].map((o, i) => {
    const c = cy + o;
    const pts = `${f1(cx)},${f1(c - hh)} ${f1(cx + hw)},${f1(c)} ${f1(cx)},${f1(c + hh)} ${f1(cx - hw)},${f1(c)}`;
    return `<polygon points="${pts}" fill="${color}" fill-opacity="${op[i]}" stroke="${color}" stroke-width="1.1" stroke-linejoin="round"/>`;
  }).join("");
}

// crebain's wordmark flag: a clean, crisp German flag chip: three bands in rich
// official colours, softly rounded, with a whisper of matte top-light shading and
// a soft drop shadow for depth. Matte (not glossy), crisp (not distressed), still
// (not wavy). One instance, so the filter / gradient / clip ids are unique.
function germanFlag(cxf, top, w) {
  const h = Number((w * 0.62).toFixed(2)), s = Number((h / 3).toFixed(3));
  const x = f1(cxf - w / 2), tp = f1(top), rx = 1.6;
  const bh = f1(s + 0.4);
  return (
    `<defs>` +
      `<filter id="flagDrop" x="-35%" y="-35%" width="170%" height="185%">` +
        `<feDropShadow dx="0" dy="0.7" stdDeviation="0.9" flood-color="#000000" flood-opacity="0.4"/></filter>` +
      `<linearGradient id="flagShade" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#ffffff" stop-opacity="0.06"/>` +
        `<stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="#000000" stop-opacity="0.13"/>` +
      `</linearGradient>` +
      `<clipPath id="flagClip"><rect x="${x}" y="${tp}" width="${w}" height="${h}" rx="${rx}"/></clipPath>` +
    `</defs>` +
    `<g filter="url(#flagDrop)">` +
      `<g clip-path="url(#flagClip)">` +
        `<rect x="${x}" y="${tp}" width="${w}" height="${bh}" class="flag-k"/>` +
        `<rect x="${x}" y="${f1(top + s)}" width="${w}" height="${bh}" class="flag-r"/>` +
        `<rect x="${x}" y="${f1(top + 2 * s)}" width="${w}" height="${bh}" class="flag-g"/>` +
        `<rect x="${x}" y="${tp}" width="${w}" height="${h}" fill="url(#flagShade)"/>` +
      `</g>` +
      `<rect x="${x}" y="${tp}" width="${w}" height="${h}" rx="${rx}" class="flag-edge"/>` +
    `</g>`
  );
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
    // A subtle Gaussian-splat / point-cloud motif inside the cube, echoing
    // melkor's 3-D reconstruction (Gaussian splatting): a DETERMINISTIC scatter
    // (mulberry32 seeded with a constant → stable output, clean git diffs) of
    // soft orange splats, denser + larger at the core, sparser + fainter at the
    // rim, a few twinkling slowly. They're clipped to the cube face and sit
    // BETWEEN it and the label, which keeps its paint-order halo so the wordmark
    // stays crisp. Colour is themed via .cube-splat's `color` (currentColor).
    let s = 0x9e3779b9;
    const rnd = () => {
      s |= 0; s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const SPLAT_R = 36; // point-cloud radius within the 92px cube
    const splats = [];
    let guard = 0;
    while (splats.length < 18 && guard++ < 90) {
      const ang = rnd() * Math.PI * 2;
      const dist = SPLAT_R * Math.pow(rnd(), 1.35); // bias toward a dense core
      const sx = n.x + Math.cos(ang) * dist;
      const sy = n.y + Math.sin(ang) * dist;
      // keep the label band clear so 'melkor' stays legible
      if (Math.abs(sy - n.y) < 9 && Math.abs(sx - n.x) < 32) continue;
      const t = dist / SPLAT_R; // 0 core … 1 rim
      const r = 6 - 3.5 * t + rnd() * 1.2; // bigger blobs at the core
      const op = Number((0.5 - 0.28 * t).toFixed(2)); // fainter at the rim
      splats.push({ sx, sy, r, op });
    }
    const splatEls = splats
      .map((sp, k) => {
        const base = `cx="${f1(sp.sx)}" cy="${f1(sp.sy)}" r="${f1(sp.r)}" fill="url(#melkorSplat)" opacity="${sp.op}"`;
        if (k % 3 === 0) {
          // a calm, staggered twinkle on a subset; reduced-motion freezes it at op
          const hi = Number(Math.min(0.85, sp.op + 0.3).toFixed(2));
          return `<circle ${base}><animate attributeName="opacity" values="${sp.op};${hi};${sp.op}" dur="${(3.4 + (k % 5) * 0.4).toFixed(1)}s" begin="${(k * 0.37).toFixed(2)}s" repeatCount="indefinite"/></circle>`;
        }
        return `<circle ${base}/>`;
      })
      .join("");
    return `<g>
    <defs>
      <radialGradient id="melkorSplat" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="currentColor" stop-opacity="0.95"/>
        <stop offset="55%" stop-color="currentColor" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </radialGradient>
      <clipPath id="melkorClip"><rect x="${x}" y="${y}" width="${CUBE}" height="${CUBE}" rx="16"/></clipPath>
    </defs>
    <rect x="${x}" y="${y}" width="${CUBE}" height="${CUBE}" rx="16" class="cube"/>
    <g class="cube-splat" clip-path="url(#melkorClip)">${splatEls}</g>
    ${n.private ? lock(n.x, n.y - 22, 1, "var(--cube-accent)") : ""}
    <text x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central" class="cube-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "logo") {
    // engram: the torus-automations brand mark seated on a gunmetal disc whose
    // metal is tinted cool-teal toward the rim and wrapped in a SOFT teal halo
    // glow (both pure gradients — no hard ring), with a thin steel rim; the
    // project label sits ABOVE the seat. The seat is lightened toward its centre
    // so the logo's dark regions pop. The node colour is steel (#9fb3c8) so its
    // live edges to NCP and cortexel resolve cool-steel via the edge gradient
    // system; the teal is a subordinate, gradient-borne accent. Metal reads well
    // in both themes, so the seat gradient is fixed; the halo recolours via
    // currentColor (.logo-glow) and the rim + label recolour for contrast. No
    // animation here → reduced-motion safe. One instance → unique ids.
    const cx = n.x, cy = n.y, S = 64, r = 34;
    return `<g>
    <defs>
      <radialGradient id="engramSeat" cx="50%" cy="50%" r="80%">
        <stop offset="0%" stop-color="#6c7787"/>
        <stop offset="45%" stop-color="#3b4754"/>
        <stop offset="72%" stop-color="#233a42"/>
        <stop offset="100%" stop-color="#122026"/>
      </radialGradient>
      <radialGradient id="engramGlow" cx="50%" cy="50%" r="50%">
        <stop offset="50%" stop-color="currentColor" stop-opacity="0"/>
        <stop offset="78%" stop-color="currentColor" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="currentColor" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${f1(r + 10)}" class="logo-glow" fill="url(#engramGlow)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" class="logo-seat" fill="url(#engramSeat)"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" class="logo-seat-ring"/>
    <image href="${TORUS_LOGO}" x="${f1(cx - S / 2)}" y="${f1(cy - S / 2)}" width="${S}" height="${S}" preserveAspectRatio="xMidYMid meet"/>
    <text x="${cx}" y="${f1(cy - 44)}" text-anchor="middle" class="logo-label">${escapeXML(n.label)}</text>
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
  if (n.kind === "gate") {
    // NCP, TWO LANES, ONE GATE: an upper PERCEPTION lane (body→brain, packets
    // right→left, dashed best-effort) + a lower ACTION lane (brain→body, left→
    // right, solid express, SAFETY-GATED; its packet dwells to be verify-
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
    // cortexel: a VOXEL NEURAL NETWORK as a genuine 3-D cluster: three isometric
    // voxel-neurons both SIZED and dimmed by depth (the front-right neuron is
    // larger + fully opaque, the apex recedes, smaller + fainter), wired by
    // CALLIGRAPHIC connections: static, tapered pen-strokes that bow and fade into
    // the distance (no moving packets), echoing the script wordmark below and
    // distinct from the SVG's other live wired edges.
    const vw = 9, vbh = 8, rh = vw / 2;
    const T = { x: n.x,      y: n.y - 25, depth: 1.0 }; // farthest, up/back
    const L = { x: n.x - 20, y: n.y + 13, depth: 0.5 }; // mid
    const R = { x: n.x + 20, y: n.y + 13, depth: 0.0 }; // nearest, front
    // Perspective: depth 0 (near)..1 (far) → opacity 1.0..0.45 AND scale 1.2..0.8.
    const dop = (d) => Number((1 - d * 0.55).toFixed(3));
    const dsc = (d) => 1.2 - d * 0.4;
    const cube = (c, s) => {
      const cw = vw * s, cbh = vbh * s, crh = rh * s, cyt = c.y - cbh / 2;
      const bt = `${f1(c.x)},${f1(cyt - crh)}`;
      const rr = `${f1(c.x + cw)},${f1(cyt)}`;
      const ft = `${f1(c.x)},${f1(cyt + crh)}`;
      const lf = `${f1(c.x - cw)},${f1(cyt)}`;
      const rb = `${f1(c.x + cw)},${f1(cyt + cbh)}`;
      const fb = `${f1(c.x)},${f1(cyt + crh + cbh)}`;
      const lb = `${f1(c.x - cw)},${f1(cyt + cbh)}`;
      return `<polygon points="${lf} ${ft} ${fb} ${lb}" class="vox-left" stroke-linejoin="round"/>` +
        `<polygon points="${rr} ${ft} ${fb} ${rb}" class="vox-right" stroke-linejoin="round"/>` +
        `<polygon points="${bt} ${rr} ${ft} ${lf}" class="vox-top" stroke-linejoin="round"/>`;
    };
    // Each cube scaled + dimmed as a unit by its depth, painted far → near.
    const cubeAt = (c) => `<g opacity="${dop(c.depth)}">${cube(c, dsc(c.depth))}</g>`;
    // Calligraphic connection: a tapered, bowed pen-stroke (a filled lens, pointed
    // at both neurons, swelling at the middle) whose fill fades with the depth of
    // its endpoints. currentColor resolves to .vox-net's theme-adaptive colour.
    const grads = [];
    let gi = 0;
    const calli = (a, b, bow) => {
      const id = `voxCalli${gi++}`;
      grads.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}">` +
          `<stop offset="0" stop-color="currentColor" stop-opacity="${dop(a.depth)}"/>` +
          `<stop offset="1" stop-color="currentColor" stop-opacity="${dop(b.depth)}"/>` +
          `</linearGradient>`
      );
      const ax = b.x - a.x, ay = b.y - a.y, ln = Math.hypot(ax, ay) || 1;
      const nx = -ay / ln, ny = ax / ln;
      const mx = (a.x + b.x) / 2 + nx * bow, my = (a.y + b.y) / 2 + ny * bow, hh = 2.2;
      const up = `${f1(mx + nx * hh)} ${f1(my + ny * hh)}`;
      const dn = `${f1(mx - nx * hh)} ${f1(my - ny * hh)}`;
      return `<path d="M${f1(a.x)} ${f1(a.y)} Q${up} ${f1(b.x)} ${f1(b.y)} Q${dn} ${f1(a.x)} ${f1(a.y)} Z" fill="url(#${id})"/>`;
    };
    const conns = `${calli(T, L, 6)} ${calli(T, R, -6)} ${calli(L, R, 6)}`;
    return `<g class="vox-net">
    <defs>${grads.join("")}</defs>
    <g filter="url(#soft)">
      ${conns}
      ${cubeAt(T)} ${cubeAt(L)} ${cubeAt(R)}
    </g>
    <text x="${n.x}" y="${f1(n.y + 39)}" text-anchor="middle" class="vox-label">${escapeXML(n.label)}</text>
  </g>`;
  }
  if (n.kind === "raven") {
    // crebain: its real brand mark (raven head + red eye in a crosshair reticle)
    // over a faint field-green seat. Below it the wordmark is TYPED OUT by a block
    // cursor, holds ~10 s with a German flag fading in beneath it, then the line is
    // "entered" (fades + drops away) and the cycle retypes. The static attribute
    // values hold the fully-typed state, so reduced-motion shows it complete.
    const cx = n.x, cy = n.y, S = 90;
    const word = n.label;                          // CSS upper-cases it
    const NN = word.length, CH = 9.7;              // 12px mono: 0.6em glyph + 2.5 track
    const Wt = NN * CH, leftX = cx - Wt / 2;        // ~centred typed line
    const baseY = cy + S / 2 + 8, curY = cy + S / 2 - 1, flagTop = cy + S / 2 + 16;
    const pause = 0.5, step = 0.13, hold = 10, enterDur = 0.4, tail = 0.1;
    const typeDone = pause + NN * step, holdEnd = typeDone + hold, enterEnd = holdEnd + enterDur;
    const CYCLE = Number((enterEnd + tail).toFixed(2));
    const kt = (ts) => ts.map((t) => Number((t / CYCLE).toFixed(4))).join(";");
    const wt = [0, pause], wv = [0, 0];
    for (let i = 1; i <= NN; i++) { wt.push(Number((pause + i * step).toFixed(3))); wv.push(Number((i * CH).toFixed(2))); }
    wt.push(enterEnd, CYCLE); wv.push(0, 0);
    const xv = wv.map((v) => f1(leftX + v));
    const ot = [0, holdEnd, enterEnd, CYCLE], dur = `${CYCLE}s`;
    return `<g>
    <circle cx="${cx}" cy="${cy}" r="34" class="raven-seat"/>
    <image href="${CREBAIN_LOGO}" x="${f1(cx - S / 2)}" y="${f1(cy - S / 2)}" width="${S}" height="${S}" preserveAspectRatio="xMidYMid meet"/>
    <defs>
      <clipPath id="crebainType" clipPathUnits="userSpaceOnUse">
        <rect x="${f1(leftX)}" y="${f1(baseY - 12)}" width="${f1(Wt)}" height="16">
          <animate attributeName="width" values="${wv.join(";")}" keyTimes="${kt(wt)}" dur="${dur}" calcMode="discrete" repeatCount="indefinite"/>
        </rect>
      </clipPath>
    </defs>
    <g class="raven-typeline">
      <text x="${f1(leftX)}" y="${f1(baseY)}" text-anchor="start" class="raven-label" clip-path="url(#crebainType)">${escapeXML(word)}</text>
      <rect x="${f1(leftX + Wt)}" y="${f1(curY)}" width="5" height="10" rx="1" class="raven-cursor">
        <animate attributeName="x" values="${xv.join(";")}" keyTimes="${kt(wt)}" dur="${dur}" calcMode="discrete" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;0" dur="1.06s" calcMode="discrete" repeatCount="indefinite"/>
      </rect>
      <g class="deflag">
        ${germanFlag(cx, flagTop, 26)}
        <animate attributeName="opacity" values="0;0;1;1" keyTimes="${kt([0, typeDone, Number((typeDone + 0.4).toFixed(2)), CYCLE])}" dur="${dur}" repeatCount="indefinite"/>
      </g>
      <animate attributeName="opacity" values="1;1;0;0" keyTimes="${kt(ot)}" dur="${dur}" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 0;0 3;0 3" keyTimes="${kt(ot)}" dur="${dur}" repeatCount="indefinite"/>
    </g>
  </g>`;
  }
  // small "chip" nodes
  const w = nodeWidth(n);
  const x = n.x - w / 2;
  const y = n.y - CHIP_H / 2;
  const glyph = n.private
    ? lock(x + 15, n.y, 0.62, n.color)
    : n.dataset
    ? datasetPlates(x + 15, n.y, n.color)
    : `<circle cx="${f1(x + 15)}" cy="${n.y}" r="4" fill="${n.color}"/>`;
  return `<g>
    <rect x="${f1(x)}" y="${y}" width="${w}" height="${CHIP_H}" rx="8" class="chip" stroke="${n.color}"/>
    ${glyph}
    <text x="${f1(x + 27)}" y="${n.y + 5}" class="chip-label">${escapeXML(n.label)}</text>
  </g>`;
});

// ---------------------------------------------------------------------------
// Frame: a "provenance instrument": four amber corner brackets, all in NCP's
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
  "Project graph: engram (private) and crebain connect through the always-on, two-way NCP protocol to prisoma, a private hub; pid-rs, cobot-atlas, melkor and relief-atlas connect to prisoma; cobot-atlas, melkor and relief-atlas also connect to crebain; cortexel connects to engram.";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    <radialGradient id="hubGrad" cx="50%" cy="42%" r="65%">
      <stop offset="0%" stop-color="#06281d"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="cubeGrad" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="#2a1608"/>
      <stop offset="100%" stop-color="#0a1117"/>
    </radialGradient>
    <radialGradient id="triGrad" cx="50%" cy="56%" r="70%">
      <stop offset="0%" stop-color="#241a44"/>
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
    :root { --hub-accent: #34d399; --cube-accent: #fb923c; --tri-accent: #a78bfa; }
    .cap        { font: 400 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; }
    .edge       { opacity: 0.55; }
    .edge-live  { filter: url(#edgeGlow); }
    .flow       { fill: none; stroke: #e2faff; stroke-width: 2.4; stroke-dasharray: 1.5 9; stroke-linecap: round; opacity: 0.9; }
    .flow-rev   { stroke-width: 2; opacity: 0.78; }
    .chip       { fill: #0d1117; stroke-width: 1.5; }
    .chip-label { font: 400 13px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c9d1d9; }
    .hub        { fill: url(#hubGrad); stroke: #34d399; stroke-width: 2; filter: url(#soft); }
    .hub-label  { font: 400 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6ee7b7; }
    .cube       { fill: url(#cubeGrad); stroke: #fb923c; stroke-width: 2; filter: url(#soft); }
    .cube-label { font: 400 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fdba74; }
    .cube-splat { color: #fb923c; }
    .logo-seat      { filter: url(#soft); }
    .logo-seat-ring { fill: none; stroke: #22d3ee; stroke-opacity: 1; stroke-width: 2; }
    .logo-glow      { color: #22d3ee; }
    .logo-label     { font: 400 16px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c7d2e0; }
    .tri        { fill: url(#triGrad); stroke: #a78bfa; stroke-width: 2; filter: url(#soft); }
    .tri-label  { font: 400 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #c4b5fd; }
    .gate-wire      { fill: none; stroke: #fbbf24; stroke-width: 2.6; stroke-linecap: round; opacity: 0.92; }
    .gate-wire-perc { fill: none; stroke: #fbbf24; stroke-width: 2; stroke-linecap: round; stroke-dasharray: 5 4; opacity: 0.6; }
    .gate-bar       { fill: #fbbf24; fill-opacity: 0.16; stroke: #fbbf24; stroke-width: 2; }
    .gate-port      { fill: #fbbf24; }
    .gate-tick      { fill: none; stroke: #fde68a; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
    .gate-packet    { fill: #fde68a; }
    .gate-packet-perc { fill: #fde68a; opacity: 0.7; }
    .gate-label     { font: 400 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #fbbf24; text-anchor: middle; }
    .vox-top    { fill: #e879f9; fill-opacity: 0.6; stroke: #e879f9; stroke-width: 1.3; }
    .vox-left   { fill: #e879f9; fill-opacity: 0.32; stroke: #e879f9; stroke-width: 1.3; }
    .vox-right  { fill: #e879f9; fill-opacity: 0.15; stroke: #e879f9; stroke-width: 1.3; }
    .flag-k     { fill: #181818; }
    .flag-r     { fill: #d8001d; }
    .flag-g     { fill: #ffcc00; }
    .flag-edge  { fill: none; stroke: #ffffff; stroke-opacity: 0.16; stroke-width: 0.6; }
    .vox-label  { font: 400 14px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #f0abfc; }
    .vox-net    { color: #e879f9; }
    .raven-seat  { fill: #9caf88; fill-opacity: 0.08; filter: url(#soft); }
    .raven-label { font: 400 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #9caf88; }
    .raven-cursor { fill: #9caf88; }
    .wg-rule    { stroke: #30363d; stroke-width: 1; stroke-opacity: 0.55; }
    .wg-bracket { fill: none; stroke: #fbbf24; stroke-width: 1.5; stroke-linecap: round; stroke-opacity: 0.85; }
    .panel      { fill: #ffffff; fill-opacity: 0.022; stroke: #ffffff; stroke-opacity: 0.07; }
    text { paint-order: stroke; stroke: #0d1117; stroke-width: 2.6; stroke-linejoin: round; text-transform: uppercase; letter-spacing: 2.5px; }
    @media (prefers-color-scheme: light) {
      text { stroke: #ffffff; }
      :root { --hub-accent: #059669; --cube-accent: #c2410c; --tri-accent: #7c3aed; }
      .cap { fill: #57606a; }
      .flow { stroke: #22d3ee; }
      .chip { fill: #ffffff; }
      .chip-label { fill: #1f2328; }
      .hub { fill: #ffffff; stroke: #059669; }
      .hub-label { fill: #059669; }
      .cube { fill: #ffffff; stroke: #c2410c; }
      .cube-label { fill: #c2410c; }
      .cube-splat { color: #c2410c; }
      .logo-seat-ring { stroke: #0891b2; }
      .logo-glow { color: #0891b2; }
      .logo-label { fill: #44505e; }
      .tri { fill: #ffffff; stroke: #7c3aed; }
      .tri-label { fill: #6d28d9; }
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
      .flag-edge { stroke: #000000; stroke-opacity: 0.25; }
      .vox-label { fill: #c026d3; }
      .vox-net { color: #c026d3; }
      .raven-seat { fill-opacity: 0.06; }
      .raven-label { fill: #4b5320; }
      .raven-cursor { fill: #4b5320; }
      .wg-rule { stroke: #d0d7de; stroke-opacity: 0.9; }
      .wg-bracket { stroke: #b45309; }
      .panel { fill: #0b1f2a; fill-opacity: 0.025; stroke: #0b1f2a; stroke-opacity: 0.08; }
    }
    @media (prefers-reduced-motion: reduce) { animate, animateTransform { display: none; } }
  </style>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" class="panel"/>
  <text x="40" y="40" class="cap">THE&#160;SYSTEM&#160;//&#160;HOW&#160;THE&#160;WORK&#160;CONNECTS</text>

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
