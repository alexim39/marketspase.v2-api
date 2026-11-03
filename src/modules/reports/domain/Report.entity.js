import { ValidationException } from '../../../shared/domain/AppError.js';

export const REQUEST_STATUS = ['open', 'fulfilled'];

const text = (value, field, { min = 1, max = 5000 } = {}) => {
  const s = String(value ?? '').trim();
  if (s.length < min || s.length > max) throw new ValidationException(`Invalid ${field}`);
  return s;
};

const optText = (value, field, opts) => {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  return text(value, field, opts);
};

const asDate = (value, field) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationException(`Invalid ${field}`);
  return d;
};

const period = (input) => {
  const periodStart = asDate(input.periodStart, 'periodStart');
  const periodEnd = asDate(input.periodEnd, 'periodEnd');
  if (periodEnd <= periodStart) throw new ValidationException('Period end must be after period start');
  return { periodStart, periodEnd };
};

/** @param {{title,periodStart,periodEnd,highlights,blockers,plans}} input (Zod-whitelisted) */
export const createReportEntity = (input) => ({
  title: text(input.title, 'title', { min: 2, max: 120 }),
  ...period(input),
  highlights: text(input.highlights, 'highlights'),
  blockers: optText(input.blockers, 'blockers', { max: 2000 }),
  plans: optText(input.plans, 'plans', { max: 2000 }),
});

/** @param {{downlineId,periodStart,periodEnd,note}} input (Zod-whitelisted) */
export const createRequestEntity = (input) => ({
  ...period(input),
  note: optText(input.note, 'note', { max: 500 }),
});
