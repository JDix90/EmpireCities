import { describe, expect, it } from 'vitest';
import { chronicleDate, eraHasCalendar, formatYear, yearForTurn } from './eraCalendar';

describe('era calendar', () => {
  it('opens each era on the year its map name advertises', () => {
    // The lobby tells the player "Ancient World (200 AD)"; the Chronicle must
    // not then date turn 1 somewhere else.
    expect(yearForTurn('ancient', 1)).toBe(200);
    expect(yearForTurn('medieval', 1)).toBe(1200);
    expect(yearForTurn('discovery', 1)).toBe(1600);
    expect(yearForTurn('ww2', 1)).toBe(1939);
    expect(yearForTurn('coldwar', 1)).toBe(1947);
  });

  it('moves time forward as the match runs', () => {
    expect(yearForTurn('ancient', 11)).toBeGreaterThan(yearForTurn('ancient', 1));
    expect(yearForTurn('medieval', 20)).toBeGreaterThan(yearForTurn('medieval', 19));
  });

  it('keeps a closed historical window inside its own war', () => {
    // A 60-turn ACW match must not narrate its way into 1900.
    expect(yearForTurn('acw', 60)).toBeLessThanOrEqual(1865);
    expect(yearForTurn('ww2', 60)).toBeLessThanOrEqual(1945);
    expect(yearForTurn('coldwar', 200)).toBeLessThanOrEqual(1991);
  });

  it('stays plausible over a full-length match in an open era', () => {
    // Quick Match caps at 60 turns; the Ancient world should not reach the
    // Renaissance by the end of one.
    expect(yearForTurn('ancient', 60)).toBeLessThan(1200);
  });

  it('formats BC, AD and the year zero boundary', () => {
    expect(formatYear(1244)).toBe('1244');
    expect(formatYear(1244.8)).toBe('1244');
    expect(formatYear(0)).toBe('1 BC');
    expect(formatYear(-311)).toBe('312 BC');
  });

  it('still dates an era it has never heard of', () => {
    // Community maps carry `custom`; a Chronicle without dates is not a
    // Chronicle, so this falls back rather than throwing or blanking.
    expect(chronicleDate('custom', 1)).toBe('1');
    expect(chronicleDate(undefined, 5)).toBe('5');
    expect(eraHasCalendar('custom')).toBe(false);
    expect(eraHasCalendar('ancient')).toBe(true);
  });
});
