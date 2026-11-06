/**
 * Normalize a delivery address from checkout. Returns null when any field
 * needed to actually deliver the order is missing.
 */
export const cleanShipping = (value) => {
  if (!value || typeof value !== 'object') return null;

  const text = (input, max) => String(input ?? '').trim().slice(0, max);
  const shipping = {
    fullName: text(value.fullName ?? value.name, 120),
    phone: text(value.phone, 40),
    street: text(value.street, 240),
    city: text(value.city, 120),
    state: text(value.state, 120),
    country: text(value.country, 80) || 'Nigeria',
    notes: text(value.notes, 500),
  };

  if (!shipping.fullName || !shipping.phone || !shipping.street || !shipping.city || !shipping.state) {
    return null;
  }
  return shipping;
};
