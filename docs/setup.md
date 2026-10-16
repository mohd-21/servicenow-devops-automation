# Installing the scripts in ServiceNow

Use a personal developer instance (free at developer.servicenow.com) first.

## 1. Script Includes

**System Definition > Script Includes > New**

| Name | Source file | Client callable |
|---|---|---|
| `IncidentTriage` | `src/script_includes/IncidentTriage.js` | No |
| `StaleIncidentEscalator` | `src/script_includes/StaleIncidentEscalator.js` | No |

Paste the file contents into the Script field and set Accessible from to *All application scopes*.

## 2. Business Rule

**System Definition > Business Rules > New**

- Name: `Auto-triage new incidents`
- Table: `Incident [incident]`
- When: `before`, tick **Insert** only
- Script: `src/business_rules/triage_new_incident.js`

## 3. Assignment groups

The triage rules assign by group **name**. Create (or rename) these groups under **User Administration > Groups**:
`Network Support`, `Database Admin`, `Application Support`, `Service Desk`.
If a group does not exist, that step is skipped and no error is raised.

## 4. Client Script

**System Definition > Client Scripts > New**: Table `incident`, Type `onChange`, Field name `urgency`.
Script: `src/client_scripts/incident_impact_guidance.js`.

## 5. Scheduled job

**System Definition > Scheduled Jobs > New > Automatically run a script of your choosing**:
run every 30 minutes, script: `src/scheduled_jobs/escalate_stale_incidents.js`.

## 6. Integration user for the pipeline

Create a dedicated user (for example `svc_github_pipeline`) with **web service access only** and the minimum
roles needed to create and update `change_request` records. Do not reuse an admin account. Store the
credentials as GitHub Actions secrets `SN_INSTANCE`, `SN_USER` and `SN_PASSWORD`.

## Adapting the change request fields

Change models differ between instances. `build_create_payload` and `build_close_payload` in
`pipeline/servicenow_change.py` hold every field that is sent. If your instance uses Change Models,
mandatory fields or different state values, adjust them there. The unit tests mock the HTTP layer, so
run one real change against your dev instance before relying on it.
