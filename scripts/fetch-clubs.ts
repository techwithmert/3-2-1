// Stage A: enumerate association football clubs (Q476028 + subclasses) that have
// at least one Wikipedia sitelink. Output: .cache/clubs.ndjson
import { sparql, qid } from './lib/wdqs.ts'
import { ensureCacheDir, appendNdjson, readJson, writeJson, cachePath } from './lib/cache.ts'
import fs from 'node:fs'

const LABEL_LANGS = 'en,mul,de,es,fr,it,pt,tr,nl,ru,ja'
const PAGE_SIZE = 2000

export interface ClubRow {
  qid: string
  label: string
  country: string | null
  sitelinks: number
}

async function main() {
  ensureCacheDir()

  console.log('Fetching subclass tree of Q476028 (association football club)...')
  const classes = await sparql(`
    SELECT DISTINCT ?type WHERE { ?type wdt:P279* wd:Q476028 . }
  `)
  const classIds = classes.map((b) => qid(b.type!.value))
  console.log(`${classIds.length} club classes`)

  // checkpoint: fully-done classes + next page per in-progress class
  const checkpoint = readJson<{ done: string[]; pages: Record<string, number> }>(
    'clubs-checkpoint.json',
    { done: [], pages: {} }
  )
  const done = new Set(checkpoint.done)
  const pagesDone = checkpoint.pages

  const save = () => writeJson('clubs-checkpoint.json', { done: [...done], pages: pagesDone })

  for (const cls of classIds) {
    if (done.has(cls)) continue

    // count only clubs with a sitelink — that's all we'll page through
    const countRows = await sparql(
      `SELECT (COUNT(?club) AS ?n) WHERE {
        ?club wdt:P31 wd:${cls} ; wikibase:sitelinks ?sl . FILTER(?sl > 0)
      }`
    )
    const total = Number(countRows[0]?.n?.value ?? 0)
    const pages = Math.ceil(total / PAGE_SIZE)
    console.log(`${cls}: ${total} clubs with sitelinks (${pages} page${pages === 1 ? '' : 's'})`)

    for (let page = pagesDone[cls] ?? 0; page < pages; page++) {
      const bindings = await sparql(`
        SELECT ?club ?clubLabel ?cc ?sitelinks WHERE {
          { SELECT ?club ?sitelinks WHERE {
              ?club wdt:P31 wd:${cls} ; wikibase:sitelinks ?sitelinks .
              FILTER(?sitelinks > 0)
            } ORDER BY ?club LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE} }
          OPTIONAL { ?club wdt:P17 ?ctry . ?ctry wdt:P297 ?cc . }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "${LABEL_LANGS}". }
        }
      `)
      const rows: ClubRow[] = bindings.map((b) => ({
        qid: qid(b.club!.value),
        label: b.clubLabel?.value ?? '',
        country: b.cc?.value ?? null,
        sitelinks: Number(b.sitelinks?.value ?? 0),
      }))
      appendNdjson('clubs.ndjson', rows)
      pagesDone[cls] = page + 1
      save()
      if (pages > 1) console.log(`  page ${page + 1}/${pages}: ${rows.length} rows`)
    }

    done.add(cls)
    delete pagesDone[cls]
    save()
  }

  // Report distinct clubs (a club can be an instance of several classes; Stage C dedupes)
  const lines = fs.readFileSync(cachePath('clubs.ndjson'), 'utf8').split('\n').filter(Boolean)
  const distinct = new Set(lines.map((l) => (JSON.parse(l) as ClubRow).qid))
  console.log(`\nDone. ${distinct.size} distinct clubs in .cache/clubs.ndjson`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
