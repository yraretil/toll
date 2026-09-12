// TOLL banner in full-block glyphs only (U+2588 + space). Deliberately no
// box-drawing corners: partial font coverage turned the O's top into a U.
// Constraint: every row must fit the centered fixed-width box in tui.tsx —
// keep rows at most BANNER_WIDTH wide or centering shifts rows apart.
export const BANNER_WIDTH = 35;

export const BANNER = [
  "█████████  █████████  ███    ███",
  "   ███     ██     ██  ███    ███",
  "   ███     ██     ██  ███    ███",
  "   ███     ██     ██  ███    ███",
  "   ███     █████████  ██████ ██████",
];
