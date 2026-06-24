// scripts/tokens.mjs
// Shared design tokens + tiny SVG helpers for the "session" assets
// (section-titles.mjs, connect.mjs). ADDITIVE: imported only by those two new
// generators, the existing daily-chart generators are intentionally untouched.
// Mirrors values already used across hero.svg / work-cards.svg / work-graph.svg
// so every bespoke asset reads as one system. Zero dependencies.

// [dark, light]
export const PALETTE = {
  ink: ["#c9d1d9", "#1f2328"],
  muted: ["#6e7681", "#57606a"],
  rule: ["#30363d", "#d0d7de"],
  flow: ["#e2faff", "#22d3ee"],
  accents: {
    pulse: ["#22d3ee", "#0891b2"],
    work: ["#a78bfa", "#7c3aed"],
    toolbox: ["#fbbf24", "#b45309"],
    agentic: ["#34d399", "#059669"],
    elsewhere: ["#f472b6", "#db2777"],
  },
  panel: {
    dark: { fill: "#ffffff", fillOpacity: 0.022, stroke: "#ffffff", strokeOpacity: 0.07 },
    light: { fill: "#0b1f2a", fillOpacity: 0.025, stroke: "#0b1f2a", strokeOpacity: 0.08 },
  },
};

export const MONO =
  "ui-monospace, SFMono-Regular, Menlo, monospace";

const XML = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
export const escapeXML = (s) => String(s).replace(/[&<>"']/g, (c) => XML[c]);

// Approx rendered width of monospace text: ~0.6em advance per glyph + tracking.
export const charLen = (str, fontpx, track = 0) =>
  Math.round(str.length * 0.6 * fontpx + Math.max(0, str.length - 1) * track);

// A re-parametrised 3-stop sweep gradient (the hero's #sweep, but per-asset so
// the coordinates fit each banner instead of the hero's hardcoded ~500px span).
// The bright band slides left→right (or reversed) along the rule.
export function sweepDefs(id, { x1from, x1to, x2from, x2to, color, dur = "3.2s" }) {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1from}" y1="0" x2="${x2from}" y2="0">
      <stop offset="0" stop-color="${color}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${color}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      <animate attributeName="x1" from="${x1from}" to="${x1to}" dur="${dur}" repeatCount="indefinite"/>
      <animate attributeName="x2" from="${x2from}" to="${x2to}" dur="${dur}" repeatCount="indefinite"/>
    </linearGradient>`;
}

// The verbatim hero/work-cards block-cursor blink (1s, hard on/off).
export const CURBLINK_KEYFRAMES =
  "@keyframes curblink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }";
