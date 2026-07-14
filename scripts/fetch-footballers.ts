// Optional Stage B2: the set of people whose occupation is footballer / football
// manager / futsal player. Used by Stage C to drop other-sport athletes that
// multisport club items (Benfica, Real Madrid, …) attach via P54.
// Output: .cache/footballers.ndjson (one QID per line)
import { sparql, qid } from './lib/wdqs.ts'
import { ensureCacheDir, cachePath } from './lib/cache.ts'
import fs from 'node:fs'

async function main() {
  ensureCacheDir()
  const rows = await sparql(`
    SELECT DISTINCT ?p WHERE {
      ?p wdt:P106 ?occ .
      VALUES ?occ { wd:Q937857 wd:Q628099 wd:Q23905045 }
    }`)
  const ids = rows.map((b) => qid(b.p!.value))
  fs.writeFileSync(cachePath('footballers.ndjson'), ids.map((id) => JSON.stringify(id)).join('\n') + '\n')
  console.log(`${ids.length} footballers`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
