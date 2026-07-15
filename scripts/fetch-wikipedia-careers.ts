// Stage B3: read senior club careers from English Wikipedia infoboxes.
//
// Wikidata's P54 lags on recent transfers because each statement is added by
// hand; Wikipedia is edited within hours. Stage C unions this with the Wikidata
// careers so a fresh loan (Noa Lang -> Galatasaray, 2026) still shows up.
//
// Output: .cache/wp-careers.ndjson  ({player, club, start, end, loan} rows)
// Env: LIMIT_PLAYERS=500 for a sample run.
import { sparql, qid } from './lib/wdqs.ts'
import { api, chunkTitles, parseInfoboxCareer, pool, resolveTitlesToQids } from './lib/wikipedia.ts'
import { ensureCacheDir, appendNdjson, readNdjson, readJson, writeJson } from './lib/cache.ts'
import type { MembershipRow } from './fetch-memberships.ts'

const CONCURRENCY = 4

export interface WpCareerRow {
  player: string
  club: string // QID
  start: number | null
  end: number | null
  loan: boolean
}

/** player QID -> en.wikipedia article title, for players that have one. */
async function fetchEnwikiTitles(players: string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  const batches = chunkTitles(players, 1500)
  for (const [i, batch] of batches.entries()) {
    const bindings = await sparql(`
      SELECT ?p ?name WHERE {
        VALUES ?p { ${batch.map((q) => `wd:${q}`).join(' ')} }
        ?article schema:about ?p ;
                 schema:isPartOf <https://en.wikipedia.org/> ;
                 schema:name ?name .
      }
    `)
    for (const b of bindings) titles.set(qid(b.p!.value), b.name!.value)
    console.log(`  sitelinks ${Math.min((i + 1) * 1500, players.length)}/${players.length}`)
  }
  return titles
}

async function main() {
  ensureCacheDir()

  const memberships = readNdjson<MembershipRow>('memberships.ndjson')
  if (memberships.length === 0) {
    console.error('No memberships found — run `npm run data:players` first.')
    process.exit(1)
  }
  let players = [...new Set(memberships.map((m) => m.player))]
  if (process.env.LIMIT_PLAYERS) players = players.slice(0, Number(process.env.LIMIT_PLAYERS))

  console.log(`Finding en.wikipedia articles for ${players.length} players...`)
  const titles = await fetchEnwikiTitles(players)
  console.log(`${titles.size} players have an English article\n`)

  const byTitle = new Map([...titles].map(([p, t]) => [t, p]))
  const checkpoint = readJson<{ done: string[] }>('wp-checkpoint.json', { done: [] })
  const done = new Set(checkpoint.done)
  const todo = [...titles.values()].filter((t) => !done.has(t))
  console.log(`Fetching infoboxes: ${todo.length} to go (${done.size} already cached)`)

  // title -> parsed stints, accumulated across batches before QID resolution
  const careers = new Map<string, ReturnType<typeof parseInfoboxCareer>>()
  const batches = chunkTitles(todo)
  const startedAt = Date.now()
  let processed = 0

  await pool(batches, CONCURRENCY, async (batch) => {
    const d = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content',
      rvsection: '0',
      rvslots: 'main',
      redirects: '1',
      titles: batch.join('|'),
    })
    // map any normalised/redirected titles back to what we asked for
    const back = new Map<string, string>()
    for (const n of d.query?.normalized ?? []) back.set(n.to, n.from)
    for (const r of d.query?.redirects ?? []) back.set(r.to, r.from)

    for (const page of d.query?.pages ?? []) {
      const text = page.revisions?.[0]?.slots?.main?.content
      if (!text) continue
      let asked = page.title
      for (let hop = 0; hop < 4 && back.has(asked); hop++) asked = back.get(asked)!
      const stints = parseInfoboxCareer(text)
      if (stints.length > 0) careers.set(asked, stints)
    }
    processed += batch.length
    if (processed % 2000 < 50) {
      const rate = processed / ((Date.now() - startedAt) / 60000)
      console.log(
        `  ${processed}/${todo.length} articles · ~${Math.round((todo.length - processed) / rate)} min left`
      )
    }
  })

  console.log(`\nParsed careers for ${careers.size} players`)

  const clubTitles = [...new Set([...careers.values()].flatMap((s) => s.map((x) => x.clubTitle)))]
  console.log(`Resolving ${clubTitles.length} club titles to QIDs...`)
  const clubQids = await resolveTitlesToQids(clubTitles)
  console.log(`${clubQids.size}/${clubTitles.length} resolved`)

  const rows: WpCareerRow[] = []
  const unresolved = new Map<string, number>()
  for (const [title, stints] of careers) {
    const player = byTitle.get(title)
    if (!player) continue
    for (const s of stints) {
      const club = clubQids.get(s.clubTitle)
      if (!club) {
        unresolved.set(s.clubTitle, (unresolved.get(s.clubTitle) ?? 0) + 1)
        continue
      }
      rows.push({ player, club, start: s.start, end: s.end, loan: s.loan })
    }
  }
  appendNdjson('wp-careers.ndjson', rows)
  for (const t of todo) done.add(t)
  writeJson('wp-checkpoint.json', { done: [...done] })

  console.log(`\nDone. ${rows.length} career rows written`)
  if (unresolved.size > 0) {
    const worst = [...unresolved].sort((a, b) => b[1] - a[1])
    const dropped = worst.reduce((n, [, c]) => n + c, 0)
    console.log(`\n${dropped} stints dropped — no article/QID for ${unresolved.size} club titles:`)
    for (const [title, n] of worst.slice(0, 15)) console.log(`  ${String(n).padStart(4)}x ${title}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
