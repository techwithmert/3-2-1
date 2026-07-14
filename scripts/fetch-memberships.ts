// Stage B: for every club from Stage A, fetch notable players (any Wikipedia
// sitelink) with membership year qualifiers. Batches clubs into VALUES queries;
// bisects batches on timeout; resumable via checkpoint.
// Output: .cache/memberships.ndjson
// Env: LIMIT_CLUBS=200 to run on a sample.
import { sparql, qid, year, SparqlTimeoutError, ENDPOINT_NAME } from './lib/wdqs.ts'
import { ensureCacheDir, appendNdjson, readNdjson, readJson, writeJson } from './lib/cache.ts'
import type { ClubRow } from './fetch-clubs.ts'

const QLEVER = ENDPOINT_NAME === 'qlever'
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? (QLEVER ? 250 : 25))
const LABEL_LANGS = 'en,mul,es,pt,de,fr,it,tr,nl,ru,ja'

export interface MembershipRow {
  club: string
  player: string
  name: string
  start: number | null
  end: number | null
  birth: number | null
}

async function fetchBatch(clubIds: string[]): Promise<MembershipRow[]> {
  // QLever has no wikibase:label service — fetch en/mul labels as OPTIONALs
  const labelClause = QLEVER
    ? `OPTIONAL { ?player rdfs:label ?len . FILTER(LANG(?len) = "en") }
       OPTIONAL { ?player rdfs:label ?lmul . FILTER(LANG(?lmul) = "mul") }`
    : `SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}". }`
  const labelVars = QLEVER ? '?len ?lmul' : '?playerLabel'
  try {
    const bindings = await sparql(`
      SELECT ?club ?player ${labelVars} ?start ?end ?birth WHERE {
        VALUES ?club { ${clubIds.map((id) => `wd:${id}`).join(' ')} }
        ?player p:P54 ?st .
        ?st ps:P54 ?club .
        ?player wdt:P31 wd:Q5 .
        ?player wikibase:sitelinks ?psl . FILTER(?psl > 0)
        OPTIONAL { ?st pq:P580 ?start }
        OPTIONAL { ?st pq:P582 ?end }
        OPTIONAL { ?player wdt:P569 ?birth }
        ${labelClause}
      }
    `)
    return bindings.map((b) => ({
      club: qid(b.club!.value),
      player: qid(b.player!.value),
      name: (QLEVER ? (b.len?.value ?? b.lmul?.value) : b.playerLabel?.value) ?? '',
      start: year(b.start?.value),
      end: year(b.end?.value),
      birth: year(b.birth?.value),
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
  // dedupe (clubs can appear under several classes), most-notable first
  const byQid = new Map<string, ClubRow>()
  for (const row of clubRows) if (!byQid.has(row.qid)) byQid.set(row.qid, row)
  let clubs = [...byQid.values()].sort((a, b) => b.sitelinks - a.sitelinks)
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
