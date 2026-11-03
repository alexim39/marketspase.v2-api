const str = (v) => (v === undefined || v === null ? v : String(v));

/** Data Mapper — Mongoose (lean) objects <-> domain objects with string ids. */
export const ProspectMapper = {
  toDomain(doc) {
    if (!doc) return null;
    const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    return {
      id: str(o._id),
      prospectName: o.prospectName,
      prospectSurname: o.prospectSurname,
      prospectPhone: o.prospectPhone,
      prospectEmail: o.prospectEmail,
      prospectSource: o.prospectSource,
      relationship: o.relationship ?? 'Other',
      priority: o.priority ?? 'normal',
      bestTimeToCall: o.bestTimeToCall ?? '',
      consentToContact: o.consentToContact ?? false,
      notes: o.notes ?? '',
      listBatch: o.listBatch ?? null,
      listSubmitted: o.listSubmitted ?? false,
      listSubmittedAt: o.listSubmittedAt ?? null,
      partnerId: str(o.partnerId),
      surverId: o.surverId === undefined || o.surverId === null ? o.surverId : str(o.surverId),
      claimedAt: o.claimedAt ?? null,
      claimFeePaid: o.claimFeePaid ?? null,
      poolReturns: o.poolReturns ?? null,
      campaignId: o.campaignId === undefined || o.campaignId === null ? o.campaignId ?? null : str(o.campaignId),
      survey: o.survey,
      role: o.role,
      status: o.status ? { ...o.status } : o.status,
      communications: (o.communications ?? []).map((c) => ({ ...c, _id: str(c._id), id: str(c._id) })),
      stageHistory: (o.stageHistory ?? []).map((h) => ({ ...h, _id: str(h._id), id: str(h._id) })),
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    };
  },

  toPersistence(entity) {
    const { ...rest } = entity;
    return { ...rest };
  },
};
