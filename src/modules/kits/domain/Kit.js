import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Presentation-kit taxonomy — one canonical deck per selling moment.
 * Opportunity (the business story), Product, Invite (events/sessions),
 * Team (duplication and culture).
 */
export const KIT_AREAS = ['Opportunity', 'Product', 'Invite', 'Team'];

const MAX_SLIDES = 30;

const text = (value, field, { min = 1, max = 2000 } = {}) => {
  const s = String(value ?? '').trim();
  if (s.length < min || s.length > max) throw new ValidationException(`Invalid ${field}`);
  return s;
};

/** Value object: one slide — headine, body, optional visual + presenter note. */
export const createSlide = (input) => {
  if (!input || typeof input !== 'object') throw new ValidationException('Invalid slide data');
  const slide = {
    title: text(input.title, 'slide title', { min: 1, max: 120 }),
    body: text(input.body, 'slide body', { min: 1, max: 2000 }),
  };
  if (input.imageUrl !== undefined && String(input.imageUrl).trim() !== '') {
    slide.imageUrl = String(input.imageUrl).trim().slice(0, 500);
  }
  if (input.note !== undefined && String(input.note).trim() !== '') {
    slide.note = String(input.note).trim().slice(0, 1000);
  }
  return slide;
};

/** Value object: kit slide list — ordered, bounded, each slide validated. */
export const createSlides = (input) => {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationException('A kit needs at least one slide');
  }
  if (input.length > MAX_SLIDES) throw new ValidationException(`A kit holds at most ${MAX_SLIDES} slides`);
  return input.map(createSlide);
};
