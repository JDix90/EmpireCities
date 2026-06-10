/** "1 troop", "3 troops" — count + correctly pluralized noun. */
export function plural(count: number, noun: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? noun : pluralForm ?? `${noun}s`}`;
}
