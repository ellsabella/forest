// JS twin of the Solidity SVG builder (PLAN §4): one <path> per colour, each horizontal
// run a 1-high sub-path. Used by dev.html for the side-by-side check and, later, as the
// expected value in the Foundry parity test.

import { G } from './params.js';

// palette: ['#RRGGBB' × 9] for slots 1..9
export function gridToSvg(grid, palette) {
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" shape-rendering="crispEdges">`
          + `<rect width="${G}" height="${G}" fill="#000"/>`;
  for (let c = 1; c <= 9; c++) {                       // 9 passes, one output buffer — mirrors the Solidity plan
    const ch = 48 + c;
    let d = '';
    for (let y = 0; y < G; y++) {
      let x = 0;
      while (x < G) {
        if (grid.charCodeAt(y * G + x) !== ch) { x++; continue; }
        let run = 1;
        while (x + run < G && grid.charCodeAt(y * G + x + run) === ch) run++;
        d += `M${x} ${y}h${run}v1h-${run}z`;
        x += run;
      }
    }
    if (d) out += `<path fill="${palette[c - 1]}" d="${d}"/>`;
  }
  return out + '</svg>';
}
