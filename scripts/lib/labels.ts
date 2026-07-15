// Label lookup with a language fallback chain.
//
// QLever has no SERVICE wikibase:label, and asking for one language inline (en
// only) silently drops everything labelled solely in German, Ukrainian, Greek …
// — about a thousand clubs. So fetch labels in their own batched pass and pick
// the best available language per entity.
import { sparql, qid } from './wdqs.ts'

// Priority order. "mul" is Wikidata's language-neutral label (usually the
// club's own spelling), which beats a translation.
const LANGS = [
  'en', 'mul', 'es', 'pt', 'de', 'it', 'fr', 'nl', 'tr', 'ru', 'uk', 'pl',
  'sv', 'da', 'no', 'fi', 'el', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'sr',
  'sl', 'bs', 'sq', 'mk', 'be', 'lv', 'lt', 'et', 'is', 'ca', 'gl', 'eu',
  'ja', 'ko', 'zh', 'ar', 'fa', 'he', 'id', 'vi', 'th', 'ka', 'hy', 'az',
  'kk', 'uz',
]
const RANK = new Map(LANGS.map((l, i) => [l, i]))
const BATCH = 1500

/** qid -> best available label. Entities with no label in any listed language are absent. */
export async function fetchLabels(qids: string[]): Promise<Map<string, string>> {
  const best = new Map<string, { label: string; rank: number }>()
  const langFilter = LANGS.map((l) => `"${l}"`).join(', ')

  for (let i = 0; i < qids.length; i += BATCH) {
    const batch = qids.slice(i, i + BATCH)
    const bindings = await sparql(`
      SELECT ?e ?l WHERE {
        VALUES ?e { ${batch.map((q) => `wd:${q}`).join(' ')} }
        ?e rdfs:label ?l .
        FILTER(LANG(?l) IN (${langFilter}))
      }
    `)
    for (const b of bindings) {
      const id = qid(b.e!.value)
      const label = b.l!.value
      // SPARQL JSON gives the language tag in xml:lang
      const lang = (b.l as { 'xml:lang'?: string })['xml:lang'] ?? ''
      const rank = RANK.get(lang) ?? 999
      const current = best.get(id)
      if (!current || rank < current.rank) best.set(id, { label, rank })
    }
    if (qids.length > BATCH) {
      console.log(`  labels ${Math.min(i + BATCH, qids.length)}/${qids.length}`)
    }
  }
  return new Map([...best].map(([id, v]) => [id, v.label]))
}
