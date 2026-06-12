/** Player palette hex → plain-English name (see the colors array in games.routes.ts). */
const PALETTE_NAMES: Record<string, string> = {
  '#e74c3c': 'red',
  '#3498db': 'blue',
  '#2ecc71': 'green',
  '#f39c12': 'orange',
  '#9b59b6': 'purple',
  '#1abc9c': 'teal',
  '#e67e22': 'amber',
  '#ecf0f1': 'white',
};

export function colorDisplayName(hex?: string | null): string {
  return PALETTE_NAMES[(hex ?? '').toLowerCase()] ?? 'your color';
}
