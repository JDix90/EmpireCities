'use strict';
/*
 * Combat fairness simulation — reproducible companion to COMBAT-FAIRNESS-AUDIT.md.
 *
 * Implements the EXACT single-exchange rules from
 * backend/src/game-engine/combat/combatResolver.ts:
 *   attackerDice = override ?? min(attackers - 1, 3)
 *   defenderDice = override ?? min(defenders, 2)
 *   dice sorted descending; compare min(a,d) pairs; attacker wins ONLY on strict >
 *   (defender wins ties); losses capped so neither side is over-killed.
 * Bonus dice are modeled as flat additions to the base (base + bonus), exactly as
 * combatModifiers.ts computes finalAttacker/DefenderDiceOverride (no upper clamp
 * unless the anti-fortress cap is on — see PART E).
 *
 * Run:  node backend/scripts/combatFairnessSim.js
 * No dependencies. Uses Math.random for Monte Carlo (production uses crypto.randomInt;
 * the distribution is identical for fairness analysis).
 */

const d6 = () => 1 + Math.floor(Math.random() * 6);
function rollDesc(n) { const r = []; for (let i = 0; i < n; i++) r.push(d6()); return r.sort((a, b) => b - a); }
const P = (x) => (100 * x).toFixed(1) + '%';

// One exchange. cap (optional) = { maxA, maxD } clamps post-bonus dice.
function exchange(a, d, aB, dB, cap) {
  let aDice = Math.min(a - 1, 3) + aB;
  let dDice = Math.min(d, 2) + dB;
  if (cap) { aDice = Math.min(aDice, cap.maxA); dDice = Math.min(dDice, cap.maxD); }
  const A = rollDesc(aDice), D = rollDesc(dDice);
  let al = 0, dl = 0;
  const c = Math.min(A.length, D.length);
  for (let i = 0; i < c; i++) { if (A[i] > D[i]) dl++; else al++; }
  return { al: Math.min(al, a - 1), dl: Math.min(dl, d) };
}

// Full assault: attacker keeps attacking from one territory until capture or it
// can't continue (needs >= 2 units). Returns P(capture) over `trials`.
function assault(a0, d0, aB, dB, cap, trials = 120000) {
  let caps = 0;
  for (let t = 0; t < trials; t++) {
    let a = a0, d = d0;
    while (d >= 1 && a >= 2) {
      const { al, dl } = exchange(a, d, aB, dB, cap);
      a -= al; d -= dl;
      if (d <= 0) { caps++; break; }
    }
  }
  return caps / trials;
}

// Exact single-exchange expected losses (enumerate all dice outcomes).
function exact(aDice, dDice) {
  const cmp = Math.min(aDice, dDice);
  const total = Math.pow(6, aDice + dDice);
  let eAtt = 0, eDef = 0;
  const dice = new Array(aDice + dDice).fill(1);
  for (let n = 0; n < total; n++) {
    const a = dice.slice(0, aDice).slice().sort((x, y) => y - x);
    const d = dice.slice(aDice).slice().sort((x, y) => y - x);
    for (let i = 0; i < cmp; i++) { if (a[i] > d[i]) eDef++; else eAtt++; }
    let k = 0; while (k < dice.length) { if (++dice[k] <= 6) break; dice[k] = 1; k++; }
  }
  return { eAtt: eAtt / total, eDef: eDef / total };
}

console.log('=== PART A — single exchange, exact (defender wins ties) ===');
console.log('a×d | E[def loss] | E[att loss] | winner');
for (const [a, d] of [[3, 2], [2, 2], [1, 2], [4, 2], [3, 3], [3, 4]]) {
  const r = exact(a, d);
  const w = r.eDef > r.eAtt ? 'attacker' : 'defender';
  console.log(`${a}×${d} |   ${r.eDef.toFixed(3)}     |   ${r.eAtt.toFixed(3)}     | ${w}`);
}

console.log('\n=== PART B — full assault P(capture), base dice (no bonuses) ===');
const A = [10, 15, 20, 30], D = [5, 10, 15, 20];
console.log('Atk\\Def |' + D.map((d) => String(d).padStart(7)).join(''));
for (const a of A) console.log(String(a).padStart(6) + '  |' + D.map((d) => P(assault(a, d, 0, 0, null)).padStart(7)).join(''));

console.log('\n=== PART C — defender bonus dice swing harder than attacker (20 v 10) ===');
console.log('bonus | defender +N | attacker +N');
for (const n of [0, 1, 2, 3]) {
  console.log(`  +${n}  |   ${P(assault(20, 10, 0, n, null)).padStart(6)}    |   ${P(assault(20, 10, n, 0, null)).padStart(6)}`);
}

console.log('\n=== PART D — fortress scenarios (cap OFF) ===');
const F = [
  ['20 atk vs 5 def (4:1), +4 stacked', 20, 5, 0, 4],
  ['20 atk vs 8 def, +5 stacked', 20, 8, 0, 5],
  ['30 atk vs 8 def, +5 stacked', 30, 8, 0, 5],
];
for (const [l, a, d, aB, dB] of F) console.log('  ' + l.padEnd(36) + 'P(cap)=' + P(assault(a, d, aB, dB, null)));

console.log('\n=== PART E — anti-fortress cap (combat_dice_cap_enabled), atk≤5 def≤4 ===');
const CAP = { maxA: 5, maxD: 4 };
console.log('Defender bonus stacking, 20 v 10:   cap OFF -> cap ON');
for (const n of [0, 1, 2, 3, 4, 5]) {
  console.log(`  +${n} def | ${P(assault(20, 10, 0, n, null)).padStart(6)} -> ${P(assault(20, 10, 0, n, CAP)).padStart(6)}`);
}
console.log('Fortress scenarios:                 cap OFF -> cap ON');
for (const [l, a, d, aB, dB] of F) {
  console.log('  ' + l.padEnd(36) + P(assault(a, d, aB, dB, null)).padStart(6) + ' -> ' + P(assault(a, d, aB, dB, CAP)).padStart(6));
}
console.log('Sanity — vanilla fights unchanged:  cap OFF -> cap ON');
for (const [a, d] of [[10, 10], [20, 10], [15, 20]]) {
  console.log(`  ${a}v${d}`.padEnd(38) + P(assault(a, d, 0, 0, null)).padStart(6) + ' -> ' + P(assault(a, d, 0, 0, CAP)).padStart(6));
}
console.log('\nDone.');
