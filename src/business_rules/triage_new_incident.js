/**
 * Business Rule: Auto-triage new incidents
 * Table: Incident [incident]
 * When: before    Insert: true    Update: false
 * Condition: (none)
 *
 * Thin wrapper on purpose: the logic lives in the IncidentTriage Script Include
 * so it can be unit tested outside the platform.
 */
(function executeRule(current, previous /*null when async*/) {
    new IncidentTriage().applyTo(current);
})(current, previous);
