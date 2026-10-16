'use strict';
/**
 * Minimal in-memory stand-ins for the ServiceNow server APIs these scripts use
 * (Class, GlideRecord, GlideDateTime, gs), so the logic can be unit tested in Node.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const NOW = '2026-10-16 12:00:00';

function createPlatform(db) {
    const updates = [];

    class GlideRecord {
        constructor(table) {
            this.table = table;
            this.filters = [];
            this.limit = Infinity;
            this.results = [];
            this.index = -1;
        }
        addQuery(field, a, b) {
            const [op, value] = b === undefined ? ['=', a] : [a, b];
            this.filters.push({ field, op, value });
        }
        setLimit(n) { this.limit = n; }
        query() {
            const rows = db[this.table] || [];
            this.results = rows
                .filter((row) => this.filters.every(({ field, op, value }) => {
                    const actual = row[field];
                    switch (op) {
                        case '=': return String(actual) === String(value);
                        case '<': return String(actual) < String(value);
                        case '<=': return Number(actual) <= Number(value);
                        default: throw new Error('unsupported operator ' + op);
                    }
                }))
                .slice(0, this.limit);
            this.index = -1;
        }
        next() {
            this.index += 1;
            this.row = this.results[this.index];
            return this.index < this.results.length;
        }
        getValue(field) { return this.row[field]; }
        getUniqueValue() { return this.row.sys_id; }
        update() { updates.push({ number: this.row.number, work_notes: this.work_notes }); }
    }

    class GlideDateTime {
        constructor() { this.date = new Date(NOW.replace(' ', 'T') + 'Z'); }
        addSeconds(s) { this.date = new Date(this.date.getTime() + s * 1000); }
        getValue() { return this.date.toISOString().slice(0, 19).replace('T', ' '); }
    }

    const logs = [];
    const context = {
        Class: { create: () => function ctor() { if (this.initialize) this.initialize.apply(this, arguments); } },
        GlideRecord,
        GlideDateTime,
        gs: { info: (m) => logs.push(m) },
        console
    };
    vm.createContext(context);
    return { context, updates, logs };
}

/** Load a ServiceNow script file into the sandbox so its top-level `var` becomes a global. */
function load(context, relativePath) {
    const file = path.join(__dirname, '..', relativePath);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

/** A fake `current` incident record. */
function fakeIncident(fields) {
    const data = Object.assign({}, fields);
    return {
        data,
        getValue: (f) => (data[f] === undefined ? null : data[f]),
        setValue(f, v) { data[f] = v; },
        work_notes: undefined
    };
}

module.exports = { createPlatform, load, fakeIncident, NOW };
