// Wikipedia API client + {{Infobox football biography}} parser.
//
// Wikidata's P54 lags on recent transfers (a human has to add each statement),
// while Wikipedia infoboxes are edited within hours. Noa Lang's 2026 loan to
// Galatasaray was on Wikipedia for weeks before Wikidata had it at all. This
// reads the senior-career table to fill those gaps.

const API = 'https://en.wikipedia.org/w/api.php'
const USER_AGENT = '321-common-player-checker/0.1 (mert@usepraktis.com)'
const MAX_TITLES = 50 // API limit for anonymous requests

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function api(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`
  const backoffs = [1000, 4000, 15000, 45000]
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (err) {
      if (attempt < backoffs.length) {
        await sleep(backoffs[attempt])
        continue
      }
      throw new Error(`wikipedia request failed: ${err}`)
    }
    if (res.ok) return res.json()
    if ((res.status === 429 || res.status >= 500) && attempt < backoffs.length) {
      const retryAfter = Number(res.headers.get('retry-after')) || backoffs[attempt] / 1000
      console.warn(`  wikipedia HTTP ${res.status}, sleeping ${retryAfter}s`)
      await sleep(retryAfter * 1000)
      continue
    }
    throw new Error(`wikipedia HTTP ${res.status}`)
  }
}

export interface CareerStint {
  /** wikilink target, e.g. "Galatasaray S.K. (football)" — resolved to a QID later */
  clubTitle: string
  start: number | null
  end: number | null
  loan: boolean
}

/** "2019–2020" -> [2019, 2020]; "2025–" -> [2025, null]; "2026" -> [2026, 2026]; "2019–20" -> [2019, 2020] */
export function parseYears(raw: string): [number | null, number | null] {
  const text = raw
    .replace(/<ref[^>]*>.*?<\/ref>|<ref[^>]*\/>/gis, '')
    .replace(/<!--.*?-->/gs, '')
    .trim()
  const m = text.match(/(\d{4})\s*(?:[–—−-]\s*(\d{2,4})?)?/)
  if (!m) return [null, null]
  const start = Number(m[1])
  if (m[2] === undefined) {
    // "2026" alone means a single season; an open range "2025–" has no group 2
    // either, so distinguish on whether a dash was present
    const openEnded = /\d{4}\s*[–—−-]\s*$/.test(text) || /\d{4}\s*[–—−-]/.test(text)
    return [start, openEnded ? null : start]
  }
  let end = Number(m[2])
  if (m[2].length === 2) {
    // "2019–20" -> 2020, "1999–00" -> 2000
    end = Math.floor(start / 100) * 100 + end
    if (end < start) end += 100
  }
  return [start, end]
}

/**
 * Split a template's parameters on top-level `|`.
 *
 * Can't be done line-by-line or with a simple regex: plenty of articles put
 * several params on one line ("| years1 = 2004–2007 | clubs1 = [[X]] | caps1 =
 * 57"), and pipes also appear inside `[[Target|Display]]` and `{{Height|m=1.8}}`
 * — so track nesting depth and only split at depth zero.
 */
export function templateParams(wikitext: string, templatePrefix: string): Map<string, string> {
  const params = new Map<string, string>()
  const start = wikitext.search(new RegExp(`\\{\\{\\s*${templatePrefix}`, 'i'))
  if (start === -1) return params

  let depth = 0
  let current = ''
  const parts: string[] = []
  for (let i = start; i < wikitext.length; i++) {
    const two = wikitext.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      current += two
      i++
      continue
    }
    if (two === '}}' || two === ']]') {
      depth--
      if (depth === 0) {
        parts.push(current)
        break // closed the infobox itself
      }
      current += two
      i++
      continue
    }
    if (wikitext[i] === '|' && depth === 1) {
      parts.push(current)
      current = ''
      continue
    }
    current += wikitext[i]
  }

  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim().toLowerCase()
    if (name !== '') params.set(name, part.slice(eq + 1).trim())
  }
  return params
}

/**
 * Pull the senior club career out of an article's lead wikitext.
 *
 * Only `clubsN` counts: `youthclubsN` is the academy and `nationalteamN` is the
 * country, neither of which answers "played for both clubs". Matching on the
 * exact param name is what keeps `youthclubs1` out.
 */
export function parseInfoboxCareer(wikitext: string): CareerStint[] {
  const params = templateParams(wikitext, 'Infobox football biography')
  const clubs = new Map<number, string>()
  const years = new Map<number, string>()
  for (const [name, value] of params) {
    let m = name.match(/^clubs(\d+)$/)
    if (m) clubs.set(Number(m[1]), value)
    m = name.match(/^years(\d+)$/)
    if (m) years.set(Number(m[1]), value)
  }

  const stints: CareerStint[] = []
  for (const [n, rawClub] of [...clubs].sort((a, b) => a[0] - b[0])) {
    // first wikilink in the value is the club; plain-text entries (amateur
    // sides with no article) can't be mapped to a QID, so skip them
    const link = rawClub.match(/\[\[([^\]|#]+)/)
    if (!link) continue
    const clubTitle = link[1].trim().replace(/_/g, ' ')
    if (clubTitle === '') continue
    const [start, end] = years.has(n) ? parseYears(years.get(n)!) : [null, null]
    stints.push({
      clubTitle,
      start,
      end,
      // "→" prefix is the infobox convention for a loan; "(loan)" is the text
      loan: /→|&rarr;|\(loan\)/i.test(rawClub),
    })
  }
  return stints
}

/** Batch titles into API-sized chunks. */
export function chunkTitles<T>(items: T[], size = MAX_TITLES): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Article title -> Wikidata QID, following redirects and title normalisation
 * (infoboxes link "Club Brugge KV" but the article may live elsewhere).
 */
export async function resolveTitlesToQids(titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const batches = chunkTitles(titles)
  for (const [i, batch] of batches.entries()) {
    const d = await api({
      action: 'query',
      prop: 'pageprops',
      ppprop: 'wikibase_item',
      redirects: '1',
      titles: batch.join('|'),
    })
    const hops = new Map<string, string>()
    for (const n of d.query?.normalized ?? []) hops.set(n.from, n.to)
    for (const r of d.query?.redirects ?? []) hops.set(r.from, r.to)
    const qidByTitle = new Map<string, string>()
    for (const p of d.query?.pages ?? []) {
      if (p.pageprops?.wikibase_item) qidByTitle.set(p.title, p.pageprops.wikibase_item)
    }
    for (const t of batch) {
      let cur = t
      for (let hop = 0; hop < 4 && hops.has(cur); hop++) cur = hops.get(cur)!
      const qid = qidByTitle.get(cur)
      if (qid) out.set(t, qid)
    }
    if ((i + 1) % 20 === 0 || i === batches.length - 1) {
      console.log(`  titles ${Math.min((i + 1) * MAX_TITLES, titles.length)}/${titles.length}`)
    }
  }
  return out
}

/** Run tasks with bounded concurrency — Wikipedia tolerates a few parallel readers. */
export async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++
        if (i >= items.length) return
        results[i] = await fn(items[i], i)
      }
    })
  )
  return results
}
