#!/usr/bin/env node
// scripts/work-cards.mjs
// Generates assets/work-cards.svg, the "Selected work" project cards panel: a
// 2×3 grid of per-project cards, each carrying its own IDENTITY (name, status
// badge, one-liner, stack chips) in the same visual language as the rest of the
// profile (rounded panels, per-project accent, ui-monospace, soft glow).
// Relationships are intentionally NOT shown here; the animated work-graph.svg
// directly below the cards already does that.
//
// Self-hosted, zero-dep, theme-adaptive (prefers-color-scheme), reduced-motion
// safe. Because links inside an <img>-embedded SVG are NOT clickable on GitHub,
// the README keeps a separate markdown link row for the public repos.
// Run: `node scripts/work-cards.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECTS } from "./data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "..", "assets", "work-cards.svg");

// ---------------------------------------------------------------------------
// Spec. Order is reading order (left→right, top→bottom). Accent colours match
// the work-graph nodes exactly. `light` is the WCAG-safe accent for light mode
// (mirrors the *-accent light overrides used elsewhere). `stars`/`private` set
// the top-right status badge; `repo` drives nothing in the SVG (links live in
// the README) but documents the public slug for maintainers.
// ---------------------------------------------------------------------------
const projects = PROJECTS;

// ---------------------------------------------------------------------------
// Live star counts. With a token (GitHub Actions provides GITHUB_TOKEN) we read
// each public repo's current stargazerCount so the badges auto-update; the
// `stars:` above are the no-token fallback (kept current). Private repos
// (engram, prisoma) have no `repo` and keep their lock badge. Run by the
// work-cards.yml cron; a local run without a token just uses the fallback.
async function hydrateStars(list) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  if (!token) {
    console.warn("[work-cards] no token; using baked-in star counts.");
    return;
  }
  for (const p of list) {
    if (p.private || !p.repo) continue;
    try {
      const res = await fetch(`https://api.github.com/repos/${p.repo}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "sepahead-work-cards/1.0",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (typeof json.stargazers_count === "number") {
        if (json.stargazers_count !== p.stars) {
          console.log(`[work-cards] ${p.repo}: ${p.stars} -> ${json.stargazers_count} stars`);
        }
        p.stars = json.stargazers_count;
      }
    } catch (e) {
      console.warn(`[work-cards] star fetch failed for ${p.repo} (${e.message}); keeping ${p.stars}.`);
    }
  }
}
await hydrateStars(projects);

// ---------------------------------------------------------------------------
// Layout.
// ---------------------------------------------------------------------------
const W = 860;
const M = 26;            // outer panel margin
const CAP_Y = 40;        // caption baseline
const GRID_TOP = 64;     // top of first card row
const COLS = 2;
const GUTTER = 22;
const CARD_W = Math.round((W - 2 * M - (COLS - 1) * GUTTER) / COLS); // 393
const CARD_H = 150;
const ROW_GAP = 20;
const ROWS = Math.ceil(projects.length / COLS);
const H = GRID_TOP + ROWS * CARD_H + (ROWS - 1) * ROW_GAP + M; // 64 + 3*150 + 2*20 + 26 = 580

// Card interior metrics.
const SPINE_W = 4;       // accent spine down the left edge
const PADL = 22;         // left padding (text start)
const PADR = 18;         // right padding
const TITLE_Y = 38;      // title baseline within card
const DESC_TOP = 60;     // first description line baseline within card
const DESC_LH = 18;      // description line-height
const DESC_PX = 7.2;     // px width of one description char at 12px mono (measured)
const CHIP_H = 22;
const CHIP_BOTTOM = 22;  // gap from card bottom to chip baseline area

const escapeXML = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

// Greedy word-wrap to a pixel budget (monospace → char count × per-char px).
function wrap(text, widthPx, maxLines) {
  const max = Math.floor(widthPx / DESC_PX);
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (trial.length <= max || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > max - 1 && last.includes(" ")) last = last.replace(/\s+\S+$/, "");
    lines[maxLines - 1] = last.replace(/[\s.,;:]+$/, "") + "…";
  }
  return lines;
}

// I_sx → I with subscript "sx" (used in pid-rs). Returns SVG <tspan> markup.
// The trailing tspan restores the baseline (dy back up) so following glyphs sit
// on the line again. Built without spaces collapsing the opening tag.
function richDesc(line) {
  const SUB = "I" +
    '<tspan baseline-shift="-22%" font-size="9">sx</tspan>' +
    '<tspan baseline-shift="0">​</tspan>';
  return escapeXML(line).replace(/I_sx/g, SUB);
}

// Lock glyph (matches scripts/work-graph.mjs). Top-left of the 12×15 lock body
// sits at (x, y); `scale` shrinks it. Colour comes from the `.cN.glyph-stroke`
// / `.cN.glyph-fill` CSS rules (theme-adaptive, no CSS-variable dependency on a
// presentation attribute, works in every SVG renderer).
function lock(x, y, scale, cls) {
  return `<g transform="translate(${x} ${y}) scale(${scale})">` +
    `<path d="M2 6 V4.4 a4 4 0 0 1 8 0 V6" fill="none" class="glyph-stroke ${cls}" stroke-width="1.6"/>` +
    `<rect x="0" y="6" width="12" height="9" rx="1.6" class="glyph-fill ${cls}"/></g>`;
}

// Star glyph (filled 5-point star) centred at (cx, cy), radius r.
function star(cx, cy, r, cls) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const aO = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const aI = aO + Math.PI / 5;
    pts.push(`${(cx + r * Math.cos(aO)).toFixed(1)},${(cy + r * Math.sin(aO)).toFixed(1)}`);
    pts.push(`${(cx + r * 0.42 * Math.cos(aI)).toFixed(1)},${(cy + r * 0.42 * Math.sin(aI)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" class="glyph-fill ${cls}"/>`;
}

// ---------------------------------------------------------------------------
// Build cards.
// ---------------------------------------------------------------------------
const gradDefs = [];
const cardEls = projects.map((p, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = M + col * (CARD_W + GUTTER);
  const y = GRID_TOP + row * (CARD_H + ROW_GAP);
  const cls = `c${i}`; // per-card accent class

  // Per-card accent wash: a faint radial bloom anchored at the top-left so the
  // card reads as "owned" by its colour without overpowering the text.
  const gid = `wash${i}`;
  gradDefs.push(
    `<radialGradient id="${gid}" cx="8%" cy="0%" r="120%">` +
      `<stop offset="0%" stop-color="${p.grad}" stop-opacity="0.9"/>` +
      `<stop offset="60%" stop-color="${p.grad}" stop-opacity="0"/></radialGradient>`
  );

  // Status badge (top-right): stars (★ + count) or a lock for private repos.
  let badge = "";
  const bx = x + CARD_W - PADR;
  if (p.private) {
    badge =
      lock(bx - 11, y + 16, 0.78, cls) +
      `<text x="${bx - 16}" y="${y + 28}" text-anchor="end" class="badge ${cls}">private</text>`;
  } else if (p.stars != null) {
    badge =
      star(bx - 6, y + 22, 6, cls) +
      `<text x="${bx - 16}" y="${y + 27}" text-anchor="end" class="badge ${cls}">${p.stars}</text>`;
  }

  // Title (accent-tinted). Reserve room on the right for the badge.
  const titleMaxPx = CARD_W - PADL - PADR - 64;
  const title = `<text x="${x + PADL}" y="${y + TITLE_Y}" class="title ${cls}" textLength="${Math.min(p.name.length * 13, titleMaxPx)}" lengthAdjust="spacingAndGlyphs">${escapeXML(p.name)}</text>`;

  // Accent rule under the title: short, like the hero underline.
  const rule = `<rect x="${x + PADL}" y="${y + TITLE_Y + 8}" width="34" height="2.5" rx="1.25" class="rule ${cls}"/>`;

  // Description (2–3 wrapped lines), muted.
  const descW = CARD_W - PADL - PADR;
  const lines = wrap(p.desc, descW, 3);
  const desc = lines
    .map((ln, k) => `<text x="${x + PADL}" y="${y + DESC_TOP + k * DESC_LH}" class="desc">${richDesc(ln)}</text>`)
    .join("\n    ");

  // Stack chips along the bottom: accent-outlined pills.
  let cx = x + PADL;
  const chipY = y + CARD_H - CHIP_BOTTOM - CHIP_H + 4;
  const chips = p.stack
    .map((s) => {
      const w = Math.round(s.length * 8.0 + 18);
      const el =
        `<g><rect x="${cx}" y="${chipY}" width="${w}" height="${CHIP_H}" rx="6" class="chip ${cls}"/>` +
        `<text x="${cx + w / 2}" y="${chipY + 15}" text-anchor="middle" class="chip-label ${cls}">${escapeXML(s)}</text></g>`;
      cx += w + 8;
      return el;
    })
    .join("\n    ");

  return `  <!-- ${p.name} -->
  <g>
    <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="14" class="card"/>
    <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="14" fill="url(#${gid})" class="wash"/>
    <path d="M${x + 1.5} ${y + 14} v${CARD_H - 28}" class="spine ${cls}" stroke-width="${SPINE_W}" stroke-linecap="round"/>
    ${title}
    ${rule}
    ${badge}
    ${desc}
    ${chips}
  </g>`;
});

// Per-card accent CSS (dark + light) and an accent-variable per index so glyphs
// (lock/star) can reference currentColor-like vars.
const accentVarsDark = projects.map((p, i) => `--a${i}: ${p.accent};`).join(" ");
const accentVarsLight = projects.map((p, i) => `--a${i}: ${p.light};`).join(" ");
const accentRules = projects
  .map((p, i) => {
    return (
      `.c${i}.title { fill: ${p.accent}; } .c${i}.rule { fill: ${p.accent}; } ` +
      `.c${i}.spine { stroke: ${p.accent}; } .c${i}.badge { fill: ${p.accent}; } ` +
      `.c${i}.chip { stroke: ${p.accent}; } .c${i}.chip-label { fill: ${p.accent}; } ` +
      `.c${i}.glyph-fill { fill: ${p.accent}; } .c${i}.glyph-stroke { stroke: ${p.accent}; }`
    );
  })
  .join("\n    ");
const accentRulesLight = projects
  .map((p, i) => {
    return (
      `.c${i}.title { fill: ${p.light}; } .c${i}.rule { fill: ${p.light}; } ` +
      `.c${i}.spine { stroke: ${p.light}; } .c${i}.badge { fill: ${p.light}; } ` +
      `.c${i}.chip { stroke: ${p.light}; } .c${i}.chip-label { fill: ${p.light}; } ` +
      `.c${i}.glyph-fill { fill: ${p.light}; } .c${i}.glyph-stroke { stroke: ${p.light}; }`
    );
  })
  .join("\n      ");

// ---------------------------------------------------------------------------
// Assemble.
// ---------------------------------------------------------------------------
const aria =
  "Selected work: eight project cards. engram (private): Engram Neural Modeling Labs, the neural-modeling hub, Python. NCP (1 star): safety-gated provenance-first wire protocol, Rust. prisoma (private): a prism for embodied agents, robotics and world models: Vision-Language-Action analysis via several native methods including PID, Rust and Python. crebain (8 stars): tactical visualization and autonomy prototype, TypeScript, Rust, Nix. melkor (1 star): Gaussian-splatting and depth-analysis pipelines for 3D reconstruction, Python, C++, CUDA. cortexel: agent-consumable scientific-visualization library for neural simulations: VizSpec to spike rasters and STDP curves with fail-closed provenance, TypeScript, React, Three.js. pid-rs (1 star): Partial Information Decomposition estimators in Rust. cobot-atlas (2 stars): 3D mesh-generation pipeline, Python.";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    <filter id="cardGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3.5" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    ${gradDefs.join("\n    ")}
  </defs>
  <style>
    :root { ${accentVarsDark} }
    .cap        { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #6e7681; letter-spacing: 2px; }
    .panel      { fill: #ffffff; fill-opacity: 0.022; stroke: #ffffff; stroke-opacity: 0.07; }
    .card       { fill: #0d1117; fill-opacity: 0.55; stroke: #ffffff; stroke-opacity: 0.09; stroke-width: 1; }
    .title      { font: 700 17px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .desc       { font: 400 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #9da7b3; }
    .badge      { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .chip       { fill: #0d1117; fill-opacity: 0.6; stroke-width: 1.3; }
    .chip-label { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
    ${accentRules}
    text { paint-order: stroke; stroke: #0d1117; stroke-width: 2.6; stroke-linejoin: round; }
    @media (prefers-color-scheme: light) {
      text { stroke: #ffffff; }
      :root { ${accentVarsLight} }
      .cap { fill: #57606a; }
      .panel { fill: #0b1f2a; fill-opacity: 0.025; stroke: #0b1f2a; stroke-opacity: 0.08; }
      .card { fill: #ffffff; fill-opacity: 0.9; stroke: #0b1f2a; stroke-opacity: 0.1; }
      /* The accent wash is a dark-mode bloom; on white it only muddies the card,
         so hide it entirely in light mode (the accent spine + title carry the
         colour there). */
      .wash { display: none; }
      .desc { fill: #57606a; }
      .chip { fill: #ffffff; fill-opacity: 0.7; }
      ${accentRulesLight}
    }
  </style>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" class="panel"/>
  <text x="${M + 14}" y="${CAP_Y}" class="cap">SELECTED&#160;WORK&#160;//&#160;EIGHT&#160;PROJECTS</text>

${cardEls.join("\n")}
</svg>
`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, svg, "utf8");
console.log(`[work-cards] wrote ${OUT_PATH} (${svg.length} bytes)`);
