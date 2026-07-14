import { normalize } from './normalize'

export interface Club {
  qid: string
  label: string
  country: string | null
  count: number
  key: string // precomputed normalized label for search
}

export interface PlayerStint {
  qid: string
  name: string
  start: number | null
  end: number | null
  birth: number | null
}

export interface CommonPlayer {
  qid: string
  name: string
  birth: number | null
  a: PlayerStint
  b: PlayerStint
  key: string
}

const BASE = `${import.meta.env.BASE_URL}data`

type ClubIndexFile = { v: number; generated: string; clubs: [string, string, string | null, number][] }
type ClubFile = { v: number; id: string; p: [string, string, number | null, number | null, number | null][] }

export async function loadClubIndex(): Promise<{ clubs: Club[]; generated: string }> {
  const res = await fetch(`${BASE}/clubs.json`)
  if (!res.ok) throw new Error(`clubs.json: HTTP ${res.status}`)
  const json = (await res.json()) as ClubIndexFile
  return {
    generated: json.generated,
    clubs: json.clubs.map(([qid, label, country, count]) => ({
      qid,
      label,
      country,
      count,
      key: normalize(label),
    })),
  }
}

// Cache the promise so concurrent requests for the same club dedupe.
const clubCache = new Map<string, Promise<PlayerStint[]>>()

export function loadClubPlayers(qid: string): Promise<PlayerStint[]> {
  let cached = clubCache.get(qid)
  if (!cached) {
    cached = fetch(`${BASE}/c/${qid}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`club ${qid}: HTTP ${res.status}`)
        return res.json() as Promise<ClubFile>
      })
      .then((json) =>
        json.p.map(([pid, name, start, end, birth]) => ({ qid: pid, name, start, end, birth }))
      )
    cached.catch(() => clubCache.delete(qid)) // don't cache failures
    clubCache.set(qid, cached)
  }
  return cached
}

export function intersect(a: PlayerStint[], b: PlayerStint[]): CommonPlayer[] {
  const byId = new Map(a.map((p) => [p.qid, p]))
  const common: CommonPlayer[] = []
  for (const pb of b) {
    const pa = byId.get(pb.qid)
    if (pa) {
      common.push({ qid: pb.qid, name: pa.name, birth: pa.birth ?? pb.birth, a: pa, b: pb, key: normalize(pa.name) })
    }
  }
  // most recent players first — they're the likeliest answers mid-game.
  // end=null with a start means "still there" (very recent); no years at all
  // means "unknown" and goes last.
  const recency = (p: CommonPlayer) =>
    Math.max(
      ...[p.a, p.b].map((s) => s.end ?? (s.start !== null ? 9999 : 0))
    )
  common.sort((x, y) => recency(y) - recency(x))
  return common
}
