/**
 * Script Include: StaleIncidentEscalator
 *
 * Finds active P1/P2 incidents with no update for N hours and adds a work note,
 * which also fires the notifications attached to that table. Because the update
 * resets sys_updated_on, an incident that stays stale is re-flagged every N hours,
 * not on every run.
 */
var StaleIncidentEscalator = Class.create();
StaleIncidentEscalator.prototype = {
    initialize: function (hours, batchLimit) {
        this.hours = hours || 4;
        this.batchLimit = batchLimit || 200;
    },

    /** @returns {number} how many incidents were flagged */
    run: function () {
        var cutoff = new GlideDateTime();
        cutoff.addSeconds(-this.hours * 3600);

        var gr = new GlideRecord('incident');
        gr.addQuery('active', true);
        gr.addQuery('priority', '<=', 2);
        gr.addQuery('sys_updated_on', '<', cutoff.getValue());
        gr.setLimit(this.batchLimit);
        gr.query();

        var flagged = 0;
        while (gr.next()) {
            gr.work_notes = '[Auto-escalation] No update for ' + this.hours +
                ' hours on a P' + gr.getValue('priority') + ' incident. Please update or escalate.';
            gr.update();
            flagged++;
        }
        gs.info('StaleIncidentEscalator flagged ' + flagged + ' incident(s)');
        return flagged;
    },

    type: 'StaleIncidentEscalator'
};
