#!/usr/bin/env node
// scripts/work-cards.mjs
// Generates one self-contained SVG per project card: assets/work-card-<slug>.svg.
// Each card is its own image so the README can wrap it in a clickable link to
// the project's repo page — links inside an <img>-embedded SVG are NOT clickable
// on GitHub, but a markdown image link [![alt](card.svg)](url) is. The visual
// language is unchanged from the previous single-panel work-cards.svg: rounded
// card, per-project accent spine + wash, status badge (stars / lock), one-liner
// and stack chips, ui-monospace. Theme-adaptive (prefers-color-scheme),
// reduced-motion safe, zero deps.
//
// Live star counts: with a token (GitHub Actions provides GITHUB_TOKEN) each
// public repo's stargazerCount is refreshed; the baked-in `stars` in data.mjs
// is the no-token fallback. Private repos (engram, prisoma) keep their lock
// badge. Run by the work-cards.yml cron; a local run without a token uses the
// fallback. Run: `node scripts/work-cards.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROJECTS } from "./data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, "..", "assets");

const projects = PROJECTS;
// each public repo's current stargazerCount so the badges auto-update; the
// `stars` in data.mjs is the no-token fallback. Private repos (engram, prisoma)
// have no `repo` and keep their lock badge. Run by the work-cards.yml cron; a
// local run without a token just uses the fallback.
// ---------------------------------------------------------------------------
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
// Card geometry. CARD_W/CARD_H match the original grid cells exactly. PAD_X
// adds 1px transparent padding on each side so a README <table cellspacing="20">
// yields a 22px gutter (1 + 20 + 1) — the same as the original grid's GUTTER —
// while the vertical row gap stays 20px (cellspacing).
// ---------------------------------------------------------------------------
const CARD_W = 393;
const CARD_H = 150;
const PAD_X = 1;
const SVG_W = CARD_W + 2 * PAD_X; // 395
const SVG_H = CARD_H;             // 150

// Card interior metrics (unchanged from the original combined panel).
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
// sits at (x, y); `scale` shrinks it. Colour comes from the `.c0.glyph-stroke`
// / `.c0.glyph-fill` CSS rules (theme-adaptive, no CSS-variable dependency on a
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
// Build one card's inner SVG elements at local origin (PAD_X, 0).
// Returns { gradDef, body }.
// ---------------------------------------------------------------------------
function buildCard(p) {
  const x = PAD_X;
  const y = 0;
  const cls = "c0"; // single card per SVG → always c0

  // Per-card accent wash: a faint radial bloom anchored at the top-left so the
  // card reads as "owned" by its colour without overpowering the text.
  const gid = "wash0";
  const gradDef =
    `<radialGradient id="${gid}" cx="8%" cy="0%" r="120%">` +
      `<stop offset="0%" stop-color="${p.grad}" stop-opacity="0.9"/>` +
      `<stop offset="60%" stop-color="${p.grad}" stop-opacity="0"/></radialGradient>`;

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

  const body = `  <g class="card-group">
    <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="14" class="card"/>
    <rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="14" fill="url(#${gid})" class="wash"/>
    <path d="M${x + 1.5} ${y + 14} v${CARD_H - 28}" class="spine ${cls}" stroke-width="${SPINE_W}" stroke-linecap="round"/>
    ${title}
    ${rule}
    ${badge}
    ${desc}
    ${chips}
  </g>`;

  return { gradDef, body };
}

// ---------------------------------------------------------------------------
// Per-card accent CSS (dark + light). Each SVG has a single card so we always
// use the c0 class and set its colours from this project's accent / light.
// ---------------------------------------------------------------------------
function accentRules(p) {
  const dark = (
    `.c0.title { fill: ${p.accent}; } .c0.rule { fill: ${p.accent}; } ` +
    `.c0.spine { stroke: ${p.accent}; } .c0.badge { fill: ${p.accent}; } ` +
    `.c0.chip { stroke: ${p.accent}; } .c0.chip-label { fill: ${p.accent}; } ` +
    `.c0.glyph-fill { fill: ${p.accent}; } .c0.glyph-stroke { stroke: ${p.accent}; }`
  );
  const light = (
    `.c0.title { fill: ${p.light}; } .c0.rule { fill: ${p.light}; } ` +
    `.c0.spine { stroke: ${p.light}; } .c0.badge { fill: ${p.light}; } ` +
    `.c0.chip { stroke: ${p.light}; } .c0.chip-label { fill: ${p.light}; } ` +
    `.c0.glyph-fill { fill: ${p.light}; } .c0.glyph-stroke { stroke: ${p.light}; }`
  );
  return { dark, light };
}

// ---------------------------------------------------------------------------
// Assemble + write one SVG per project.
// ---------------------------------------------------------------------------
mkdirSync(ASSETS_DIR, { recursive: true });

for (const p of projects) {
  const { gradDef, body } = buildCard(p);
  const { dark, light } = accentRules(p);

  const status = p.private
    ? "private"
    : p.stars != null
      ? `${p.stars} star${p.stars === 1 ? "" : "s"}`
      : "";
  const aria = `${p.name}${status ? ` (${status})` : ""}: ${p.desc}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" width="${SVG_W}" height="${SVG_H}" role="img" aria-label="${escapeXML(aria)}">
  <defs>
    ${gradDef}
  </defs>
  <style>
    :root { --accent: ${p.accent}; }
    .card       { fill: #0d1117; fill-opacity: 0.55; stroke: #ffffff; stroke-opacity: 0.09; stroke-width: 1; }
    .title      { font: 700 17px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .desc       { font: 400 12px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #9da7b3; }
    .badge      { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
    .chip       { fill: #0d1117; fill-opacity: 0.6; stroke-width: 1.3; }
    .chip-label { font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
    ${dark}
    text { paint-order: stroke; stroke: #0d1117; stroke-width: 2.6; stroke-linejoin: round; }
    @media (prefers-color-scheme: light) {
      text { stroke: #ffffff; }
      :root { --accent: ${p.light}; }
      .card { fill: #ffffff; fill-opacity: 0.9; stroke: #0b1f2a; stroke-opacity: 0.1; }
      /* The accent wash is a dark-mode bloom; on white it only muddies the
         card, so hide it entirely in light mode (the accent spine + title
         carry the colour there). */
      .wash { display: none; }
      .desc { fill: #57606a; }
      .chip { fill: #ffffff; fill-opacity: 0.7; }
      ${light}
    }
    /* Hover / click effects — visible when the SVG is viewed directly or
       embedded inline or via object (GitHub img sandboxes internal
       :hover, so these are progressive enhancement for every other context). */
    .card-group {
      cursor: pointer;
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
                  filter 0.25s ease;
    }
    .card-group:hover {
      transform: translateY(-4px);
      filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.45));
    }
    .card-group:hover .card { stroke-opacity: 0.22; }
    .card-group:hover .spine {
      stroke-width: 5;
      filter: drop-shadow(0 0 5px var(--accent));
    }
    .card-group:hover .wash { opacity: 1; }
    .card-group:hover .title { filter: drop-shadow(0 0 4px var(--accent)); }
    .card-group:active {
      transform: translateY(-1px);
      filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.3));
      transition: transform 0.08s ease, filter 0.08s ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .card-group, .card-group:hover, .card-group:active {
        transition: none; transform: none;
      }
    }
  </style>
${body}
</svg>
`;

  const slug = p.name.toLowerCase();
  const outPath = resolve(ASSETS_DIR, `work-card-${slug}.svg`);
  writeFileSync(outPath, svg, "utf8");
  console.log(`[work-cards] wrote ${outPath} (${svg.length} bytes)`);
}
