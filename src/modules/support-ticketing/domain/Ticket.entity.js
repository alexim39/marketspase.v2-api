import { ValidationException } from '../../../shared/domain/AppError.js';

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

/**
 * @typedef {object} TicketProps
 * @property {string} subject
 * @property {string} description
 * @property {Date} date
 * @property {string} category
 * @property {string} priority
 * @property {string} [comment]
 * @property {string} partnerId 24-hex ObjectId string
 */

/**
 * Value Object: PartnerId — never a raw ObjectId in domain code.
 */
export const PartnerId = {
  /**
   * @param {unknown} value
   * @returns {string} normalized id
   * @throws {ValidationException}
   */
  create(value) {
    const v = String(value ?? '').trim();
    if (!OBJECT_ID_RE.test(v)) throw new ValidationException('Invalid partnerId');
    return v;
  },
};

/**
 * Value Object: non-empty trimmed text with length guard.
 */
const text = (value, field, { min = 2, max = 5000 } = {}) => {
  const v = String(value ?? '').trim();
  if (v.length < min || v.length > max) {
    throw new ValidationException(`Invalid ${field}`);
  }
  return v;
};

/**
 * Domain Entity factory — pure, no Express/Mongoose.
 * @param {TicketProps} input
 * @returns {{subject:string,description:string,date:Date,category:string,priority:string,comment:string,partnerId:string}}
 * @throws {ValidationException}
 */
export const createTicketEntity = (input) => {
  if (!input || typeof input !== 'object') throw new ValidationException('Invalid ticket data');
  const date = input.date instanceof Date ? input.date : new Date(input.date);
  if (Number.isNaN(date.getTime())) throw new ValidationException('Invalid date');

  return {
    subject: text(input.subject, 'subject', { min: 3, max: 200 }),
    description: text(input.description, 'description', { min: 3, max: 5000 }),
    date,
    category: text(input.category, 'category', { min: 2, max: 120 }),
    priority: text(input.priority, 'priority', { min: 2, max: 40 }),
    comment: String(input.comment ?? '').trim().slice(0, 5000),
    partnerId: PartnerId.create(input.partnerId),
  };
};
