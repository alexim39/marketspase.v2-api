export const ProlificWomanLeadMapper = {
  toDomain(doc) {
    const row = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    return {
      id: String(row._id),
      name: row.name,
      phone: row.phone,
      location: row.location,
      readyToBeMentored: row.readyToBeMentored,
      headOfficeInvite: row.headOfficeInvite,
      availability: row.availability,
      submittedAt: row.submittedAt,
      source: row.source ?? 'prolificwoman-web',
      status: row.status ?? 'new',
      acceptedAt: row.acceptedAt ?? null,
      acceptedByPartnerId: row.acceptedByPartnerId ? String(row.acceptedByPartnerId) : null,
      prospectId: row.prospectId ? String(row.prospectId) : null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null,
    };
  },

  toPersistence(entity) {
    return {
      name: entity.name,
      phone: entity.phone,
      location: entity.location,
      readyToBeMentored: entity.readyToBeMentored,
      headOfficeInvite: entity.headOfficeInvite,
      availability: entity.availability,
      submittedAt: entity.submittedAt,
      source: entity.source,
    };
  },
};
