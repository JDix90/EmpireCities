import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { CountryInfo } from './editorTemplates';

interface CountrySearchProps {
  countries: CountryInfo[];
  /** ISO codes already on the map: shown, but not pickable twice. */
  usedCodes: Set<string>;
  onPick: (country: CountryInfo) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

const MAX_RESULTS = 8;

/**
 * Type a country, press Enter: the fastest way to add a territory when you
 * know what you want, and the only way to find a small one on a globe.
 */
export default function CountrySearch({
  countries,
  usedCodes,
  onPick,
  placeholder = 'Add a country…',
  autoFocus = false,
  className = '',
}: CountrySearchProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts: CountryInfo[] = [];
    const contains: CountryInfo[] = [];
    for (const c of countries) {
      const name = c.name.toLowerCase();
      if (name.startsWith(q) || c.code.toLowerCase() === q) starts.push(c);
      else if (name.includes(q)) contains.push(c);
    }
    return [...starts, ...contains].slice(0, MAX_RESULTS);
  }, [countries, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  const pick = (c: CountryInfo) => {
    if (usedCodes.has(c.code)) return;
    onPick(c);
    setQuery('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      const chosen = results[active];
      if (chosen) {
        e.preventDefault();
        pick(chosen);
      }
    } else if (e.key === 'Escape') {
      if (query) {
        e.stopPropagation();
        setQuery('');
      }
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="w-3.5 h-3.5 text-bf-muted absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="country-search-results"
        aria-autocomplete="list"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="input text-sm py-1.5 pl-8 w-full"
      />
      {open && results.length > 0 && (
        <ul
          id="country-search-results"
          role="listbox"
          className="absolute left-0 right-0 bottom-full mb-1 z-20 rounded-lg border border-bf-border bg-bf-surface shadow-xl overflow-hidden"
        >
          {results.map((c, i) => {
            const used = usedCodes.has(c.code);
            return (
              <li
                key={c.code}
                role="option"
                aria-selected={i === active}
                aria-disabled={used}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex items-center justify-between gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                  i === active ? 'bg-bf-gold/15 text-bf-text' : 'text-bf-text'
                } ${used ? 'opacity-50 cursor-default' : ''}`}
              >
                <span className="truncate">
                  {c.name}
                  <span className="text-bf-muted text-xs ml-1.5">{c.code}</span>
                </span>
                <span className="text-[11px] text-bf-muted shrink-0">{used ? 'on the map' : c.subregion}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
