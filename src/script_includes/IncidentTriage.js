/**
 * Script Include: IncidentTriage
 * Accessible from: All application scopes (or this scope only)
 *
 * Classifies a new incident, suggests a priority, and flags likely duplicates.
 * Written in ES5 style so it runs in any ServiceNow release.
 */
var IncidentTriage = Class.create();
IncidentTriage.prototype = {
    initialize: function () {},

    DEFAULT_GROUP: 'Service Desk',

    // First matching rule wins, so put the most specific groups first.
    GROUP_RULES: [
        { group: 'Network Support', keywords: ['vpn', 'wifi', 'network', 'dns', 'firewall', 'latency'] },
        { group: 'Database Admin', keywords: ['database', 'sql', 'oracle', 'deadlock', 'replication'] },
        { group: 'Application Support', keywords: ['crash', 'exception', 'error', 'timeout', '500'] }
    ],

    // Wording that signals business-critical impact.
    CRITICAL_TERMS: ['outage', 'down', 'data loss', 'security breach', 'production'],

    /** Pick an assignment group from free text. */
    classify: function (text) {
        for (var i = 0; i < this.GROUP_RULES.length; i++) {
            var rule = this.GROUP_RULES[i];
            var hit = this._firstTerm(text, rule.keywords);
            if (hit) {
                return { group: rule.group, matched: hit };
            }
        }
        return { group: this.DEFAULT_GROUP, matched: null };
    },

    /**
     * Priority 1 (critical) to 5 (planning), using the standard
     * impact + urgency - 1 matrix. Critical wording lifts it to at least P2.
     */
    suggestPriority: function (impact, urgency, text) {
        var i = parseInt(impact, 10) || 3;
        var u = parseInt(urgency, 10) || 3;
        var priority = Math.min(5, Math.max(1, i + u - 1));
        if (this._firstTerm(text, this.CRITICAL_TERMS)) {
            priority = Math.min(priority, 2);
        }
        return priority;
    },

    /** Number of an open incident from the same caller with the same summary, or null. */
    findDuplicate: function (callerId, shortDescription) {
        if (!callerId || !shortDescription) {
            return null;
        }
        var gr = new GlideRecord('incident');
        gr.addQuery('active', true);
        gr.addQuery('caller_id', callerId);
        gr.addQuery('short_description', shortDescription);
        gr.setLimit(1);
        gr.query();
        return gr.next() ? gr.getValue('number') : null;
    },

    /** Work out the triage result without changing the record. */
    triage: function (current) {
        var summary = current.getValue('short_description') || '';
        var text = summary + ' ' + (current.getValue('description') || '');
        var classification = this.classify(text);
        return {
            group: classification.group,
            matched: classification.matched,
            priority: this.suggestPriority(current.getValue('impact'), current.getValue('urgency'), text),
            duplicateOf: this.findDuplicate(current.getValue('caller_id'), summary)
        };
    },

    /**
     * Apply the triage result to the record (call from a "before insert" Business Rule).
     * Never overrides a group a person already chose, and only ever raises priority.
     */
    applyTo: function (current) {
        var result = this.triage(current);
        var notes = [];

        if (!current.getValue('assignment_group')) {
            var groupId = this._groupSysId(result.group);
            if (groupId) {
                current.setValue('assignment_group', groupId);
                notes.push('Auto-assigned to ' + result.group +
                    (result.matched ? ' (matched "' + result.matched + '")' : ' (default)'));
            }
        }

        var currentPriority = parseInt(current.getValue('priority'), 10) || 5;
        if (result.priority < currentPriority) {
            current.setValue('priority', String(result.priority));
            notes.push('Priority raised to ' + result.priority + ' based on impact/urgency and wording');
        }

        if (result.duplicateOf) {
            notes.push('Possible duplicate of ' + result.duplicateOf);
        }

        if (notes.length) {
            current.work_notes = '[Auto-triage] ' + notes.join('. ') + '.';
        }
        return result;
    },

    _groupSysId: function (name) {
        var gr = new GlideRecord('sys_user_group');
        gr.addQuery('name', name);
        gr.setLimit(1);
        gr.query();
        return gr.next() ? gr.getUniqueValue() : null;
    },

    // Whole-word match so "down" does not fire on "download".
    _firstTerm: function (text, terms) {
        var haystack = (text || '').toLowerCase();
        for (var i = 0; i < terms.length; i++) {
            if (new RegExp('\\b' + terms[i] + '\\b').test(haystack)) {
                return terms[i];
            }
        }
        return null;
    },

    type: 'IncidentTriage'
};
