// scripts/data.mjs
// Single source of truth for the profile's canonical lists. Each list lives here
// once; the generators render it AND scripts/section-titles.mjs derives the
// per-section "# N …" banner counts from these lengths, so adding/removing a
// project, repo, agent, stack or channel updates the count automatically (no second
// place to edit). Pure data: zero deps, no side effects (safe to import
// anywhere). CHANNELS is a plain count because the Elsewhere icons are hand-
// authored clickable markdown, not generated from here.

// Selected-work project cards (work-cards.mjs). `stars`/`repo` drive the badge +
// the live star refresh; `private` shows a lock instead.
export const PROJECTS = [
  {
    name: "engram",
    accent: "#22d3ee", light: "#0891b2", grad: "#0b2b33",
    private: true,
    desc: "Engram Neural Modeling Labs, the hub: neural-network and neural-modeling experiments that drive the rest of the stack.",
    stack: ["Python"],
  },
  {
    name: "NCP",
    accent: "#fbbf24", light: "#b45309", grad: "#332408",
    stars: 2, repo: "sepahead/NCP",
    desc: "Safety-gated, provenance-first wire protocol (Rust SDK) letting a simulation perceive and act through robots and clients. Pre-1.0.",
    stack: ["Rust"],
  },
  {
    name: "prisoma",
    accent: "#a78bfa", light: "#7c3aed", grad: "#241a44",
    private: true,
    desc: "A prism for embodied agents, robotics and world models: Vision-Language-Action analysis via several native methods, PID among them.",
    stack: ["Rust", "Python"],
  },
  {
    name: "crebain",
    accent: "#9caf88", light: "#4b5320", grad: "#1f2913",
    stars: 9, repo: "sepahead/crebain",
    desc: "Adaptive Response & Awareness System: sensor fusion, ML detection, drone physics, ROS / Gazebo. The flagship robotics client.",
    stack: ["TS", "Rust", "Nix"],
  },
  {
    name: "melkor",
    accent: "#fb923c", light: "#c2410c", grad: "#2a1608",
    stars: 1, repo: "sepahead/melkor",
    desc: "Gaussian-splatting & depth-analysis pipelines for 3D reconstruction: multi-view capture to dense geometry, CUDA-accelerated.",
    stack: ["Python", "C++", "CUDA"],
  },
  {
    name: "cortexel",
    accent: "#e879f9", light: "#c026d3", grad: "#2a0a2e",
    stars: 0, repo: "sepahead/cortexel",
    desc: "Agent-consumable scientific-visualization library for neural simulations: VizSpec to spike rasters & STDP curves, provenance fail-closed.",
    stack: ["TS", "React", "Three"],
  },
  {
    name: "pid-rs",
    accent: "#34d399", light: "#059669", grad: "#06281d",
    stars: 1, repo: "sepahead/pid-rs",
    desc: "Partial Information Decomposition with continuous mutual-information (KSG / I_sx) estimators, in safe Rust. The analysis client.",
    stack: ["Rust"],
  },
  {
    name: "cobot-atlas",
    accent: "#60a5fa", light: "#2563eb", grad: "#0b1f3a",
    stars: 2, repo: "sepahead/cobot-atlas",
    desc: "3D mesh-generation pipeline: 2,023 meshes for robot simulation; dataset published on Hugging Face. Feeds simulation from pid-rs analysis.",
    stack: ["Python"],
  },
];

// "More repositories" public repos (repo-tree.mjs --sort activity order); the
// number of REPOS is the sub-header banner's "# N repos". `area` is the short
// note, `full` the long aria copy. `metric`/`count`/`repo` drive the live star/
// fork badge (refreshed on the 4h cron; `count` is the no-token fallback).
export const REPOS = [
  { name: "brojapid-activationfunctions", area: "PID analysis of activation functions",      full: "PID analysis of activation functions",                  repo: "sepahead/brojapid-activationfunctions", metric: "stars", count: 4 },
  { name: "mahmoudian-2020-rescience",    area: "ReScience C: info-theoretic transfer fn",  full: "ReScience C info-theoretic transfer-function analysis", repo: "sepahead/mahmoudian-2020-rescience",    metric: "forks", count: 3 },
  { name: "nest-simulator",               area: "NEST simulator fork: orig. contributions", full: "NEST simulator fork with original contributions" },
  { name: "relief-atlas",                 area: "10K+ AI-gen 3D mesh assets for relief",       full: "10K+ AI-generated 3D mesh assets for disaster relief" },
  { name: "manwe",                        area: "real-time UAV detection in Rust",             full: "real-time UAV detection from vision, in Rust" },
  { name: "silmaril-vision-studio",       area: "computer-vision studio & testbed",            full: "computer-vision studio and testbed" },
];

// Agentic-stack roster (agents.mjs).
export const AGENTS = [
  { name: "Ghostty", role: "terminal",     note: "GPU-native" },
  { name: "herdr",   role: "multiplexer",  note: "agent herd · terminal" },
  { name: "Devin",   role: "autonomous",   note: "long-horizon · self-directed" },
  { name: "OMP",     role: "orchestrator", note: "oh my opencode" },
  { name: "Pi",      role: "lead",         note: "mono · the agent", lead: true },
];

// Toolbox category rails (toolbox-rails.mjs). `count` is the icon count for that
// row (kept in sync with the README icon row); the number of RAILS is the
// toolbox banner's "# N stacks".
export const RAILS = [
  { slug: "aiml",     label: "AI / ML",            count: 8, begin: "0s" },
  { slug: "backend",  label: "BACKEND &amp; SYSTEMS", count: 8, begin: "0.3s" },
  { slug: "cloud",    label: "CLOUD &amp; DEVOPS",     count: 8, begin: "0.6s" },
  { slug: "frontend", label: "FRONTEND &amp; WEB",     count: 7, begin: "0.9s" },
];

// Elsewhere social channels (LinkedIn, Scholar, Substack, Hugging Face, X); the
// icons are hand-authored clickable markdown, so this is the count they drive.
export const CHANNELS = 5;
