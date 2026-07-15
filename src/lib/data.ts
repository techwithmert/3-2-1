import { normalize } from './normalize'

export interface Club {
  qid: string
  label: string
  country: string | null
  count: number
  /** senior club, when this is a reserve/youth side (e.g. Castilla -> Real Madrid) */
  parent: string | null
  key: string // precomputed normalized label for search
}

export interface ClubIndex {
  clubs: Club[]
  generated: string
  byQid: Map<string, Club>
  /** senior club qid -> its reserve/youth sides */
  reserves: Map<string, Club[]>
}

export interface PlayerStint {
  qid: string
  name: string
  start: number | null
  end: number | null
  birth: number | null
  loan: boolean
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

type ClubIndexFile = {
  v: number
  generated: string
  clubs: [string, string, string | null, number, string | null][]
}
type ClubFile = {
  v: number
  id: string
  p: [string, string, number | null, number | null, number | null, number][]
}

export async function loadClubIndex(): Promise<ClubIndex> {
  const res = await fetch(`${BASE}/clubs.json`)
  if (!res.ok) throw new Error(`clubs.json: HTTP ${res.status}`)
  const json = (await res.json()) as ClubIndexFile
  const clubs = json.clubs.map(([qid, label, country, count, parent]) => ({
    qid,
    label,
    country,
    count,
    parent,
    key: normalize(label),
  }))
  const byQid = new Map(clubs.map((c) => [c.qid, c]))
  const reserves = new Map<string, Club[]>()
  for (const club of clubs) {
    if (!club.parent) continue
    const siblings = reserves.get(club.parent)
    if (siblings) siblings.push(club)
    else reserves.set(club.parent, [club])
  }
  return { clubs, generated: json.generated, byQid, reserves }
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
        json.p.map(([pid, name, start, end, birth, loan]) => ({
          qid: pid,
          name,
          start,
          end,
          birth,
          loan: loan === 1,
        }))
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

export interface FamilyMatch {
  /** the clubs that actually matched, e.g. Real Madrid Castilla x Barcelona */
  clubA: Club
  clubB: Club
  players: CommonPlayer[]
}

/**
 * Reserve sides count as their own club, so "Real Madrid x Barcelona" ignores a
 * player who only ever turned out for Castilla. That's the rule — but when a
 * pair has no senior match at all, it's worth telling the room a near-miss
 * exists so they can call it. Only invoked on an empty result, so the normal
 * path still costs exactly two fetches.
 */
export async function findFamilyMatches(
  index: ClubIndex,
  clubA: Club,
  clubB: Club
): Promise<FamilyMatch[]> {
  const familyOf = (club: Club) => [club, ...(index.reserves.get(club.qid) ?? [])]
  const pairs = familyOf(clubA).flatMap((a) =>
    familyOf(clubB).map((b) => ({ a, b }))
  )
  const matches = await Promise.all(
    pairs
      .filter(({ a, b }) => !(a.qid === clubA.qid && b.qid === clubB.qid)) // already checked
      .map(async ({ a, b }) => {
        try {
          const [pa, pb] = await Promise.all([loadClubPlayers(a.qid), loadClubPlayers(b.qid)])
          const players = intersect(pa, pb)
          return players.length > 0 ? { clubA: a, clubB: b, players } : null
        } catch {
          return null // a missing sibling file shouldn't break the hint
        }
      })
  )
  return matches.filter((m): m is FamilyMatch => m !== null)
}
