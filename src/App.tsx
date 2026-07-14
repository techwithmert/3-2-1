import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ClubCombobox } from './components/ClubCombobox'
import { ResultsList } from './components/ResultsList'
import { intersect, loadClubIndex, loadClubPlayers } from './lib/data'
import type { Club, PlayerStint } from './lib/data'
import { normalize } from './lib/normalize'

function useClubPlayers(club: Club | null) {
  const [loaded, setLoaded] = useState<{ qid: string; players: PlayerStint[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    if (!club) return
    let cancelled = false
    loadClubPlayers(club.qid).then(
      (players) => !cancelled && setLoaded({ qid: club.qid, players }),
      (err: unknown) => !cancelled && setError(String(err))
    )
    return () => {
      cancelled = true
    }
  }, [club])

  const players = club && loaded?.qid === club.qid ? loaded.players : null
  return { players, loading: club !== null && players === null && error === null, error }
}

export default function App() {
  const [index, setIndex] = useState<{ clubs: Club[]; generated: string } | null>(null)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [clubA, setClubA] = useState<Club | null>(null)
  const [clubB, setClubB] = useState<Club | null>(null)
  const [filter, setFilter] = useState('')
  const deferredFilter = useDeferredValue(filter)

  useEffect(() => {
    loadClubIndex().then(setIndex, (err: unknown) => setIndexError(String(err)))
  }, [])

  const a = useClubPlayers(clubA)
  const b = useClubPlayers(clubB)

  const common = useMemo(
    () => (a.players && b.players ? intersect(a.players, b.players) : null),
    [a.players, b.players]
  )

  const filtered = useMemo(() => {
    if (!common) return null
    const q = normalize(deferredFilter.trim())
    return q === '' ? common : common.filter((p) => p.key.includes(q))
  }, [common, deferredFilter])

  const ambiguous = useMemo(() => {
    if (!common) return new Set<string>()
    const seen = new Set<string>()
    const dupes = new Set<string>()
    for (const p of common) (seen.has(p.key) ? dupes : seen).add(p.key)
    return dupes
  }, [common])

  const bothPicked = clubA !== null && clubB !== null
  const loading = bothPicked && (a.loading || b.loading)
  const fetchError = a.error ?? b.error

  return (
    <div className="app">
      <header className="masthead">
        <h1 className="wordmark">
          <span>3</span>
          <span>2</span>
          <span>1</span>
        </h1>
        <p className="tagline">Name a player who played for both clubs</p>
      </header>

      {indexError && <div className="error-card">Couldn’t load the club list. {indexError}</div>}
      {!index && !indexError && <div className="hint">Loading clubs…</div>}

      {index && (
        <main>
          <section className="fixture" aria-label="Pick two clubs">
            <ClubCombobox clubs={index.clubs} side="a" value={clubA} onChange={setClubA} />
            <div className="vs" aria-hidden="true">
              vs
            </div>
            <ClubCombobox clubs={index.clubs} side="b" value={clubB} onChange={setClubB} />
          </section>

          {!bothPicked && (
            <p className="hint">
              Two clubs are called out — pick them both, and every player who wore both shirts
              appears here.
            </p>
          )}

          {loading && <p className="hint">Checking the archives…</p>}
          {fetchError && <div className="error-card">Couldn’t load player data. {fetchError}</div>}

          {common && filtered && clubA && clubB && (
            <section className="verdict" aria-live="polite">
              {common.length === 0 ? (
                <div className="no-match">
                  <span className="card-icon" aria-hidden="true" />
                  <strong>No one has played for both</strong>
                  <p>
                    Not a single player in the books for {clubA.label} and {clubB.label} — if
                    someone named one, that’s a bluff.
                  </p>
                </div>
              ) : (
                <>
                  <div className="results-bar">
                    <span className="results-count">
                      {common.length} player{common.length === 1 ? '' : 's'} wore both shirts
                    </span>
                    {common.length > 5 && (
                      <input
                        type="search"
                        className="filter"
                        placeholder="Check a name…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        aria-label="Filter players by name"
                      />
                    )}
                  </div>
                  {filtered.length === 0 ? (
                    <p className="filter-miss">
                      Nobody matching “{filter.trim()}” played for both. Bluff called.
                    </p>
                  ) : (
                    <ResultsList players={filtered} clubA={clubA} clubB={clubB} ambiguous={ambiguous} />
                  )}
                </>
              )}
            </section>
          )}
        </main>
      )}

      <footer className="colophon">
        Career data from Wikidata{index ? `, snapshot ${index.generated}` : ''}. Gaps happen —
        settle disputes like gentlemen.
      </footer>
    </div>
  )
}
