#!/usr/bin/env node
// scripts/socials.mjs
// Generates one self-contained SVG per social channel: assets/social-<slug>.svg.
// The row sits at the very top of the profile (just under the hero, above The
// pulse). Each badge is its own image so the README can wrap it in a clickable
// link to that profile — links inside an <img>-embedded SVG are NOT clickable on
// GitHub, but a wrapping <a> around the image is.
//
// Design: the same terminal/card language as the rest of the profile — a rounded
// pill (the .panel grammar), a per-platform accent that themes the icon seat,
// the authentic monochrome brand glyph and the hover glow, and the platform name
// in neutral ink (never the accent, so it passes contrast on both grounds). A
// faint accent wash blooms from the seat in dark mode. Hover lifts + glows the
// pill (progressive enhancement; GitHub sandboxes internal :hover). Theme-adaptive
// (prefers-color-scheme), reduced-motion safe, zero deps. Run: `node scripts/socials.mjs`.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE, MONO, escapeXML, charLen } from "./tokens.mjs";
import { SOCIALS } from "./data.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(__dirname, "..", "assets");

// Pill geometry. A 1px transparent margin each side (PAD) gives adjacent badges
// breathing room in the README row without relying on markdown spacing alone.
const H = 48;
const PAD = 1;
const SEAT = 34;      // icon seat (rounded square)
const SEAT_RX = 10;
const SEAT_X = PAD + 11;
const SEAT_Y = (H - SEAT) / 2; // 7
const GLYPH = 20;     // brand glyph is a 24×24 path, scaled to fit the seat
const NAME_PX = 14;
const NAME_TRACK = 0.5;
const NAME_X = SEAT_X + SEAT + 12; // 58
const NAME_Y = 30;
const PAD_R = 18;     // padding after the name
const RX = 14;        // pill corner radius (matches the work cards)

const [inkD, inkL] = PALETTE.ink;
const panelD = PALETTE.panel.dark;
const panelL = PALETTE.panel.light;

function render(s) {
  const [aD, aL] = s.accent;
  // Icon-only pills (channels without a clean username) are a compact square with
  // the seat centred; the rest size to fit the username label after the seat.
  const label = s.label || s.name;
  const W = s.iconOnly
    ? SEAT_X + SEAT + (SEAT_X - PAD) + PAD // symmetric side padding → square-ish
    : NAME_X + charLen(label, NAME_PX, NAME_TRACK) + PAD_R + PAD;

  const scale = (GLYPH / 24).toFixed(4);
  const gx = SEAT_X + (SEAT - GLYPH) / 2;
  const gy = SEAT_Y + (SEAT - GLYPH) / 2;

  const rectX = PAD + 0.5;
  const rectW = W - 2 * PAD - 1;
  const rectH = H - 1;

  const aria = `${s.name} — ${s.handle}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXML(aria)}">
  <title>${escapeXML(aria)}</title>
  <defs>
    <radialGradient id="wash" cx="0%" cy="50%" r="120%">
      <stop offset="0" stop-color="${aD}" stop-opacity="0.18"/>
      <stop offset="62%" stop-color="${aD}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <style>
    :root { --accent: ${aD}; color-scheme: light dark; }
    .pill  { fill: ${panelD.fill}; fill-opacity: ${panelD.fillOpacity}; stroke: ${panelD.stroke}; stroke-opacity: ${panelD.strokeOpacity}; stroke-width: 1; }
    .seat  { fill: ${aD}; fill-opacity: 0.14; stroke: ${aD}; stroke-opacity: 0.85; stroke-width: 1.4; }
    .glyph { fill: ${aD}; }
    .name  { font: 700 ${NAME_PX}px ${MONO}; fill: ${inkD}; letter-spacing: ${NAME_TRACK}px; }
    text { paint-order: stroke; stroke: #0d1117; stroke-width: 2.6; stroke-linejoin: round; }
    @media (prefers-color-scheme: light) {
      text { stroke: #ffffff; }
      :root { --accent: ${aL}; }
      .pill  { fill: ${panelL.fill}; fill-opacity: ${panelL.fillOpacity}; stroke: ${panelL.stroke}; stroke-opacity: ${panelL.strokeOpacity}; }
      .wash  { display: none; }
      .seat  { fill: ${aL}; fill-opacity: 0.10; stroke: ${aL}; }
      .glyph { fill: ${aL}; }
      .name  { fill: ${inkL}; }
    }
    /* Hover / click affordance — progressive enhancement (GitHub img sandboxes
       the internal :hover of an img-embedded SVG, so this shows when the badge is
       viewed directly or inline). Gated to hover-capable devices so a tap on
       touch doesn't leave a sticky lifted/glowing state. */
    @media (hover: hover) {
      .badge-group {
        cursor: pointer;
        transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.22s ease;
      }
      .badge-group:hover { transform: translateY(-3px); filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45)); }
      .badge-group:hover .pill { stroke-opacity: 0.3; }
      .badge-group:hover .seat { fill-opacity: 0.26; filter: drop-shadow(0 0 5px var(--accent)); }
      .badge-group:hover .glyph { filter: drop-shadow(0 0 4px var(--accent)); }
      .badge-group:active {
        transform: translateY(-1px);
        filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.3));
        transition: transform 0.08s ease, filter 0.08s ease;
      }
      @media (prefers-reduced-motion: reduce) {
        .badge-group, .badge-group:hover, .badge-group:active { transition: none; transform: none; }
      }
    }
  </style>
  <g class="badge-group">
    <rect x="${rectX}" y="0.5" width="${rectW}" height="${rectH}" rx="${RX}" class="pill"/>
    <rect x="${rectX}" y="0.5" width="${rectW}" height="${rectH}" rx="${RX}" fill="url(#wash)" class="wash"/>
    <rect x="${SEAT_X}" y="${SEAT_Y}" width="${SEAT}" height="${SEAT}" rx="${SEAT_RX}" class="seat"/>
    <g transform="translate(${gx} ${gy}) scale(${scale})" class="glyph"><path fill-rule="evenodd" d="${s.glyph}"/></g>${
      s.iconOnly ? "" : `
    <text x="${NAME_X}" y="${NAME_Y}" class="name">${escapeXML(label)}</text>`}
  </g>
</svg>
`;
}

mkdirSync(ASSETS, { recursive: true });
for (const s of SOCIALS) {
  const out = resolve(ASSETS, `social-${s.slug}.svg`);
  const svg = render(s);
  writeFileSync(out, svg, "utf8");
  console.log(`[socials] wrote ${out} (${svg.length} bytes)`);
}
