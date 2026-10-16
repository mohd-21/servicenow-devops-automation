'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createPlatform, load } = require('./platform-mock');

// "now" in the mock is 2026-10-16 12:00:00, so a 4 hour cutoff is 08:00:00.
const incidents = [
    { number: 'INC1', active: true, priority: 1, sys_updated_on: '2026-10-16 05:00:00' }, // stale P1
    { number: 'INC2', active: true, priority: 2, sys_updated_on: '2026-10-16 07:59:59' }, // stale P2
    { number: 'INC3', active: true, priority: 2, sys_updated_on: '2026-10-16 09:00:00' }, // fresh
    { number: 'INC4', active: true, priority: 3, sys_updated_on: '2026-10-15 01:00:00' }, // stale but P3
    { number: 'INC5', active: false, priority: 1, sys_updated_on: '2026-10-14 01:00:00' } // closed
];

function run(hours, limit) {
    const platform = createPlatform({ incident: incidents });
    load(platform.context, 'src/script_includes/StaleIncidentEscalator.js');
    const count = vm.runInContext(`new StaleIncidentEscalator(${hours}, ${limit}).run()`, platform.context);
    return { count, ...platform };
}

test('flags only active P1/P2 incidents older than the threshold', () => {
    const { count, updates } = run(4);
    assert.equal(count, 2);
    assert.deepEqual(updates.map((u) => u.number), ['INC1', 'INC2']);
});

test('work note names the priority and the threshold', () => {
    const { updates } = run(4);
    assert.match(updates[0].work_notes, /No update for 4 hours on a P1 incident/);
});

test('a longer threshold flags fewer incidents', () => {
    const { count } = run(6); // cutoff 06:00 -> only INC1
    assert.equal(count, 1);
});

test('respects the batch limit', () => {
    const { count } = run(4, 1);
    assert.equal(count, 1);
});
