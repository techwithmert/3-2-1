// Stage A: enumerate football clubs.
//
// Enumerated from the P54 side — every team a footballer is a member of, minus
// national teams and teams playing a different sport. A P31 class whitelist was
// tried first and silently dropped ~4,900 real clubs (Boca Juniors, San Lorenzo,
// Karşıyaka …) that are typed only as "sports club" / "multisports club".
//
// Output: .cache/clubs.ndjson
import { sparql, qid } from './lib/wdqs.ts'
import { fetchLabels } from './lib/labels.ts'
import { ensureCacheDir, appendNdjson, cachePath } from './lib/cache.ts'
import fs from 'node:fs'

const FOOTBALL_OCCUPATIONS = ['Q937857', 'Q628099', 'Q23905045'] // footballer, manager, futsal player
const NATIONAL_TEAM = 'Q6979593'

// Raw P31 QIDs are kept as-is so Stage C can classify without a re-crawl.
export interface ClubRow {
  qid: string
  label: string
  country: string | null
  parent: string | null
  types: string[]
}

async function main() {
  ensureCacheDir()

  console.log('Enumerating clubs from footballers’ P54 statements...')
  const bindings = await sparql(`
    SELECT ?club ?cc ?parent ?type WHERE {
      ?p wdt:P31 wd:Q5 ; wdt:P106 ?occ ; p:P54 ?st .
      ?st ps:P54 ?club .
      VALUES ?occ { ${FOOTBALL_OCCUPATIONS.map((q) => `wd:${q}`).join(' ')} }
      FILTER NOT EXISTS { ?club wdt:P31/wdt:P279* wd:${NATIONAL_TEAM} }
      # No P641 (sport) filter on purpose. It looks like the obvious way to drop
      # the odd cricket/basketball side that a footballer also turned out for,
      # but the values are too inconsistent to test against: Greek clubs use
      # "men's association football" (a subclass of Q2736), Mohun Bagan uses the
      # vague "team sport", and multisport clubs list all 16 sports they run.
      # Every version of the filter deleted real clubs, so we let the P54 link
      # from a footballer be the only test and accept a little cross-sport noise.
      OPTIONAL { ?club wdt:P17/wdt:P297 ?cc }
      OPTIONAL { ?club wdt:P361 ?parent }
      OPTIONAL { ?club wdt:P31 ?type }
    }
  `)
  console.log(`${bindings.length} rows`)

  // One row per (club, parent, type) combination — fold them into one row per club.
  const clubs = new Map<string, ClubRow>()
  const types = new Map<string, Set<string>>()
  for (const b of bindings) {
    const id = qid(b.club!.value)
    let club = clubs.get(id)
    if (!club) {
      club = { qid: id, label: '', country: b.cc?.value ?? null, parent: null, types: [] }
      clubs.set(id, club)
      types.set(id, new Set())
    }
    if (club.country === null && b.cc?.value) club.country = b.cc.value
    if (b.parent?.value) club.parent = qid(b.parent.value)
    if (b.type?.value) types.get(id)!.add(qid(b.type.value))
  }
  for (const [id, club] of clubs) club.types = [...types.get(id)!]

  console.log(`Fetching labels for ${clubs.size} clubs...`)
  const labels = await fetchLabels([...clubs.keys()])
  for (const [id, club] of clubs) club.label = labels.get(id) ?? ''

  fs.rmSync(cachePath('clubs.ndjson'), { force: true })
  appendNdjson('clubs.ndjson', [...clubs.values()])

  const withLabel = [...clubs.values()].filter((c) => c.label !== '').length
  console.log(`\nDone. ${clubs.size} clubs (${withLabel} with a usable label)`)
  console.log(`  with a P361 parent: ${[...clubs.values()].filter((c) => c.parent).length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
