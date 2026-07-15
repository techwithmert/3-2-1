// Stage C: pure local transform. Reads .cache/{clubs,memberships}.ndjson and
// emits the public dataset:
//   public/data/clubs.json    — [qid, label, country, playerCount, parent] rows
//   public/data/c/{qid}.json  — per-club player lists
import fs from 'node:fs'
import path from 'node:path'
import { readNdjson } from './lib/cache.ts'
import type { ClubRow } from './fetch-clubs.ts'
import type { MembershipRow } from './fetch-memberships.ts'

const OUT_DIR = path.join(import.meta.dirname, '..', 'public', 'data')

// "Beşiktaş J.K. (Football)" → "Beşiktaş J.K.", "SS Lazio (multisports club)" →
// "SS Lazio". Drops Wikidata's item-disambiguation suffixes (which only exist to
// separate the football item from its parent club) but keeps meaningful ones
// like "(women)".
function cleanLabel(label: string): string {
  return label.replace(/\s*\(((association )?football|(multi)?sports? club)\)$/i, '')
}

interface PlayerEntry {
  name: string
  start: number | null
  end: number | null
  birth: number | null
  loan: boolean // only stays true if every stint at this club was a loan
}

const MENS_FOOTBALL_TEAM = 'Q103229495' // the marker on a multisport club's football section
const PARENT_CLASSES = ['Q847017', 'Q13580678'] // sports club, multisports club
const RESERVE_CLASSES = [
  'Q2412834', // reserve team
  'Q131453774', // under-19 football team
  'Q131453798', // under-21 football team
  'Q131453766', // under-17 football team
  'Q127433401', // U-19 association football team
  'Q1711289', // youth association football
]
const WOMENS_CLASSES = ['Q28140340', 'Q51481377'] // women's association football team / club

const has = (club: ClubRow, classes: string[]) => club.types.some((t) => classes.includes(t))
const isReserve = (club: ClubRow) => has(club, RESERVE_CLASSES) || /\b(B|II|U\d\d|reserves?|academy)\b/i.test(club.label)
const isWomens = (club: ClubRow) => has(club, WOMENS_CLASSES)

/**
 * Some clubs are split between a multisport parent item and a football-section
 * item (Legia Warsaw: 510 players on one, 90 on the other), which hides half the
 * roster from an intersection. Fold the section into the parent.
 *
 * Deliberately narrow. P361 alone is far too loose — women's teams, B teams and
 * handball/hockey sections all point at the same parent, and fusing those in
 * would be wrong. The genuine "this is the men's senior side of a multisport
 * club" case is the one marked Q103229495, so require that and exclude
 * reserve/women's sides explicitly. Every merge is logged for review.
 */
function buildMergeMap(clubs: Map<string, ClubRow>): Map<string, string> {
  const merge = new Map<string, string>()
  for (const club of clubs.values()) {
    if (!club.parent) continue
    if (!club.types.includes(MENS_FOOTBALL_TEAM)) continue
    if (isReserve(club) || isWomens(club)) continue
    const parent = clubs.get(club.parent)
    if (!parent || !has(parent, PARENT_CLASSES)) continue
    if (isReserve(parent) || isWomens(parent)) continue
    merge.set(club.qid, club.parent)
  }
  return merge
}

function main() {
  const clubRows = readNdjson<ClubRow>('clubs.ndjson')
  const memberships = readNdjson<MembershipRow>('memberships.ndjson')
  if (clubRows.length === 0 || memberships.length === 0) {
    console.error('Missing cache data — run data:clubs and data:players first.')
    process.exit(1)
  }

  const playerLabels = new Map(readNdjson<[string, string]>('player-labels.ndjson'))
  if (playerLabels.size === 0) {
    console.error('Missing player-labels.ndjson — run: npm run data:labels')
    process.exit(1)
  }

  const clubs = new Map<string, ClubRow>()
  for (const row of clubRows) if (!clubs.has(row.qid)) clubs.set(row.qid, row)

  const mergeInto = buildMergeMap(clubs)
  const canonical = (q: string) => mergeInto.get(q) ?? q

  // club -> player -> merged entry (multiple stints collapse to min-start/max-end)
  const perClub = new Map<string, Map<string, PlayerEntry>>()
  for (const m of memberships) {
    const name = playerLabels.get(m.player)
    if (!name) continue // no label in any language we asked for
    const clubQid = canonical(m.club)
    if (!clubs.has(clubQid)) continue
    let players = perClub.get(clubQid)
    if (!players) perClub.set(clubQid, (players = new Map()))
    const existing = players.get(m.player)
    if (!existing) {
      players.set(m.player, {
        name,
        start: m.start,
        end: m.end,
        birth: m.birth,
        loan: m.loan,
      })
    } else {
      if (m.start !== null && (existing.start === null || m.start < existing.start))
        existing.start = m.start
      if (m.end !== null && (existing.end === null || m.end > existing.end)) existing.end = m.end
      if (m.birth !== null && (existing.birth === null || m.birth < existing.birth))
        existing.birth = m.birth
      // a loan-then-permanent spell is not "on loan"
      if (!m.loan) existing.loan = false
    }
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT_DIR, 'c'), { recursive: true })

  const index: [string, string, string | null, number, string | null][] = []
  let totalBytes = 0
  let largest = { qid: '', bytes: 0 }
  const playerIds = new Set<string>()
  let loanStints = 0

  for (const [clubQid, players] of perClub) {
    const club = clubs.get(clubQid)!
    if (players.size === 0) continue
    if (club.label === '' || /^Q\d+$/.test(club.label)) continue // no usable label

    const rows = [...players.entries()]
      .map(([pid, p]) => {
        playerIds.add(pid)
        if (p.loan) loanStints++
        return [pid, p.name, p.start, p.end, p.birth, p.loan ? 1 : 0] as const
      })
      .sort((a, b) => (b[3] ?? 9999) - (a[3] ?? 9999)) // recent players first

    const file = JSON.stringify({ v: 2, id: clubQid, p: rows })
    fs.writeFileSync(path.join(OUT_DIR, 'c', `${clubQid}.json`), file)
    totalBytes += file.length
    if (file.length > largest.bytes) largest = { qid: clubQid, bytes: file.length }

    // only surface a parent link for reserve sides — it drives the "matches via
    // the B team" hint. Merged clubs no longer exist as separate entries.
    const parent = club.parent && isReserve(club) && !isWomens(club) ? canonical(club.parent) : null
    index.push([clubQid, cleanLabel(club.label), club.country, players.size, parent])
  }

  const shipped = new Set(index.map((c) => c[0]))
  for (const row of index) if (row[4] && !shipped.has(row[4])) row[4] = null // parent didn't survive

  index.sort((a, b) => b[3] - a[3])
  const indexJson = JSON.stringify({
    v: 2,
    generated: new Date().toISOString().slice(0, 10),
    clubs: index,
  })
  fs.writeFileSync(path.join(OUT_DIR, 'clubs.json'), indexJson)

  console.log(`clubs.json: ${index.length} clubs, ${(indexJson.length / 1024).toFixed(0)} KB`)
  console.log(`players: ${playerIds.size} distinct`)
  console.log(`loan stints: ${loanStints}`)
  console.log(`reserve sides linked to a parent: ${index.filter((c) => c[4]).length}`)
  console.log(`per-club files: ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`)
  console.log(`largest: ${largest.qid} (${(largest.bytes / 1024).toFixed(0)} KB)`)

  if (mergeInto.size > 0) {
    console.log(`\nmerged ${mergeInto.size} football sections into multisport parents:`)
    for (const [from, to] of mergeInto) {
      console.log(`  ${clubs.get(from)?.label ?? from} (${from}) -> ${clubs.get(to)?.label ?? to} (${to})`)
    }
  }
}

main()
