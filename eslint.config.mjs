import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

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
    plugins: {
      'react-hooks': reactHooks,
    },
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
  {
    // packages/warfront-sim — determinism guard, part 1 (every file in the package,
    // tests included). The simulation must reproduce a match from a seed plus a
    // command log on the match host, in a replaying browser and in the headless lab.
    // One unseeded draw or one clock read makes that impossible, and the divergence
    // surfaces thousands of ticks later as an unexplained desync — so the linter refuses
    // the input instead.
    files: ['packages/warfront-sim/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Unseeded randomness breaks replays. Draw from the sim\'s Rng.' },
        { object: 'Date', property: 'now', message: 'Wall-clock time is not simulation state. Use the tick counter.' },
        { object: 'performance', property: 'now', message: 'Wall-clock time is not simulation state. Use the tick counter.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Wall-clock time is not simulation state. Use the tick counter.' },
        { selector: "CallExpression[callee.name='Date']", message: 'Wall-clock time is not simulation state. Use the tick counter.' },
      ],
    },
  },
  {
    // packages/warfront-sim — determinism guard, part 2 (simulation sources only).
    // Convention: every simulated quantity is an integer; fractions are 16.16 fixed
    // point (src/fixed.ts, the one file allowed to divide). IEEE add/sub/mul/div are
    // reproducible everywhere, but Math.sin/pow/exp are not correctly rounded across
    // engines, and a float that reaches the state makes two hosts drift apart silently.
    // Tests are exempt from this part only: they compute BigInt references and float
    // bounds to check the integer code against.
    files: ['packages/warfront-sim/src/**/*.ts'],
    ignores: ['packages/warfront-sim/src/**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Unseeded randomness breaks replays. Draw from the sim\'s Rng.' },
        { object: 'Date', property: 'now', message: 'Wall-clock time is not simulation state. Use the tick counter.' },
        { object: 'performance', property: 'now', message: 'Wall-clock time is not simulation state. Use the tick counter.' },
        { object: 'Math', property: 'sqrt', message: 'Float result. Use isqrt / fpSqrt / fpLength from src/fixed.ts.' },
        { object: 'Math', property: 'sin', message: 'Not correctly rounded across engines. Use integer tables or fixed-point.' },
        { object: 'Math', property: 'cos', message: 'Not correctly rounded across engines. Use integer tables or fixed-point.' },
        { object: 'Math', property: 'tan', message: 'Not correctly rounded across engines. Use integer tables or fixed-point.' },
        { object: 'Math', property: 'atan', message: 'Not correctly rounded across engines. Use integer tables or fixed-point.' },
        { object: 'Math', property: 'atan2', message: 'Not correctly rounded across engines. Use integer tables or fixed-point.' },
        { object: 'Math', property: 'exp', message: 'Not correctly rounded across engines. Use fixed-point.' },
        { object: 'Math', property: 'log', message: 'Not correctly rounded across engines. Use fixed-point.' },
        { object: 'Math', property: 'pow', message: 'Not correctly rounded across engines. Use integer multiplication.' },
        { object: 'Math', property: 'hypot', message: 'Float result. Use fpLength from src/fixed.ts.' },
        { object: 'Math', property: 'cbrt', message: 'Float result. Use fixed-point.' },
        { object: 'Math', property: 'fround', message: 'Float result. Use fixed-point.' },
      ],
      'no-restricted-syntax': [
        'error',
        { selector: "NewExpression[callee.name='Date']", message: 'Wall-clock time is not simulation state. Use the tick counter.' },
        { selector: "CallExpression[callee.name='Date']", message: 'Wall-clock time is not simulation state. Use the tick counter.' },
        {
          selector: 'Literal[raw=/^[0-9]*\\.[0-9]+([eE][-+]?[0-9]+)?$/]',
          message: 'Float literal. Every simulated quantity is an integer; write fractions as 16.16 fixed (fpRatio(3, 10), FP_HALF).',
        },
        { selector: "BinaryExpression[operator='/']", message: 'Division yields floats. Use idiv / fpDiv / fpRatio from src/fixed.ts.' },
        { selector: "AssignmentExpression[operator='/=']", message: 'Division yields floats. Use idiv / fpDiv from src/fixed.ts.' },
        { selector: "BinaryExpression[operator='**']", message: 'Exponentiation yields floats. Use integer multiplication.' },
        { selector: "AssignmentExpression[operator='**=']", message: 'Exponentiation yields floats. Use integer multiplication.' },
      ],
    },
  },
);
