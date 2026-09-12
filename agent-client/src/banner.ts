// TOLL banner in CP437 box-drawing glyphs. The letters need their corners;
// centering is handled by the fixed-width box in tui.tsx (rows need not be
// equal, but every row must fit BANNER_WIDTH — enforced below).
export const BANNER_WIDTH = 35;

export const BANNER = [
  "████████╗  ██╔═══██╗  ██╗    ██╗",
  "╚══██╔══╝  ██║   ██║  ██║    ██║",
  "   ██║     ██║   ██║  ██║    ██║",
  "   ██║     ██║   ██║  ██║    ██║",
  "   ██║     ╚██████╔╝  ██████╗█████╗",
];
