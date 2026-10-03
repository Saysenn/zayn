import { KPI_ART_INK } from '../../configs/dashboardTheme';

// ***************************************************
// * The texture behind a KPI card
// ***************************************************
//
// DRAWN, NOT LOADED. Four PNGs would be four requests, four files to keep
// in step with the palette, and four things that go soft on a retina
// screen. These are vectors: they scale, they read the tone's own ink, and
// they cost nothing over the wire.
//
// Each says what its card counts, so the card is findable before it is
// read: a rising line for deals, a skyline for companies, a group for
// people, moving water for money.

const VIEWBOX = '0 0 240 150';

// ===============================
// * OPACITY IS PER DRAWING, BECAUSE COVERAGE IS
// ===============================
// One number could not serve both. A wash across the whole card, at the
// strength a skyline needs in the right hand third, is a coloured card
// rather than a texture. The floor matters as much as the ceiling: a half
// opacity fill inside a 0.16 group works out at 0.08 against white, which
// is where the people and the waves went when this was a single value.
// Each drawing's own figure is on its ART entry below, and the band both
// ends have to stay inside is pinned in dashboardDesign.test.js.

// ===============================
// * SMOOTH, AND EDGE TO EDGE
// ===============================
// It was a jagged polyline cropped by `slice`, so it started with a hard
// vertical cut a third of the way across the card. `S` keeps every join
// continuous, and the card stretches it the full width.
const TREND = 'M0 126 C18 122 30 110 50 112 S80 96 98 90 S130 82 148 68 S180 54 198 40 S224 24 240 14';

function Trend() {
  return (
    <>
      <path d={`${TREND} L240 150 L0 150 Z`} fill="currentColor" opacity="0.5" />
      <path d={TREND} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </>
  );
}

// A skyline. The window grid is what makes them read as buildings rather
// than as a bar chart, which is the thing this card must not look like.
function Buildings() {
  const towers = [
    { x: 96, y: 66, w: 40, h: 84 },
    { x: 142, y: 34, w: 46, h: 116 },
    { x: 194, y: 58, w: 40, h: 92 },
  ];
  return (
    <>
      {towers.map((tower) => (
        <g key={tower.x}>
          <rect x={tower.x} y={tower.y} width={tower.w} height={tower.h} rx="5" fill="currentColor" opacity="0.7" />
          {Array.from({ length: Math.floor((tower.h - 18) / 20) }, (_, row) => (
            [0, 1].map((column) => (
              <rect
                key={`${row}-${column}`}
                x={tower.x + 9 + column * (tower.w / 2)}
                y={tower.y + 12 + row * 20}
                width="8"
                height="8"
                rx="2"
                fill="currentColor"
              />
            ))
          ))}
        </g>
      ))}
    </>
  );
}

// Three figures, the middle one forward. Heads and shoulders only: at this
// size and opacity anything more turns into a smudge.
//
// The shoulders were an arc with a sweep that curved DOWNWARD from the
// baseline, so all three were drawn off the bottom of the card. A cubic
// bump cannot get its direction wrong.
function People() {
  const figures = [
    { x: 108, y: 90, r: 17 },
    { x: 156, y: 74, r: 22 },
    { x: 206, y: 90, r: 17 },
  ];
  return (
    <g fill="currentColor" opacity="0.75">
      {figures.map(({ x, y, r }) => (
        <g key={x}>
          <circle cx={x} cy={y} r={r} />
          <path d={`M${x - r * 1.7} 150 C${x - r * 1.7} ${150 - r * 2.1} ${x + r * 1.7} ${150 - r * 2.1} ${x + r * 1.7} 150 Z`} />
        </g>
      ))}
    </g>
  );
}

// Two bands of moving water. Money in this CRM arrives in a flow rather
// than in steps, and a wave says that without claiming a shape.
function Waves() {
  return (
    <>
      <path d="M0 74 C40 46 78 100 120 72 C162 44 200 96 240 66 L240 150 L0 150 Z" fill="currentColor" opacity="0.5" />
      <path d="M0 106 C44 82 78 128 122 104 C164 82 200 124 240 98 L240 150 L0 150 Z" fill="currentColor" opacity="0.75" />
    </>
  );
}

// `none` stretches a drawing edge to edge; `meet` keeps a skyline and a
// crowd in proportion, which they need and a wave does not.
//
// ===============================
// * `meet`, NEVER `slice`, ON A BOX WHOSE SHAPE THE CARD DECIDES
// ===============================
// The cornered two were `slice` in a `h-full` box, so the drawing was
// scaled to COVER whatever shape the card happened to be and the overflow
// was cut off. A KPI card is stretched to the tallest in its row, and at two
// columns the People card sits beside the money card, which is three lines
// tall in the raw view. The box went from 1.85 wide to 0.77, the height
// drove the scale, and the crowd was blown up and sliced down its left edge:
// a hard vertical cut with half a head on the wrong side of it.
//
// `meet` fits the whole drawing inside the box instead, so nothing is ever
// cut at any card height. It is smaller on a short card, which is the right
// way round for texture.
//
// `w-full` IS NOT REDUNDANT WITH `inset-x-0`. An <svg> is a replaced
// element: given a definite height and an automatic width it takes its
// width from the viewBox's own ratio and ignores left/right entirely. At
// 120px tall that came out 192px wide on a 320px card, which is the hard
// vertical edge two thirds across cards one and four.
//
// The wide two are the faintest. They cover the whole card, so the same
// opacity that reads as texture in a corner reads as a coloured card here.
const ART = {
  green: { Drawing: Trend, box: 'inset-x-0 bottom-0 h-4/5 w-full', fit: 'none', opacity: 0.13 },
  amber: { Drawing: Buildings, box: 'bottom-0 right-0 h-full w-3/5', fit: 'xMaxYMax meet', opacity: 0.2 },
  blue: { Drawing: People, box: 'bottom-0 right-0 h-full w-3/5', fit: 'xMaxYMax meet', opacity: 0.16 },
  violet: { Drawing: Waves, box: 'inset-x-0 bottom-0 h-3/5 w-full', fit: 'none', opacity: 0.12 },
};

export default function KpiArt({ tone }) {
  const art = ART[tone];
  if (!art) return null;
  const { Drawing } = art;
  return (
    <svg
      viewBox={VIEWBOX}
      preserveAspectRatio={art.fit}
      aria-hidden="true"
      // Behind the content and never clickable, so it can neither take a
      // click nor sit on top of the figure.
      className={`pointer-events-none absolute ${art.box}`}
      style={{ color: KPI_ART_INK[tone], opacity: art.opacity }}
    >
      <Drawing />
    </svg>
  );
}
