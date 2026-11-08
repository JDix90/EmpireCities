import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CountrySearch from './CountrySearch';
import type { CountryInfo } from './editorTemplates';

const geometry: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const country = (code: string, name: string, subregion = 'Western Africa'): CountryInfo => ({
  code, name, continent: 'Africa', subregion, areaKm2: 100_000, label: [0.5, 0.5], geometry,
});
const COUNTRIES = [country('ML', 'Mali'), country('MW', 'Malawi', 'Eastern Africa'), country('NE', 'Niger'), country('SO', 'Somalia', 'Eastern Africa')];

describe('CountrySearch', () => {
  it('matches by name prefix first, then by code and by substring, and picks with Enter', () => {
    const onPick = vi.fn();
    render(<CountrySearch countries={COUNTRIES} usedCodes={new Set()} onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'mal' } });
    const options = screen.getAllByRole('option');
    // Prefix matches first, then the substring match on Somalia.
    expect(options.map((o) => o.textContent)).toEqual(['MaliMLWestern Africa', 'MalawiMWEastern Africa', 'SomaliaSOEastern Africa']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ code: 'MW' }));
    expect((input as HTMLInputElement).value).toBe('');

    fireEvent.change(input, { target: { value: 'so' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['SomaliaSOEastern Africa']);
  });

  it('shows a country already on the map but will not add it twice', () => {
    const onPick = vi.fn();
    render(<CountrySearch countries={COUNTRIES} usedCodes={new Set(['ML'])} onPick={onPick} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'mali' } });
    const [mali] = screen.getAllByRole('option');
    expect(mali).toHaveTextContent('on the map');
    fireEvent.mouseDown(mali);
    expect(onPick).not.toHaveBeenCalled();
  });
});
