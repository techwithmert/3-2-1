// Stage B: for every club from Stage A, fetch its footballers with membership
// year qualifiers and the loan flag. Batches clubs into VALUES queries; bisects
// batches on timeout; resumable via checkpoint.
// Output: .cache/memberships.ndjson
// Env: LIMIT_CLUBS=200 to run on a sample, BATCH_SIZE to override.
import { sparql, qid, year, SparqlTimeoutError, ENDPOINT_NAME } from './lib/wdqs.ts'
import { ensureCacheDir, appendNdjson, readNdjson, readJson, writeJson } from './lib/cache.ts'
import type { ClubRow } from './fetch-clubs.ts'

const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? (ENDPOINT_NAME === 'qlever' ? 250 : 25))
const FOOTBALL_OCCUPATIONS = ['Q937857', 'Q628099', 'Q23905045'] // footballer, manager, futsal player
const LOAN = 'Q2914547' // P1642 "acquisition transaction" = loan

export interface MembershipRow {
  club: string
  player: string
  start: number | null
  end: number | null
  birth: number | null
  loan: boolean
}

async function fetchBatch(clubIds: string[]): Promise<MembershipRow[]> {
  try {
    // no labels here — fetch-player-labels.ts does those in one pass with a
    // proper language fallback
    const bindings = await sparql(`
      SELECT ?club ?player ?start ?end ?birth ?acq WHERE {
        VALUES ?club { ${clubIds.map((id) => `wd:${id}`).join(' ')} }
        ?player p:P54 ?st .
        ?st ps:P54 ?club .
        ?player wdt:P31 wd:Q5 ; wdt:P106 ?occ .
        VALUES ?occ { ${FOOTBALL_OCCUPATIONS.map((q) => `wd:${q}`).join(' ')} }
        OPTIONAL { ?st pq:P580 ?start }
        OPTIONAL { ?st pq:P582 ?end }
        OPTIONAL { ?st pq:P1642 ?acq }
        OPTIONAL { ?player wdt:P569 ?birth }
      }
    `)
    return bindings.map((b) => ({
      club: qid(b.club!.value),
      player: qid(b.player!.value),
      start: year(b.start?.value),
      end: year(b.end?.value),
      birth: year(b.birth?.value),
      loan: b.acq?.value ? qid(b.acq.value) === LOAN : false,
    }))
  } catch (err) {
    if (err instanceof SparqlTimeoutError && clubIds.length > 1) {
      const mid = Math.ceil(clubIds.length / 2)
      console.warn(`  timeout on batch of ${clubIds.length}, bisecting`)
      const left = await fetchBatch(clubIds.slice(0, mid))
      const right = await fetchBatch(clubIds.slice(mid))
      return [...left, ...right]
    }
    throw err
  }
}

async function main() {
  ensureCacheDir()

  const clubRows = readNdjson<ClubRow>('clubs.ndjson')
  if (clubRows.length === 0) {
    console.error('No clubs found — run `npm run data:clubs` first.')
    process.exit(1)
  }
  let clubs = clubRows
  if (process.env.LIMIT_CLUBS) clubs = clubs.slice(0, Number(process.env.LIMIT_CLUBS))

  const checkpoint = readJson<{ done: string[] }>('memberships-checkpoint.json', { done: [] })
  const done = new Set(checkpoint.done)
  const todo = clubs.filter((c) => !done.has(c.qid))
  console.log(`${clubs.length} clubs total, ${todo.length} remaining`)

  const startedAt = Date.now()
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE)
    const rows = await fetchBatch(batch.map((c) => c.qid))
    appendNdjson('memberships.ndjson', rows)
    for (const c of batch) done.add(c.qid)
    writeJson('memberships-checkpoint.json', { done: [...done] })

    const processed = i + batch.length
    const rate = processed / ((Date.now() - startedAt) / 60000)
    console.log(
      `${processed}/${todo.length} clubs · ${rows.length} rows in batch · ~${Math.round((todo.length - processed) / rate)} min left`
    )
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
