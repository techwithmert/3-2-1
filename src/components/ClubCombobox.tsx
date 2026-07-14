import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Club } from '../lib/data'
import { normalize } from '../lib/normalize'

const MAX_SUGGESTIONS = 20

function rank(clubs: Club[], query: string): Club[] {
  const q = normalize(query.trim())
  if (q === '') return []
  // prefix and word-start rank together: typing "barcelona" must put
  // FC Barcelona (word-start, huge) above Barcelona S.C. (prefix, small)
  const wordStart: Club[] = []
  const substring: Club[] = []
  for (const club of clubs) {
    const at = club.key.indexOf(q)
    if (at === -1) continue
    if (at === 0 || club.key[at - 1] === ' ') wordStart.push(club)
    else substring.push(club)
  }
  // clubs.json is sorted by player count desc, so each bucket is already
  // ordered best-first
  return [...wordStart, ...substring].slice(0, MAX_SUGGESTIONS)
}

interface Props {
  clubs: Club[]
  side: 'a' | 'b'
  value: Club | null
  onChange: (club: Club | null) => void
}

export function ClubCombobox({ clubs, side, value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const suggestions = useMemo(() => (open ? rank(clubs, query) : []), [clubs, query, open])

  useEffect(() => setActive(0), [query])

  function select(club: Club) {
    onChange(club)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Escape') inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(suggestions[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (value && !open) {
    return (
      <button
        type="button"
        className={`club-chip side-${side}`}
        onClick={() => {
          onChange(null)
          setOpen(true)
          // focus after re-render swaps the chip for the input
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        <span className="club-chip-name">{value.label}</span>
        <span className="club-chip-meta">
          {value.country ? `${value.country} · ` : ''}
          {value.count} player{value.count === 1 ? '' : 's'} · tap to change
        </span>
      </button>
    )
  }

  return (
    <div className="combobox">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={side === 'a' ? 'First club' : 'Second club'}
        placeholder={side === 'a' ? 'First club…' : 'Second club…'}
        value={query}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {open && suggestions.length > 0 && (
        <ul className="suggestions" role="listbox" id={listId}>
          {suggestions.map((club, i) => (
            <li
              key={club.qid}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault() // don't blur the input before select fires
                select(club)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="suggestion-name">{club.label}</span>
              <span className="suggestion-meta">
                {club.country ?? ''} {club.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
