/**
 * Parses the model's final ```actions block into approval proposals.
 *
 * A proposal may reference a live opportunity (`opportunityId`) or a page
 * capability (`capability`). The use case maps it to a safe action; anything
 * unknown is dropped before it reaches the UI.
 */
export const MAX_PROPOSALS = 3;

const text = (value, max) => String(value ?? '').trim().slice(0, max);

const clean = (row) => {
  if (!row || typeof row !== 'object') return null;
  const opportunityId = text(row.opportunityId, 120) || null;
  const capability = text(row.capability, 80) || null;
  if (!opportunityId && !capability) return null;
  return {
    ...(opportunityId ? { opportunityId } : {}),
    ...(capability ? { capability } : {}),
    label: text(row.label, 60),
    summary: text(row.summary, 220),
    draft: text(row.draft, 960),
  };
};

export const extractProposalBlock = (reply) => {
  const raw = String(reply ?? '');
  const match = raw.match(/```actions\s*([\s\S]*?)```\s*$/);
  if (!match) return { text: raw.trim(), proposals: [] };

  let parsed = [];
  try {
    const data = JSON.parse(match[1].trim());
    if (Array.isArray(data)) parsed = data;
  } catch {
    parsed = [];
  }

  const proposals = [];
  const seen = new Set();
  for (const row of parsed) {
    const proposal = clean(row);
    if (!proposal) continue;
    const key = proposal.opportunityId ?? proposal.capability;
    if (seen.has(key)) continue;
    seen.add(key);
    proposals.push(proposal);
    if (proposals.length >= MAX_PROPOSALS) break;
  }
  return { text: raw.slice(0, match.index).trim(), proposals };
};
