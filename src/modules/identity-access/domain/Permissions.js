export const PERMISSIONS = Object.freeze({
  PROLIFIC_WOMAN_LEADS_VIEW: 'prolificwoman.leads.view',
});

export const ALLOWED_PERMISSIONS = Object.freeze(Object.values(PERMISSIONS));

export const normalizePermissions = (value) => {
  const items = Array.isArray(value) ? value : [];
  return [
    ...new Set(
      items
        .map((item) => String(item ?? '').trim())
        .filter((item) => ALLOWED_PERMISSIONS.includes(item)),
    ),
  ];
};

export const hasPermission = (doc, permission) =>
  normalizePermissions(doc?.permissions).includes(permission);
