/*
 * Validate the bundled nonogram preview solutions.
 * Run: node scripts/test-nonograms.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const puzzles = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'nonograms.json'), 'utf8'));
const html = fs.readFileSync(path.join(__dirname, '..', 'nonograms.html'), 'utf8');
assert.ok(Array.isArray(puzzles) && puzzles.length, 'nonograms.json must contain puzzles');

function clues(line) {
    const out = [];
    let run = 0;
    for (const v of line) {
        if (v) run++;
        else if (run) { out.push(run); run = 0; }
    }
    if (run) out.push(run);
    return out;
}

for (const p of puzzles) {
    assert.ok(Array.isArray(p.solution), p.filename + ' needs a solution');
    assert.strictEqual(p.solution.length, Number(p.height), p.filename + ' row count');
    for (const row of p.solution) {
        assert.strictEqual(typeof row, 'string', p.filename + ' row type');
        assert.strictEqual(row.length, Number(p.width), p.filename + ' row width');
        assert.ok(/^[01]+$/.test(row), p.filename + ' row bits');
    }
    assert.deepStrictEqual(
        p.solution.map(row => clues(Array.from(row, Number))),
        p.rows,
        p.filename + ' row clues'
    );
    const cols = [];
    for (let c = 0; c < Number(p.width); c++) {
        cols.push(clues(p.solution.map(row => Number(row[c]))));
    }
    assert.deepStrictEqual(cols, p.columns, p.filename + ' column clues');
}

assert.ok(/pData\.solved && puzzle\.solution/.test(html), 'preview must only render a solution after the puzzle is solved');

console.log('PASS - nonogram solutions (' + puzzles.length + ' puzzles)');
