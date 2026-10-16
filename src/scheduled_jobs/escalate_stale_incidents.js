/**
 * Scheduled Script Execution: Escalate stale P1/P2 incidents
 * Run: Periodically, every 30 minutes
 */
new StaleIncidentEscalator(4).run();
