/*
 * Case Files generator/solver checks.
 *
 * Run: node scripts/test-mystery.js [seed-count-per-difficulty]
 *
 * The game must never ship an ambiguous case: every generated instance has
 * exactly one assignment consistent with its clues, and that assignment is the
 * stored solution. This is the fairness guarantee the player relies on.
 */
'use strict';

const assert = require('assert');
const engine = require('../js/mystery-engine.js');

const PER_DIFFICULTY = Math.max(20, Number(process.argv[2] || 250));
const DIFFICULTIES = ['easy', 'normal', 'hard'];

let checked = 0;

for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < PER_DIFFICULTY; i++) {
        const seed = 'mystery-test-' + difficulty + '-' + i;
        const c = engine.generateCase({ seed, difficulty });

        assert.ok(c && c.suspects.length === c.rooms.length && c.rooms.length === c.times.length,
            'case categories must be the same size: ' + seed);
        assert.ok(c.clues.length >= 3, 'case must have clues: ' + seed);
        assert.ok(c.clues.length <= 26, 'case has too many clues: ' + seed);

        const proof = engine.solve(c);
        assert.strictEqual(proof.unique, true, 'case is ambiguous: ' + seed);
        assert.strictEqual(proof.solutions.length, 1, 'case has multiple solutions: ' + seed);

        const sol = proof.solutions[0];
        const culpritIndex = c.suspects.findIndex(s => s.id === c.solution.suspectId);
        const roomIndex = c.rooms.findIndex(r => r.id === c.solution.roomId);
        const timeIndex = c.times.findIndex(t => t.id === c.solution.timeId);
        assert.ok(culpritIndex >= 0 && roomIndex >= 0 && timeIndex >= 0, 'solution ids must exist: ' + seed);
        assert.strictEqual(sol.roomOf[culpritIndex], roomIndex, 'solution room mismatch: ' + seed);
        assert.strictEqual(sol.timeOf[culpritIndex], timeIndex, 'solution time mismatch: ' + seed);

        // Every clue must be true in the unique solution and have a stable
        // display string; a false clue would make the case unfair.
        const seen = new Set();
        for (const clue of c.clues) {
            assert.ok(clue.text && clue.text.length > 8, 'clue text missing: ' + seed);
            assert.ok(!seen.has(clue.text), 'duplicate clue text: ' + seed + ' / ' + clue.text);
            seen.add(clue.text);
            assert.ok(engine._internals.clueTrue(clue, sol.roomOf, sol.timeOf),
                'false clue: ' + seed + ' / ' + clue.text);
            assert.ok(clue.sourceType === 'suspect' || clue.sourceType === 'room',
                'clue source type: ' + seed);
            assert.ok(clue.sourceId, 'clue source id: ' + seed);
        }

        // Source ids must resolve to a real suspect/room card, otherwise a clue
        // could be unreachable in the interview screen.
        for (const clue of c.clues) {
            if (clue.sourceType === 'suspect') {
                assert.ok(c.suspects.some(s => s.id === clue.sourceId), 'bad suspect source: ' + seed);
            } else {
                assert.ok(c.rooms.some(r => r.id === clue.sourceId), 'bad room source: ' + seed);
            }
        }

        assert.strictEqual(engine.checkAccusation(c, c.solution.suspectId), true);
        const other = c.suspects.find(s => s.id !== c.solution.suspectId);
        if (other) assert.strictEqual(engine.checkAccusation(c, other.id), false);

        checked++;
    }
}

// Determinism: same seed + difficulty is the same case.
const a = engine.generateCase({ seed: 'repeat', difficulty: 'normal' });
const b = engine.generateCase({ seed: 'repeat', difficulty: 'normal' });
assert.strictEqual(a.title, b.title);
assert.deepStrictEqual(a.solution, b.solution);
assert.strictEqual(a.clues.map(c => c.text).join('|'), b.clues.map(c => c.text).join('|'));

// Different seeds should not all collapse to one solution.
const solutions = new Set();
for (let i = 0; i < 40; i++) {
    const c = engine.generateCase({ seed: 'variety-' + i, difficulty: 'normal' });
    solutions.add(c.setting + ':' + c.solution.suspectId + ':' + c.solution.roomId);
}
assert.ok(solutions.size > 10, 'generator lacks variety');

// Scoring is monotonic and floored.
const base = engine.scoreCase({ elapsedMs: 0, hintsUsed: 0, wrongAttempts: 0 });
assert.ok(base >= engine.scoreCase({ elapsedMs: 0, hintsUsed: 1, wrongAttempts: 0 }));
assert.ok(base >= engine.scoreCase({ elapsedMs: 0, hintsUsed: 0, wrongAttempts: 1 }));
assert.ok(base >= engine.scoreCase({ elapsedMs: 600000, hintsUsed: 0, wrongAttempts: 0 }));
assert.strictEqual(engine.scoreCase({ elapsedMs: 999999999, hintsUsed: 99, wrongAttempts: 99 }), 100);

// Daily seed is stable within a day and changes across days.
assert.strictEqual(engine.dailySeed(new Date(2026, 10, 25)), '2026-11-25');
assert.strictEqual(engine.dailySeed(new Date(2026, 10, 26)), '2026-11-26');

console.log('PASS - Case Files (' + checked + ' generated cases, ' + PER_DIFFICULTY + ' per difficulty)');
