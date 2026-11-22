/**
 * Символы неоновых плиток — перенос рисунков аватарок ботов Neo³
 * (`bots-control/avatars/src/make_avatars.py`, сетка 1000×1000) на сетку
 * 100×100 плюс символы для проектов. Каждый символ двухцветный: слой `white`
 * красится в белый, `accent` — в цвет проекта, `top` — белые детали поверх
 * акцента; `cut` — прорези (окна машины, вырезы купона), сквозь них видна
 * плитка. Все формы рисуются `currentColor`; цвет задаёт NeonTile.
 * Толщина линии — 3 единицы, как 30 из 1000 у ботов.
 */
import React, { type ReactNode } from 'react';

import { Box, Dot, Fill, Line, Oval, Ring, SW, Solid } from './neonShapes';

export type NeonGlyphArt = {
  /** Main shapes, painted white. */
  white: ReactNode;
  /** Accent shapes, painted in the project colour, above `white`. */
  accent: ReactNode;
  /** White details above the accent layer. */
  top?: ReactNode;
  /** Holes through the whole symbol (shapes are used as a mask). */
  cut?: ReactNode;
};

const round = (value: number) => Math.round(value * 100) / 100;
const point = (cx: number, cy: number, r: number, degrees: number) => {
  const angle = (degrees * Math.PI) / 180;
  return `${round(cx + r * Math.cos(angle))} ${round(cy + r * Math.sin(angle))}`;
};

/** Star polygon: `count` tips, alternating outer/inner radius. */
function starPath(cx: number, cy: number, outer: number, inner: number, count = 5): string {
  const points: string[] = [];
  for (let index = 0; index < count * 2; index += 1) {
    points.push(point(cx, cy, index % 2 === 0 ? outer : inner, -90 + (180 / count) * index));
  }
  return `M${points.join('L')}Z`;
}

/** Four-point sparkle with curved sides. */
function sparklePath(cx: number, cy: number, size: number): string {
  const s = size;
  const k = size * 0.12;
  return `M${cx} ${cy - s}Q${cx + k} ${cy - k} ${cx + s} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + s}`
    + `Q${cx - k} ${cy + k} ${cx - s} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - s}Z`;
}

/** Gear outline: `teeth` flat-topped teeth between radius `inner` and `outer`. */
function gearPath(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const step = 360 / teeth;
  const parts: string[] = [];
  for (let index = 0; index < teeth; index += 1) {
    const start = -90 + step * index;
    parts.push(point(cx, cy, inner, start - step * 0.27));
    parts.push(point(cx, cy, outer, start - step * 0.17));
    parts.push(point(cx, cy, outer, start + step * 0.17));
    parts.push(point(cx, cy, inner, start + step * 0.27));
  }
  return `M${parts.join('L')}Z`;
}

/** Crescent: circle (c1, R) minus circle (c2, r); c2 lies up-right of c1. */
function crescentPath(c1x: number, c1y: number, R: number, c2x: number, c2y: number, r: number): string {
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d);
  const h = Math.sqrt(R * R - a * a);
  const mx = c1x + (a * dx) / d;
  const my = c1y + (a * dy) / d;
  const p1 = `${round(mx + (h * dy) / d)} ${round(my - (h * dx) / d)}`;
  const p2 = `${round(mx - (h * dy) / d)} ${round(my + (h * dx) / d)}`;
  return `M${p1}A${R} ${R} 0 1 0 ${p2}A${r} ${r} 0 0 1 ${p1}Z`;
}

/** Short radial strokes around a circle (tyre tread). */
function treadPath(cx: number, cy: number, from: number, to: number, count: number): string {
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const degrees = (360 / count) * index + 15;
    parts.push(`M${point(cx, cy, from, degrees)}L${point(cx, cy, to, degrees)}`);
  }
  return parts.join('');
}

const DOC_OUTLINE = 'M36 23H56L68 35V73A4 4 0 0 1 64 77H36A4 4 0 0 1 32 73V27A4 4 0 0 1 36 23Z M56 23V35H68';
const BUBBLE_TAIL = 'M36 60L32 73L47 61Z';

const GLYPH_ART = {
  // ---- символы аватарок ботов (make_avatars.py) ----
  laptop: {
    white: (<><Box x={29} y={30} w={42} h={27} r={3} line={SW} /><Box x={22} y={59.5} w={56} h={4.5} r={2.2} /></>),
    accent: (<><Line d="M50 37.5V46.5" w={3.4} /><Dot x={50} y={51.5} r={2.1} /></>),
  },
  server: {
    white: (
      <>
        <Box x={29} y={27} w={42} h={10.5} r={2.6} line={2.6} />
        <Box x={29} y={40} w={42} h={10.5} r={2.6} line={2.6} />
        <Box x={29} y={53} w={42} h={10.5} r={2.6} line={2.6} />
        <Dot x={35} y={45.25} r={1.8} />
        <Line d="M44 32.25H65M44 45.25H65M44 58.25H65" w={1.4} o={0.55} />
        <Line d="M50 66.5V72M40 72H60" w={2.6} />
      </>
    ),
    accent: (<><Dot x={35} y={32.25} r={1.8} /><Dot x={35} y={58.25} r={1.8} /></>),
  },
  windows: {
    white: (
      <>
        <Box x={51} y={29} w={20} h={20} r={1.6} />
        <Box x={29} y={51} w={20} h={20} r={1.6} />
        <Box x={51} y={51} w={20} h={20} r={1.6} />
      </>
    ),
    accent: <Box x={29} y={29} w={20} h={20} r={1.6} />,
  },
  envelope: {
    white: <Box x={26} y={33} w={48} h={34} r={4.4} line={SW} />,
    accent: <Line d="M29.5 37.5L50 54.5L70.5 37.5" />,
  },
  star: {
    white: null,
    accent: <Fill d={starPath(50, 52, 25, 11)} />,
    top: <Line d={starPath(50, 52, 25, 11)} w={2.2} />,
  },
  cashback: {
    white: <Ring x={50} y={50} r={15} />,
    accent: (
      <>
        <Line d="M44.5 56L55.5 44" w={2.8} />
        <Dot x={44.6} y={44.8} r={2.6} />
        <Dot x={55.4} y={55.2} r={2.6} />
        <Line d="M69.15 66.07A25 25 0 1 1 62.5 28.35" />
        <Solid d="M67.26 31.1L65 24.02L60 32.68Z" w={1} />
      </>
    ),
  },
  coupon: {
    white: <Box x={25} y={34} w={50} h={32} r={3.6} />,
    accent: <Line d="M39 50.5L46.5 58L61 42" w={4.4} />,
    cut: (<><Dot x={25} y={50} r={4.6} /><Dot x={75} y={50} r={4.6} /></>),
  },
  clapper: {
    white: (<><Box x={27} y={44} w={46} h={26} r={3} line={SW} /><Box x={26} y={33} w={48} h={9} r={2.4} /></>),
    accent: (
      <>
        <Solid d="M41 51.5L41 62.5L50.5 57Z" />
        <Fill d="M34 33.5H40L36 41.5H30Z M46 33.5H52L48 41.5H42Z M58 33.5H64L60 41.5H54Z" />
      </>
    ),
  },
  robot: {
    white: (
      <>
        <Box x={30} y={39} w={40} h={29} r={7} line={SW} />
        <Line d="M50 39V32.5M43 61H57" w={2.6} />
        <Box x={25} y={48} w={3.5} h={11} r={1.4} />
        <Box x={71.5} y={48} w={3.5} h={11} r={1.4} />
      </>
    ),
    accent: (<><Dot x={50} y={29.5} r={2.8} /><Dot x={41.5} y={52} r={3.6} /><Dot x={58.5} y={52} r={3.6} /></>),
  },
  mic: {
    white: (<><Box x={42.5} y={25} w={15} h={28} r={7.5} line={SW} /><Line d="M50 62V74M41 74H59" /></>),
    accent: <Line d="M65 47A15 15 0 0 1 35 47" />,
  },
  headphones: {
    white: <Line d="M28.5 52A21.5 21.5 0 0 1 71.5 52" w={3.2} />,
    accent: (<><Box x={27} y={51} w={9.5} h={19} r={4} /><Box x={63.5} y={51} w={9.5} h={19} r={4} /></>),
  },
  car: {
    white: (
      <>
        <Fill d="M30 48L38.5 36H60L69 48Z" />
        <Box x={23} y={47} w={54} h={15} r={5.5} />
        <Dot x={37} y={63} r={6.2} />
        <Dot x={64} y={63} r={6.2} />
      </>
    ),
    accent: (<><Dot x={73} y={53.5} r={1.8} /><Dot x={37} y={63} r={2.4} /><Dot x={64} y={63} r={2.4} /></>),
    cut: (
      <>
        <Fill d="M34.5 47.5L40.5 39.5H48V47.5Z M52 39.5H59.5L64.5 47.5H52Z" />
        <Ring x={37} y={63} r={7} w={1.6} />
        <Ring x={64} y={63} r={7} w={1.6} />
      </>
    ),
  },
  parcel: {
    white: (<><Fill d="M28 39L50 50V74L28 63Z" o={0.92} /><Fill d="M72 39L50 50V74L72 63Z" o={0.6} /></>),
    accent: <Fill d="M50 28L72 39L50 50L28 39Z" />,
    top: <Line d="M39 33.5L61 44.5" w={2.2} />,
  },
  sliders: {
    white: <Line d="M28 34H72M28 50H72M28 66H72" w={1.8} o={0.6} />,
    accent: (<><Dot x={40} y={34} r={4.8} /><Dot x={59} y={50} r={4.8} /><Dot x={46} y={66} r={4.8} /></>),
    top: (<><Ring x={40} y={34} r={4.8} w={1.8} /><Ring x={59} y={50} r={4.8} w={1.8} /><Ring x={46} y={66} r={4.8} w={1.8} /></>),
  },
  bitcoin: {
    white: <Ring x={50} y={50} r={22.5} />,
    accent: (
      <>
        <Line d="M42.5 37V63M42.5 37H51.5A6 6 0 0 1 51.5 49H42.5M42.5 49H53A7 7 0 0 1 53 63H42.5" w={3.2} />
        <Line d="M46 32.5V37M52 32.5V37M46 63V67.5M52 63V67.5" w={2.4} />
      </>
    ),
  },
  shield: {
    white: <Line d="M50 26L71.5 34L70.5 54L50 75L29.5 54L28.5 34Z" />,
    accent: (<><Box x={42.5} y={49} w={15} h={12} r={2.4} /><Line d="M45.2 49.5A4.8 4.8 0 0 1 54.8 49.5" w={2.4} /></>),
  },
  speech: {
    white: (<><Box x={26} y={30} w={48} h={32} r={9} line={SW} /><Fill d={BUBBLE_TAIL} /></>),
    accent: <Line d="M38 44V48M44 40.5V51.5M50 38V54M56 41.5V50.5M62 43.5V48.5" />,
  },
  tag: {
    white: <Solid d="M28 33H59L73 50L59 67H28Z" w={3} />,
    accent: (<><Line d="M51 56.5L60 43.5" w={2.6} /><Dot x={51.6} y={45} r={2.4} /><Dot x={59.4} y={55} r={2.4} /></>),
    cut: <Dot x={37} y={50} r={4.4} />,
  },
  plane: {
    white: <Solid d="M27 51L74 29L57 73L49 58Z" w={1.2} />,
    accent: <Fill d="M49 58L74 29L54.5 52Z" />,
    top: <Fill d="M49 58L57 73L53 60Z" o={0.65} />,
  },
  rss: {
    white: <Line d="M36.5 49A16 16 0 0 1 52.5 65M36.5 35A30 30 0 0 1 66.5 65" w={4.6} />,
    accent: <Dot x={36.5} y={65} r={5} />,
  },
  camera: {
    white: (<><Box x={28.5} y={28.5} w={43} h={43} r={13} line={3.2} /><Dot x={63.5} y={36.5} r={2.4} /></>),
    accent: <Ring x={50} y={50} r={10.5} w={3.2} />,
  },
  bars: {
    white: (
      <>
        <Box x={30} y={55} w={8} h={15} r={2} />
        <Box x={41} y={45} w={8} h={25} r={2} />
        <Box x={52} y={50} w={8} h={20} r={2} />
      </>
    ),
    accent: <Box x={63} y={36} w={8} h={34} r={2} />,
  },

  // ---- символы проектов ----
  tire: {
    white: <Ring x={50} y={50} r={19.5} w={8} />,
    accent: (<><Ring x={50} y={50} r={9} /><Dot x={50} y={50} r={3} /></>),
    cut: <Line d={treadPath(50, 50, 20.5, 25, 12)} w={2.2} />,
  },
  wallet: {
    white: (<><Box x={25} y={37} w={50} h={33} r={5} line={SW} /><Line d="M31 37L56 28.5L60 37" /></>),
    accent: (<><Box x={58} y={46} w={17} h={14} r={4} line={SW} /><Dot x={64.5} y={53} r={2.2} /></>),
  },
  scale: {
    white: (
      <>
        <Line d="M50 30V71M39 71H61M29 36H71" />
        <Line d="M30 36L23 52M30 36L37 52M70 36L63 52M70 36L77 52" w={1.8} o={0.8} />
      </>
    ),
    accent: (<><Fill d="M22 52H38A8 8 0 0 1 22 52Z M62 52H78A8 8 0 0 1 62 52Z" /><Dot x={50} y={28} r={3} /></>),
  },
  leaf: {
    white: <Line d="M30 70C30 44 46 30 71 29C72 54 56 70 30 70Z" />,
    accent: <Line d="M31 69L58 42M44 56L44.5 47M49 51L58 51" w={2.6} />,
  },
  music: {
    white: <Line d="M42 66V32L68 27V60" w={3.2} />,
    accent: (<><Dot x={36.5} y={66} r={6} /><Dot x={62.5} y={60} r={6} /></>),
  },
  moon: {
    white: <Fill d={crescentPath(47, 53, 22, 58, 44, 18)} />,
    accent: (<><Fill d={sparklePath(66, 34, 7.5)} /><Dot x={72} y={52} r={2} /></>),
  },
  code: {
    white: <Line d="M38 37L26 50L38 63M62 37L74 50L62 63" w={3.4} />,
    accent: <Line d="M55 32L45 68" w={3.4} />,
  },
  globe: {
    white: <Ring x={50} y={50} r={22} />,
    accent: (<><Line d="M28 50H72" w={2.6} /><Oval x={50} y={50} rx={10} ry={22} w={2.6} /></>),
  },
  flask: {
    white: <Line d="M43 27H57M45.5 27V42L30.5 66.5Q28 72 34 72H66Q72 72 69.5 66.5L54.5 42V27" />,
    accent: (
      <>
        <Fill d="M36 60H64L67 65.5Q68.5 68.5 65 68.5H35Q31.5 68.5 33 65.5Z" />
        <Dot x={47} y={52} r={2} />
        <Dot x={53} y={47} r={1.5} />
      </>
    ),
  },
  building: {
    white: <Line d="M26 40L50 27L74 40ZM25 72H75" />,
    accent: <Line d="M33 46V66M44.5 46V66M55.5 46V66M67 46V66" w={3.6} />,
  },
  coins: {
    white: <Ring x={42} y={43} r={14.5} />,
    accent: <Dot x={58.5} y={57} r={15} />,
    top: <Ring x={58.5} y={57} r={9.5} w={2.4} />,
  },
  play: {
    white: <Ring x={50} y={50} r={22} />,
    accent: <Solid d="M44 38.5L62 50L44 61.5Z" w={3} />,
  },
  user: {
    white: <Line d="M31 71C31 59 40 53 50 53C60 53 69 59 69 71" />,
    accent: <Dot x={50} y={40} r={8.5} />,
  },
  users: {
    white: (<><Ring x={61} y={39} r={7} /><Line d="M53 54.5C55.5 53.5 58.5 53 61 53C69 53 74 58 74 66" /></>),
    accent: (<><Dot x={42} y={42} r={8} /><Solid d="M26 71C26 61 33 55 42 55C51 55 58 61 58 71Z" /></>),
  },
  sparkles: {
    white: (<><Fill d={sparklePath(67, 32, 8)} /><Dot x={31} y={32} r={2.4} /></>),
    accent: <Fill d={sparklePath(46, 54, 20)} />,
  },
  image: {
    white: (<><Box x={25} y={29} w={50} h={42} r={5} line={SW} /><Dot x={60} y={40} r={4} /></>),
    accent: <Solid d="M31 65L44 49.5L53.5 59.5L59.5 53L69 65Z" w={2} />,
  },
  map: {
    white: (<><Dot x={50} y={44} r={17} /><Solid d="M35.5 52H64.5L50 75Z" w={2} /></>),
    accent: <Dot x={50} y={44} r={5.4} />,
    cut: <Ring x={50} y={44} r={7.4} w={2.8} />,
  },
  droplets: {
    white: <Line d="M50 25C50 25 32 46 32 58A18 18 0 0 0 68 58C68 46 50 25 50 25Z" />,
    accent: <Line d="M41 59A9 9 0 0 0 49 67" />,
  },
  gem: {
    white: <Line d="M35 33H65L76 46L50 74L24 46Z" />,
    accent: <Line d="M24 46H76M43 33L38 46L50 74L62 46L57 33" w={2.4} />,
  },
  gauge: {
    white: (<><Line d="M28 64A23 23 0 1 1 72 64" /><Line d="M35 44L38.5 46.5M50 37V41M65 44L61.5 46.5" w={2.4} o={0.7} /></>),
    accent: (<><Line d="M50 57L61 43" w={3.4} /><Dot x={50} y={57} r={4} /></>),
  },
  message: {
    white: (<><Box x={26} y={30} w={48} h={32} r={9} line={SW} /><Fill d={BUBBLE_TAIL} /></>),
    accent: (<><Dot x={39} y={46} r={3.3} /><Dot x={50} y={46} r={3.3} /><Dot x={61} y={46} r={3.3} /></>),
  },
  calendar: {
    white: (
      <>
        <Box x={26} y={31} w={48} h={41} r={5} line={SW} />
        <Line d="M26 43H74" />
        <Line d="M38 26V35M62 26V35" w={3.4} />
        <Dot x={36} y={53} r={1.9} o={0.75} />
        <Dot x={45} y={53} r={1.9} o={0.75} />
        <Dot x={36} y={62} r={1.9} o={0.75} />
        <Dot x={45} y={62} r={1.9} o={0.75} />
      </>
    ),
    accent: <Box x={54} y={52} w={11} h={11} r={2.5} />,
  },
  tasks: {
    white: (
      <>
        <Box x={29} y={30} w={42} h={44} r={5} line={SW} />
        <Box x={41.5} y={25.5} w={17} h={9} r={3} />
        <Line d="M54 48H63M54 62H63" />
      </>
    ),
    accent: <Line d="M36.5 47.5L40.5 51.5L47 44.5M36.5 61.5L40.5 65.5L47 58.5" />,
  },
  settings: {
    white: <Line d={gearPath(50, 50, 23, 17.5, 8)} />,
    accent: <Ring x={50} y={50} r={7} />,
  },
  folder: {
    white: <Line d="M25 35A4 4 0 0 1 29 31H42L47.5 37H71A4 4 0 0 1 75 41V66A4 4 0 0 1 71 70H29A4 4 0 0 1 25 66Z" />,
    accent: <Line d="M25 45H75" />,
  },
  neo3: {
    white: <Line d="M30 69V33L56 69V33" w={5.4} />,
    accent: <Line d="M61.5 26H71L66 32A5 5 0 1 1 61.7 39.5" w={3} />,
  },
  mountain: {
    white: <Line d="M23 70L42 38L52 54L60 45L77 70Z" />,
    accent: <Dot x={67} y={32} r={5} />,
  },
  bag: {
    white: <Line d="M29.5 41H70.5L67.5 73H32.5Z" />,
    accent: <Line d="M41 47V37A9 9 0 0 1 59 37V47" />,
  },
  share: {
    white: <Line d="M37 50L63 36M37 50L63 64" />,
    accent: (<><Dot x={35} y={50} r={6.5} /><Dot x={65} y={34.5} r={6.5} /><Dot x={65} y={65.5} r={6.5} /></>),
  },
  ban: {
    white: <Ring x={50} y={50} r={21} w={3.4} />,
    accent: <Line d="M35.2 35.2L64.8 64.8" w={3.4} />,
  },
  wrench: {
    white: <Dot x={62} y={38} r={11} />,
    accent: <Line d="M32 68L54 46" w={7} />,
    cut: <Fill d="M60.2 34.8L69.4 25.6L74.4 30.6L65.2 39.8Z" />,
  },
  workflow: {
    white: (
      <>
        <Ring x={29} y={50} r={5.5} />
        <Ring x={71} y={35} r={5.5} />
        <Ring x={71} y={65} r={5.5} />
        <Line d="M34.5 50H44M56 50C62 50 60 35 65.5 35M56 50C62 50 60 65 65.5 65" />
      </>
    ),
    accent: <Dot x={50} y={50} r={6.5} />,
  },
  book: {
    white: <Line d="M50 35C44 30 35 29 25 31V68C35 66 44 67 50 72C56 67 65 66 75 68V31C65 29 56 30 50 35Z" />,
    accent: <Line d="M50 35V72M56 42.5C59 41 63 40.5 68 41M56 51.5C59 50 63 49.5 68 50" w={2.6} />,
  },
  chart: {
    white: <Line d="M27 27V73H73" />,
    accent: <Line d="M34 62L45 50L54 57L69 39M60.5 39H69V47.5" w={3.4} />,
  },
  candles: {
    white: (
      <>
        <Line d="M34 33V67M66 40V74" w={2.2} />
        <Box x={29.5} y={40} w={9} h={18} r={2} />
        <Box x={61.5} y={46} w={9} h={20} r={2} />
      </>
    ),
    accent: (<><Line d="M50 26V60" w={2.2} /><Box x={45.5} y={32} w={9} h={20} r={2} /></>),
  },
  phone: {
    white: (<><Box x={34.5} y={23} w={31} h={54} r={7} line={SW} /><Line d="M45 70H55" w={2.4} o={0.75} /></>),
    accent: <Box x={44.5} y={28.5} w={11} h={4} r={2} />,
  },
  document: {
    white: <Line d={DOC_OUTLINE} />,
    accent: <Line d="M39 47H61M39 55H61M39 63H53" />,
  },
  contract: {
    white: (<><Line d={DOC_OUTLINE} /><Line d="M39 41H58M39 49H52" o={0.8} /></>),
    accent: <Line d="M38 64C41 57 44 57 45 62C46 66 49 60 51 58C52 63 55 64 61 62" w={2.6} />,
  },
  chair: {
    white: (
      <>
        <Line d="M34 50V39A9 9 0 0 1 43 30H57A9 9 0 0 1 66 39V50" />
        <Line d="M27 47V62H73V47M32 62V71M68 62V71" />
      </>
    ),
    accent: (<><Box x={31} y={49} w={38} h={8.5} r={4.25} /><Line d="M41 37H59M41 43H59" w={2.4} /></>),
  },
  flame: {
    white: <Line d="M50 24C55 34 70 41 70 58A20 20 0 0 1 30 58C30 49 35 43 40 37C41.5 44 45 47 48.5 47C49 39 46 31 50 24Z" />,
    accent: <Fill d="M50 53C54 57 58 60 58 65A8 8 0 0 1 42 65C42 60 46 57 50 53Z" />,
  },
  fish: {
    white: <Line d="M24 50C33 37 55 35 66 50C55 65 33 63 24 50ZM66 50L77 40V60Z" />,
    accent: (
      <>
        <Dot x={34} y={47.5} r={2.6} />
        <Dot x={46} y={44.5} r={1.8} />
        <Dot x={54} y={51.5} r={1.8} />
        <Dot x={45} y={54} r={1.8} />
        <Dot x={57} y={45} r={1.8} />
      </>
    ),
  },
  tree: {
    white: (<><Line d="M50 23L62 39H56L67 53H59L71 68H29L41 53H33L44 39H38Z" /><Line d="M50 68V76" w={4} /></>),
    accent: (
      <>
        <Dot x={47} y={46} r={2.3} />
        <Dot x={54} y={56} r={2.3} />
        <Dot x={42} y={62} r={2.3} />
        <Dot x={60} y={63} r={2.3} />
      </>
    ),
  },
  flower: {
    white: (<><Dot x={50} y={42} r={4.5} /><Line d="M50 52V75M50 67C45 61 39 61 36 63C39 68 45 69 50 67" /></>),
    accent: (
      <>
        <Dot x={50} y={32.5} r={6.5} />
        <Dot x={59.04} y={39.06} r={6.5} />
        <Dot x={55.58} y={49.69} r={6.5} />
        <Dot x={44.42} y={49.69} r={6.5} />
        <Dot x={40.96} y={39.06} r={6.5} />
      </>
    ),
    top: <Dot x={50} y={42} r={4.5} />,
  },
  moto: {
    white: (<><Ring x={31} y={62} r={9} /><Ring x={69} y={62} r={9} /><Line d="M31 62L42 46H55L69 62M55 46L52 37H59" /></>),
    accent: (<><Solid d="M40 45L44 39.5H56L57.5 45Z" /><Dot x={31} y={62} r={2.6} /><Dot x={69} y={62} r={2.6} /></>),
  },
  shirt: {
    white: <Line d="M39 28L28 33L21 45L30 50L34 46V73H66V46L70 50L79 45L72 33L61 28" />,
    accent: (<><Line d="M39 28C41 34 59 34 61 28" /><Dot x={58} y={44} r={2.6} /></>),
  },
  idcard: {
    white: (<><Box x={24} y={32} w={52} h={36} r={5} line={SW} /><Line d="M52 45H66M52 52H66M52 59H61" o={0.85} /></>),
    accent: (<><Dot x={38} y={46} r={5} /><Fill d="M29.5 61.5A8.5 7 0 0 1 46.5 61.5Z" /></>),
  },
  card: {
    white: (<><Box x={24} y={32} w={52} h={36} r={5} line={SW} /><Line d="M24 42.5H76" w={4.5} /><Line d="M51 59H67" /></>),
    accent: <Box x={31} y={51} w={11} h={8.5} r={2} />,
  },
  search: {
    white: <Ring x={45} y={45} r={15} w={3.4} />,
    accent: <Line d="M56 56L71 71" w={6} />,
  },
  home: {
    white: <Line d="M27 48L50 29L73 48M33 43.5V72H67V43.5" />,
    accent: <Box x={45} y={56} w={10} h={16} r={2} />,
  },
  pot: {
    white: <Line d="M29 46H71V61A11 11 0 0 1 60 72H40A11 11 0 0 1 29 61ZM22 50H29M71 50H78M32 41H68" />,
    accent: <Line d="M42 34C40 30.5 44 28.5 42 25M50 34C48 30.5 52 28.5 50 25M58 34C56 30.5 60 28.5 58 25" w={2.6} />,
  },
  bull: {
    white: (
      <>
        <Line d="M37 41Q36 63 50 72Q64 63 63 41Q50 35 37 41Z" />
        <Line d="M37.5 42C28 41 23 34 26 26M62.5 42C72 41 77 34 74 26" w={3.2} />
      </>
    ),
    accent: (<><Dot x={44} y={51} r={2.4} /><Dot x={56} y={51} r={2.4} /><Ring x={50} y={64} r={4.5} w={2.6} /></>),
  },
  rocket: {
    white: (
      <>
        <Line d="M50 23C60 31 63.5 44 61 60H39C36.5 44 40 31 50 23Z" />
        <Line d="M39 51L31 61V68L39.5 62M61 51L69 61V68L60.5 62" />
      </>
    ),
    accent: (<><Dot x={50} y={42} r={4.5} /><Solid d="M44.5 64.5L50 77L55.5 64.5Z" /></>),
  },
  target: {
    white: (<><Ring x={50} y={50} r={21} /><Ring x={50} y={50} r={12} /><Line d="M50 22V31M50 69V78M22 50H31M69 50H78" /></>),
    accent: <Dot x={50} y={50} r={4.5} />,
  },
  megaphone: {
    white: <Line d="M26 44H34L59 31V69L34 56H26A3 3 0 0 1 23 53V47A3 3 0 0 1 26 44ZM34 56L38 69" />,
    accent: <Line d="M66 42A10 10 0 0 1 66 58M70.5 36A18 18 0 0 1 70.5 64" />,
  },
  briefcase: {
    white: (<><Box x={24} y={36} w={52} h={34} r={5} line={SW} /><Line d="M41 36V31A3 3 0 0 1 44 28H56A3 3 0 0 1 59 31V36" /></>),
    accent: (<><Line d="M24 51H76" /><Box x={45.5} y={46.5} w={9} h={9} r={2} /></>),
  },
  pen: {
    white: <Line d="M31 69L34 58L59 33A4.2 4.2 0 0 1 65 33L67 35A4.2 4.2 0 0 1 67 41L42 66ZM54 38L62 46" />,
    accent: <Line d="M46 73H70" />,
  },
  eye: {
    white: <Line d="M23 50Q50 25 77 50Q50 75 23 50Z" />,
    accent: <Dot x={50} y={50} r={8.5} />,
    top: <Dot x={53} y={47} r={2.6} />,
  },
  bolt: {
    white: <Ring x={50} y={50} r={23} />,
    accent: <Solid d="M55 26L36.5 53H49L45 74L63.5 46H51Z" w={2} />,
  },
  bulb: {
    white: <Line d="M41 60C35 55 32 50 32 44A18 18 0 0 1 68 44C68 50 65 55 59 60V64H41ZM42 70H58M45 75H55" />,
    accent: <Line d="M44 49L50 55L56 49M50 55V63" w={2.6} />,
  },
  crown: {
    white: <Line d="M28 66L25 37L39 49L50 29L61 49L75 37L72 66Z" />,
    accent: (<><Line d="M30 73H70" w={3.6} /><Dot x={50} y={56} r={3.4} /></>),
  },
  ball: {
    white: (
      <>
        <Ring x={50} y={50} r={22} />
        <Line d="M50 41.5V28M58.08 47.37L70.92 43.2M55 56.88L62.93 67.8M45 56.88L37.07 67.8M41.92 47.37L29.08 43.2" w={2.6} />
      </>
    ),
    accent: <Solid d="M50 41.5L58.08 47.37L55 56.88L45 56.88L41.92 47.37Z" w={2} />,
  },
  bridge: {
    white: <Line d="M22 61H78M30 61V71M70 61V71M24 61Q50 25 76 61" />,
    accent: <Line d="M37 47.5V61M50 43V61M63 47.5V61" w={2.6} />,
  },
  chip: {
    white: (
      <>
        <Box x={33} y={33} w={34} h={34} r={5} line={SW} />
        <Line
          d="M42 26V33M50 26V33M58 26V33M42 67V74M50 67V74M58 67V74M26 42H33M26 50H33M26 58H33M67 42H74M67 50H74M67 58H74"
          w={2.6}
        />
      </>
    ),
    accent: <Box x={42.5} y={42.5} w={15} h={15} r={2.5} />,
  },
  database: {
    white: (<><Oval x={50} y={31} rx={20} ry={7} w={SW} /><Line d="M30 31V69A20 7 0 0 0 70 69V31" /></>),
    accent: <Line d="M30 50A20 7 0 0 0 70 50" />,
  },
  trophy: {
    white: <Line d="M36 27H64V40A14 14 0 0 1 36 40ZM50 54V64M44 64H56M40 71H60" />,
    accent: <Line d="M36 31H30V37A6 6 0 0 0 36 43M64 31H70V37A6 6 0 0 1 64 43" />,
  },
  comet: {
    white: <Line d="M24 71L48 50M31 55L46 45M39 76L53 59" />,
    accent: <Dot x={60} y={40} r={10} />,
  },
  goldbar: {
    white: (<><Solid d="M24 72L28 59H46L48.5 72Z" /><Solid d="M51.5 72L54 59H72L76 72Z" /></>),
    accent: <Solid d="M36.5 55L40 42.5H60L63.5 55Z" />,
  },
  heart: {
    white: <Line d="M50 70C27 55 24 41 31 34C37 28 46 30 50 37C54 30 63 28 69 34C76 41 73 55 50 70Z" />,
    accent: <Line d="M31 49H40L44 42L49 56L53 47H69" w={2.6} />,
  },
  passport: {
    white: (<><Box x={31} y={24} w={38} h={52} r={4} line={SW} /><Line d="M41 65H59" /></>),
    accent: (
      <>
        <Ring x={50} y={44} r={9.5} w={2.6} />
        <Line d="M40.5 44H59.5" w={2.2} />
        <Oval x={50} y={44} rx={4.5} ry={9.5} w={2.2} />
      </>
    ),
  },
  exchange: {
    white: <Line d="M28 40H70M61 31L70 40L61 49" w={3.4} />,
    accent: <Line d="M72 60H30M39 51L30 60L39 69" w={3.4} />,
  },
  cart: {
    white: <Line d="M23 29H31L37.5 59H67L72.5 37H33.5" />,
    accent: (<><Dot x={42} y={68} r={3.8} /><Dot x={63} y={68} r={3.8} /></>),
  },
  browser: {
    white: (
      <>
        <Box x={24} y={28} w={52} h={44} r={5} line={SW} />
        <Line d="M24 39H76" />
        <Line d="M55 48H69M55 55H69M55 62H64" w={2.6} o={0.8} />
      </>
    ),
    accent: (
      <>
        <Dot x={31} y={33.5} r={1.8} />
        <Dot x={37} y={33.5} r={1.8} />
        <Dot x={43} y={33.5} r={1.8} />
        <Box x={31} y={46} w={18} h={18} r={2.5} />
      </>
    ),
  },
  switcher: {
    white: <Box x={35} y={27} w={38} h={30} r={5} line={SW} />,
    accent: <Box x={27} y={42} w={38} h={30} r={5} />,
    top: <Line d="M37 57H55" w={2.6} o={0.9} />,
  },
  palette: {
    white: <Line d="M50 26A24 24 0 1 0 50 74C55 74 57 70.5 54.5 66.5C52 62.5 54.5 58 59 58H66A8 8 0 0 0 74 50C74 36.5 63 26 50 26Z" />,
    accent: (
      <>
        <Dot x={38} y={43} r={3.4} />
        <Dot x={49} y={35} r={3.4} />
        <Dot x={61} y={39} r={3.4} />
        <Dot x={36} y={56} r={3.4} />
      </>
    ),
  },
  magnet: {
    white: <Line d="M35 34V50A15 15 0 0 0 65 50V34" w={7} cap="butt" />,
    accent: (<><Box x={31.5} y={25} w={7} h={9} r={1.5} /><Box x={61.5} y={25} w={7} h={9} r={1.5} /></>),
  },
  doll: {
    white: (
      <Line d="M50 24A11 11 0 0 1 61 35C61 38.5 59.5 40.5 58.5 42.5C65.5 47 68 55 68 62C68 70.5 60 76 50 76C40 76 32 70.5 32 62C32 55 34.5 47 41.5 42.5C40.5 40.5 39 38.5 39 35A11 11 0 0 1 50 24Z" />
    ),
    accent: (<><Dot x={50} y={35.5} r={5.5} /><Ring x={50} y={61} r={6} w={2.6} /><Dot x={50} y={61} r={2} /></>),
  },
  balloon: {
    white: (<><Oval x={42} y={45} rx={12} ry={15} w={SW} /><Line d="M42 60C38 66 47 70 43 77" w={2.4} /></>),
    accent: (<><Oval x={60} y={39} rx={11.5} ry={14} /><Line d="M60 53C57 58 63 62 59 68" w={2.4} /></>),
  },
  calculator: {
    white: (
      <>
        <Box x={31} y={23} w={38} h={54} r={6} line={SW} />
        <Dot x={40} y={50} r={2.6} />
        <Dot x={50} y={50} r={2.6} />
        <Dot x={60} y={50} r={2.6} />
        <Dot x={40} y={59} r={2.6} />
        <Dot x={50} y={59} r={2.6} />
        <Dot x={60} y={59} r={2.6} />
        <Dot x={40} y={68} r={2.6} />
        <Dot x={50} y={68} r={2.6} />
        <Dot x={60} y={68} r={2.6} />
      </>
    ),
    accent: <Box x={37} y={29.5} w={26} h={11} r={2.5} />,
  },

  // ---- служебные плитки «Домой» ----
  grid: {
    white: (
      <>
        <Box x={29} y={29} w={17} h={17} r={4.5} line={SW} />
        <Box x={54} y={29} w={17} h={17} r={4.5} line={SW} />
        <Box x={29} y={54} w={17} h={17} r={4.5} line={SW} />
      </>
    ),
    accent: <Box x={54} y={54} w={17} h={17} r={4.5} />,
  },
  collapse: {
    white: <Line d="M33 57L50 40L67 57" w={4} />,
    accent: <Line d="M38 68H62" />,
  },
} satisfies Record<string, NeonGlyphArt>;

export type NeonGlyph = keyof typeof GLYPH_ART;

export const NEON_GLYPHS: Record<NeonGlyph, NeonGlyphArt> = GLYPH_ART;
