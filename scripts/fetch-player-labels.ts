// Stage B2: label every player found by the membership crawl, using the same
// language fallback as the clubs. Runs as its own pass because the player set
// is only known once Stage B has finished.
// Output: .cache/player-labels.ndjson  ([qid, label] pairs)
import { fetchLabels } from './lib/labels.ts'
import { ensureCacheDir, appendNdjson, readNdjson, cachePath } from './lib/cache.ts'
import type { MembershipRow } from './fetch-memberships.ts'
import fs from 'node:fs'

async function main() {
  ensureCacheDir()

  const memberships = readNdjson<MembershipRow>('memberships.ndjson')
  if (memberships.length === 0) {
    console.error('No memberships found — run `npm run data:players` first.')
    process.exit(1)
  }
  const players = [...new Set(memberships.map((m) => m.player))]
  console.log(`Fetching labels for ${players.length} players...`)

  const labels = await fetchLabels(players)

  fs.rmSync(cachePath('player-labels.ndjson'), { force: true })
  appendNdjson('player-labels.ndjson', [...labels])
  console.log(`\nDone. ${labels.size}/${players.length} players labelled`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
