'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createPlatform, load, fakeIncident } = require('./platform-mock');

function setup(db = {}) {
    const platform = createPlatform(db);
    load(platform.context, 'src/script_includes/IncidentTriage.js');
    const triage = vm.runInContext('new IncidentTriage()', platform.context);
    return { triage, platform };
}

test('classify routes by keyword to the right group', () => {
    const { triage } = setup();
    assert.equal(triage.classify('VPN keeps disconnecting').group, 'Network Support');
    assert.equal(triage.classify('Oracle deadlock on orders').group, 'Database Admin');
    assert.equal(triage.classify('App throws exception on login').group, 'Application Support');
});

test('classify falls back to Service Desk', () => {
    const { triage } = setup();
    assert.deepEqual({ ...triage.classify('Need a new monitor') }, { group: 'Service Desk', matched: null });
});

test('keywords match whole words only', () => {
    const { triage } = setup();
    // "down" must not fire inside "download", "error" not inside "terror"
    assert.equal(triage.suggestPriority(3, 3, 'download is slow'), 5);
    assert.equal(triage.classify('terror in the hallway').group, 'Service Desk');
});

test('priority follows the impact/urgency matrix', () => {
    const { triage } = setup();
    assert.equal(triage.suggestPriority(1, 1, ''), 1);
    assert.equal(triage.suggestPriority(1, 2, ''), 2);
    assert.equal(triage.suggestPriority(2, 2, ''), 3);
    assert.equal(triage.suggestPriority(2, 3, ''), 4);
    assert.equal(triage.suggestPriority(3, 3, ''), 5);
});

test('critical wording lifts priority to at least P2', () => {
    const { triage } = setup();
    assert.equal(triage.suggestPriority(3, 3, 'production outage in checkout'), 2);
    // already P1 stays P1
    assert.equal(triage.suggestPriority(1, 1, 'production outage'), 1);
});

test('findDuplicate returns the open incident number', () => {
    const { triage } = setup({
        incident: [
            { number: 'INC001', active: true, caller_id: 'u1', short_description: 'VPN down' },
            { number: 'INC002', active: false, caller_id: 'u1', short_description: 'Printer jam' }
        ]
    });
    assert.equal(triage.findDuplicate('u1', 'VPN down'), 'INC001');
    assert.equal(triage.findDuplicate('u1', 'Printer jam'), null); // closed
    assert.equal(triage.findDuplicate('u2', 'VPN down'), null);    // other caller
    assert.equal(triage.findDuplicate(null, 'VPN down'), null);
});

test('applyTo assigns group, raises priority and writes one work note', () => {
    const { triage } = setup({ sys_user_group: [{ name: 'Network Support', sys_id: 'grp-net' }], incident: [] });
    const inc = fakeIncident({
        short_description: 'VPN outage for the whole office',
        impact: '2', urgency: '2', priority: '3', caller_id: 'u1'
    });
    triage.applyTo(inc);
    assert.equal(inc.data.assignment_group, 'grp-net');
    assert.equal(inc.data.priority, '2'); // P3 raised to P2 by "outage"
    assert.match(inc.work_notes, /Auto-assigned to Network Support \(matched "vpn"\)/);
    assert.match(inc.work_notes, /Priority raised to 2/);
});

test('applyTo never overrides a manually chosen group or lowers priority', () => {
    const { triage } = setup({ sys_user_group: [{ name: 'Network Support', sys_id: 'grp-net' }], incident: [] });
    const inc = fakeIncident({
        short_description: 'VPN slow', impact: '3', urgency: '3', priority: '1',
        assignment_group: 'grp-manual', caller_id: 'u1'
    });
    triage.applyTo(inc);
    assert.equal(inc.data.assignment_group, 'grp-manual');
    assert.equal(inc.data.priority, '1');
    assert.equal(inc.work_notes, undefined);
});

test('applyTo notes a possible duplicate', () => {
    const { triage } = setup({
        sys_user_group: [],
        incident: [{ number: 'INC009', active: true, caller_id: 'u1', short_description: 'Cannot print' }]
    });
    const inc = fakeIncident({
        short_description: 'Cannot print', impact: '3', urgency: '3', priority: '5',
        caller_id: 'u1', assignment_group: 'g'
    });
    triage.applyTo(inc);
    assert.match(inc.work_notes, /Possible duplicate of INC009/);
});
