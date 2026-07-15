// SPARQL client for QLever (default) or the Wikidata Query Service.
// QLever has no 60s query cap, which the club enumeration needs; WDQS is kept
// as a fallback. Etiquette either way: identify yourself, one request at a
// time, back off on 429/5xx.

const ENDPOINTS: Record<string, string> = {
  wdqs: 'https://query.wikidata.org/sparql',
  qlever: 'https://qlever.dev/api/wikidata',
}

export const ENDPOINT_NAME = process.env.SPARQL_ENDPOINT ?? 'qlever'
const ENDPOINT = ENDPOINTS[ENDPOINT_NAME]
if (!ENDPOINT) {
  throw new Error(`Unknown SPARQL_ENDPOINT "${process.env.SPARQL_ENDPOINT}" (use: wdqs | qlever)`)
}

const USER_AGENT = '321-common-player-checker/0.1 (mert@usepraktis.com)'
const MIN_INTERVAL_MS = 1000
const TIMEOUT_MS = 65_000

let lastRequestAt = 0

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface SparqlBinding {
  [variable: string]: { type: string; value: string } | undefined
}

export class SparqlTimeoutError extends Error {}

// WDQS auto-registers these; QLever requires them spelled out.
const PREFIXES = `
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>
PREFIX mwapi: <https://www.mediawiki.org/ontology#API/>
`

/** Run a SPARQL query. Throttled to 1 rps; retries on 429/5xx; throws SparqlTimeoutError on query timeout. */
export async function sparql(query: string): Promise<SparqlBinding[]> {
  // QLever throws intermittent 502s under a sustained crawl and can take a
  // while to come back, so be patient — a full re-crawl is ~25k clubs.
  const backoffs = [2000, 5000, 15000, 45000, 90000, 120000]
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastRequestAt = Date.now()

    let res: Response
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/sparql-results+json',
        },
        body: new URLSearchParams({ query: PREFIXES + query }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      // network error or client-side timeout — treat like a query timeout so callers can bisect
      if (attempt < backoffs.length) {
        await sleep(backoffs[attempt])
        continue
      }
      throw new SparqlTimeoutError(`request failed after retries: ${err}`)
    }

    if (res.ok) {
      const json = (await res.json()) as { results: { bindings: SparqlBinding[] } }
      return json.results.bindings
    }

    const body = await res.text()
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 10
      console.warn(`  429 rate-limited, sleeping ${retryAfter}s`)
      await sleep(retryAfter * 1000)
      continue // 429 doesn't count as a retry attempt
    }
    // WDQS reports query timeouts as 500 with a TimeoutException body
    if (body.includes('TimeoutException') || body.includes('QueryTimeoutException')) {
      throw new SparqlTimeoutError(`query timed out on server`)
    }
    if (res.status >= 500 && attempt < backoffs.length) {
      console.warn(`  HTTP ${res.status}, retrying in ${backoffs[attempt] / 1000}s`)
      await sleep(backoffs[attempt])
      continue
    }
    throw new Error(`SPARQL HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
}

/** "http://www.wikidata.org/entity/Q42" -> "Q42" */
export function qid(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1)
}

/** "2004-07-01T00:00:00Z" -> 2004 (null on junk) */
export function year(value: string | undefined): number | null {
  if (!value) return null
  const y = parseInt(value, 10)
  return Number.isFinite(y) && y > 800 && y < 2100 ? y : null
}
