import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ClubCombobox } from './components/ClubCombobox'
import { ResultsList } from './components/ResultsList'
import {
  AWAY_KIT,
  BALL,
  BALL_KIT,
  CLOUD,
  CLOUD_KIT,
  HOME_KIT,
  PLAYER_AWAY,
  PLAYER_HOME,
  PixelSprite,
  SUN,
  SUN_KIT,
} from './components/PixelSprite'
import { findFamilyMatches, intersect, loadClubIndex, loadClubPlayers } from './lib/data'
import type { Club, ClubIndex, FamilyMatch, PlayerStint } from './lib/data'
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
  const [index, setIndex] = useState<ClubIndex | null>(null)
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

  // near-misses through reserve sides, looked up only when nothing matched
  const [family, setFamily] = useState<FamilyMatch[] | null>(null)
  useEffect(() => {
    setFamily(null)
    if (!index || !clubA || !clubB || common === null || common.length > 0) return
    let cancelled = false
    findFamilyMatches(index, clubA, clubB).then(
      (found) => !cancelled && setFamily(found),
      () => {}
    )
    return () => {
      cancelled = true
    }
  }, [index, clubA, clubB, common])

  const bothPicked = clubA !== null && clubB !== null
  const loading = bothPicked && (a.loading || b.loading)
  const fetchError = a.error ?? b.error

  return (
    <div className="app">
      <div className="scene" aria-hidden="true">
        <PixelSprite sprite={SUN} palette={SUN_KIT} className="sun" />
        <PixelSprite sprite={CLOUD} palette={CLOUD_KIT} className="cloud cloud-1" />
        <PixelSprite sprite={CLOUD} palette={CLOUD_KIT} className="cloud cloud-2" />
        <PixelSprite sprite={CLOUD} palette={CLOUD_KIT} className="cloud cloud-3" />
        <div className="pitch">
          <div className="halfway" />
          <div className="centre-circle" />
        </div>
      </div>

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
            <div className="kickoff" aria-hidden="true">
              <PixelSprite sprite={PLAYER_HOME} palette={HOME_KIT} className="baller" />
              <div className="vs-stack">
                <PixelSprite sprite={BALL} palette={BALL_KIT} className="ball" />
                <div className="vs">vs</div>
              </div>
              <PixelSprite sprite={PLAYER_AWAY} palette={AWAY_KIT} className="baller" />
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
                  {family && family.length > 0 && (
                    <div className="near-miss">
                      <span className="near-miss-title">Unless you count the youth teams</span>
                      <ul>
                        {family.map((m) => (
                          <li key={`${m.clubA.qid}-${m.clubB.qid}`}>
                            <strong>{m.players.length}</strong> via {m.clubA.label} ·{' '}
                            {m.clubB.label}
                            <span className="near-miss-names">
                              {m.players
                                .slice(0, 3)
                                .map((p) => p.name)
                                .join(', ')}
                              {m.players.length > 3 ? '…' : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <span className="near-miss-rule">House rules decide.</span>
                    </div>
                  )}
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
