// Stage C: pure local transform. Reads .cache/{clubs,memberships}.ndjson and
// emits the public dataset:
//   public/data/clubs.json          — [qid, label, country, playerCount] rows
//   public/data/c/{qid}.json        — per-club player lists
import fs from 'node:fs'
import path from 'node:path'
import { readNdjson } from './lib/cache.ts'
import type { ClubRow } from './fetch-clubs.ts'
import type { MembershipRow } from './fetch-memberships.ts'

const OUT_DIR = path.join(import.meta.dirname, '..', 'public', 'data')

// "Beşiktaş J.K. (Football)" → "Beşiktaş J.K." — drop pure sport-disambiguation
// suffixes, but keep meaningful ones like "(women)".
function cleanLabel(label: string): string {
  return label.replace(/\s*\((association )?football\)$/i, '')
}

interface PlayerEntry {
  name: string
  start: number | null
  end: number | null
  birth: number | null
}

function main() {
  const clubRows = readNdjson<ClubRow>('clubs.ndjson')
  const memberships = readNdjson<MembershipRow>('memberships.ndjson')
  if (clubRows.length === 0 || memberships.length === 0) {
    console.error('Missing cache data — run data:clubs and data:players first.')
    process.exit(1)
  }

  const clubs = new Map<string, ClubRow>()
  for (const row of clubRows) if (!clubs.has(row.qid)) clubs.set(row.qid, row)

  // club -> player -> merged entry (multiple stints collapse to min-start/max-end)
  const perClub = new Map<string, Map<string, PlayerEntry>>()
  for (const m of memberships) {
    if (!clubs.has(m.club)) continue
    if (m.name === '' || /^Q\d+$/.test(m.name)) continue // no usable label
    let players = perClub.get(m.club)
    if (!players) perClub.set(m.club, (players = new Map()))
    const existing = players.get(m.player)
    if (!existing) {
      players.set(m.player, { name: m.name, start: m.start, end: m.end, birth: m.birth })
    } else {
      if (m.start !== null && (existing.start === null || m.start < existing.start))
        existing.start = m.start
      if (m.end !== null && (existing.end === null || m.end > existing.end)) existing.end = m.end
      if (m.birth !== null && (existing.birth === null || m.birth < existing.birth))
        existing.birth = m.birth
    }
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT_DIR, 'c'), { recursive: true })

  const index: [string, string, string | null, number][] = []
  let totalBytes = 0
  let largest = { qid: '', bytes: 0 }
  let playerIds = new Set<string>()

  for (const [clubQid, players] of perClub) {
    const club = clubs.get(clubQid)!
    if (players.size === 0) continue
    if (/^Q\d+$/.test(club.label)) continue // no usable label in any fallback language

    const rows = [...players.entries()]
      .map(([pid, p]) => {
        playerIds.add(pid)
        return [pid, p.name, p.start, p.end, p.birth] as const
      })
      .sort((a, b) => (b[3] ?? 9999) - (a[3] ?? 9999)) // recent players first

    const file = JSON.stringify({ v: 1, id: clubQid, p: rows })
    fs.writeFileSync(path.join(OUT_DIR, 'c', `${clubQid}.json`), file)
    totalBytes += file.length
    if (file.length > largest.bytes) largest = { qid: clubQid, bytes: file.length }
    index.push([clubQid, cleanLabel(club.label), club.country, players.size])
  }

  index.sort((a, b) => b[3] - a[3])
  const indexJson = JSON.stringify({
    v: 1,
    generated: new Date().toISOString().slice(0, 10),
    clubs: index,
  })
  fs.writeFileSync(path.join(OUT_DIR, 'clubs.json'), indexJson)

  console.log(`clubs.json: ${index.length} clubs, ${(indexJson.length / 1024).toFixed(0)} KB`)
  console.log(`players: ${playerIds.size} distinct`)
  console.log(`per-club files: ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`)
  console.log(`largest: ${largest.qid} (${(largest.bytes / 1024).toFixed(0)} KB)`)
}

main()
