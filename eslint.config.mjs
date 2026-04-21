import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Incremental adoption: legacy hotspots are ignored until refactored (see 90-day roadmap).
 * New modules should stay lint-clean.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'packages/shared/dist/**',
      // Legacy monolith — extract in Phase B; remove from ignores when modularized
      'backend/src/sockets/gameSocket.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['backend/**/*.ts', 'frontend/**/*.{ts,tsx}', 'packages/shared/**/*.ts'],
    rules: {
      // Incremental cleanup — tighten to 'error' + max-warnings 0 over time
      'no-useless-assignment': 'off',
      'no-empty': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
