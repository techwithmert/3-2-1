import type { Club, CommonPlayer, PlayerStint } from '../lib/data'

function years(p: PlayerStint): string | null {
  if (p.start === null && p.end === null) return null
  if (p.start !== null && p.end !== null)
    return p.start === p.end ? String(p.start) : `${p.start}–${p.end}`
  if (p.start !== null) return `${p.start}–`
  return `–${p.end}`
}

function stint(club: Club, p: PlayerStint): string {
  const y = years(p)
  return y ? `${club.label} ${y}` : club.label
}

interface Props {
  players: CommonPlayer[]
  clubA: Club
  clubB: Club
  /** normalized names appearing more than once — show birth year to tell them apart */
  ambiguous: Set<string>
}

export function ResultsList({ players, clubA, clubB, ambiguous }: Props) {
  return (
    <ol className="results">
      {players.map((p) => (
        <li key={p.qid} className="result-row">
          <span className="result-name">
            {p.name}
            {p.birth !== null && ambiguous.has(p.key) && (
              <span className="result-birth"> b. {p.birth}</span>
            )}
          </span>
          <span className="result-stints">
            {stint(clubA, p.a)} <span className="stint-sep">·</span> {stint(clubB, p.b)}
          </span>
        </li>
      ))}
    </ol>
  )
}
