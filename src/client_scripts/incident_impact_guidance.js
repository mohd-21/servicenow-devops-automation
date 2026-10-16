/**
 * Client Script: Guide the caller on high-impact incidents
 * Table: Incident [incident]    Type: onChange    Field: urgency
 */
function onChange(control, oldValue, newValue, isLoading, isTemplate) {
    if (isLoading || newValue === '') {
        return;
    }

    g_form.hideFieldMsg('urgency', true);

    if (newValue === '1' && g_form.getValue('impact') === '1') {
        g_form.showFieldMsg(
            'urgency',
            'This will page the on-call team. Describe the business impact in the description.',
            'info'
        );
        g_form.setMandatory('description', true);
    } else {
        g_form.setMandatory('description', false);
    }
}
