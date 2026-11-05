// Block-pixel Isopod logo (#25). One letter per pixel, "." is empty. backend/banner.py prints
// the same grid to the terminal. An SVG keeps the blocks seamless whatever font the browser has.
const LOGO = [
   ".bb...........bb.",
   "...bb.......bb...",
   ".....b.bbb.b.....",
   ".....bbbbbbb.....",
   "...rrrrbbbrrrr...",
   "..rrrrrrwrrrrrr..",
   "..ooooowwwooooo..",
   ".oooooowwwoooooo.",
   ".yyyyyywwwyyyyyy.",
   ".yyyyyywwwyyyyyy.",
   "lllllllwwwlllllll",
   "lllllllwwwlllllll",
   "gggggggwwwggggggg",
   "gggggggwwwggggggg",
   ".uuuuuuwwwuuuuuu.",
   ".uuuuuuwwwuuuuuu.",
   ".pppppppwppppppp.",
   "..ppppppwpppppp..",
   "...bbbbbwbbbbb...",
   "...bbbbbbbbbbb...",
   ".....bbbbbbb.....",
   ".......bbb.......",
];

const COLORS: Record<string, string> = {
   b: "#a0785a",
   r: "#e0484e",
   o: "#ff8450",
   y: "#fcd45f",
   l: "#8dc080",
   g: "#2f9e62",
   u: "#5f9bd9",
   p: "#8558b8",
   w: "#f2f2f2",
};

// Pinned above the console log. It isn't a log line, so Copy and Search skip it.
export function ConsoleLogo() {
   return (
      <div data-testid="console-logo" className="flex items-center gap-3 px-4 py-2 bg-[#0D0D0D] border-b border-[#2C2C2C] select-none">
         <IsopodLogo pixelSize={2} />
         <span className="font-mono font-bold text-sm text-white">Isopod</span>
      </div>
   );
}

export function IsopodLogo({ pixelSize = 4 }: { pixelSize?: number }) {
   const width = LOGO[0].length;
   const height = LOGO.length;
   return (
      <svg width={width * pixelSize} height={height * pixelSize} viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" aria-hidden="true">
         {LOGO.flatMap((row, y) =>
            [...row].map((pixel, x) => (pixel === "." ? null : <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={COLORS[pixel]} />))
         )}
      </svg>
   );
}
