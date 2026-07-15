// Sprites are written as character maps and rendered as one <rect> per pixel —
// crisp at any scale, no image assets, and editable by hand.

export type Palette = Record<string, string>

interface Props {
  sprite: string[]
  palette: Palette
  className?: string
}

export function PixelSprite({ sprite, palette, className }: Props) {
  const w = Math.max(...sprite.map((row) => row.length))
  const h = sprite.length
  const cells: React.ReactElement[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < sprite[y].length; x++) {
      const fill = palette[sprite[y][x]]
      if (!fill) continue // '.' and unmapped chars are transparent
      cells.push(<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />)
    }
  }
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {cells}
    </svg>
  )
}

// The two hosts, chibi-style: 14x18. They're the pair counting 3-2-1, in the
// black and white Beşiktaş kits from the photo.

// No beards. Tried them three ways at this size — a full block merges with the
// hair into one dark blob, a chin strap reads as a collar, and a jaw block reads
// as a muzzle. 14px of head is simply not enough for facial hair, so the two are
// told apart by build, hair, skin tone and above all the black/white kits.

// The broader one, black kit.
export const PLAYER_HOME = [
  '.....hhhh.....',
  '...hhhhhhhh...',
  '..hhhhhhhhhh..',
  '..hhffffffhh..',
  '..hffffffffh..',
  '..ffeffffeff..',
  '..ffffffffff..',
  '..ffffffffff..',
  '...ffffffff...',
  '.ssssssssssss.',
  'fssssssssssssf',
  'fssssssssssssf',
  '.kkkkkkkkkkkk.',
  '..kk......kk..',
  '..ll......ll..',
  '..bb......bb..',
]

export const HOME_KIT: Palette = {
  h: '#1d150e', // near-black hair
  f: '#eab98d', // skin
  e: '#191008', // eyes
  s: '#16161a', // Beşiktaş black
  k: '#16161a',
  l: '#eab98d',
  b: '#f2f2f2', // white boots, so the legs read against the black
}

// The slimmer one, white kit with black pinstripes.
export const PLAYER_AWAY = [
  '.....hhhh.....',
  '...hhhhhhhh...',
  '..hhhhhhhhhh..',
  '..hhffffffhh..',
  '..hffffffffh..',
  '..ffeffffeff..',
  '..ffffffffff..',
  '..ffffffffff..',
  '...ffffffff...',
  '..swswswswsw..',
  '.fswswswswswf.',
  '.fswswswswswf.',
  '..wwwwwwwwww..',
  '..ww......ww..',
  '..ll......ll..',
  '..bb......bb..',
]

export const AWAY_KIT: Palette = {
  h: '#2b2622',
  f: '#d9a066',
  e: '#191008',
  s: '#16161a', // pinstripe
  w: '#fbfbfb', // white shirt + shorts
  l: '#d9a066',
  b: '#16161a',
}

export const BALL = [
  '..wwww..',
  '.wwwwww.',
  'wwwkkwww',
  'wwkkkkww',
  'wwkkkkww',
  'wwwkkwww',
  '.wwwwww.',
  '..wwww..',
]

export const BALL_KIT: Palette = { w: '#ffffff', k: '#22303a' }

export const SUN = [
  '....yyyy....',
  '..yyyyyyyy..',
  '.yyyyyyyyyy.',
  '.yyyyyyyyyy.',
  'yyyyyyyyyyyy',
  'yyyyyyyyyyyy',
  'yyyyyyyyyyyy',
  'yyyyyyyyyyyy',
  '.yyyyyyyyyy.',
  '.yyyyyyyyyy.',
  '..yyyyyyyy..',
  '....yyyy....',
]

export const SUN_KIT: Palette = { y: '#ffd84d' }

export const CLOUD = [
  '...wwww.....',
  '..wwwwwww...',
  '.wwwwwwwwww.',
  'wwwwwwwwwwww',
  '.wwwwwwwwww.',
]

export const CLOUD_KIT: Palette = { w: '#ffffff' }
