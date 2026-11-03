import { ValidationException } from '../../../shared/domain/AppError.js';

const READY_OPTIONS = ['yes', 'not-yet'];
const INVITE_OPTIONS = ['yes', 'no'];
const AVAILABILITY_OPTIONS = ['weekdays', 'weekends'];

const text = (value, field, min, max) => {
  const normalized = String(value ?? '').trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ValidationException(`Invalid ${field}`);
  }
  return normalized;
};

const oneOf = (value, field, allowed) => {
  const normalized = String(value ?? '').trim();
  if (!allowed.includes(normalized)) {
    throw new ValidationException(`Invalid ${field}`);
  }
  return normalized;
};

const phone = (value) => {
  const normalized = String(value ?? '').replace(/[\s\-()]/g, '');
  if (!/^\+?[0-9]{10,15}$/.test(normalized)) {
    throw new ValidationException('Invalid phone');
  }
  return normalized;
};

export const createLeadEntity = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationException('Invalid lead data');
  }

  const submittedAt = input.submittedAt ? new Date(input.submittedAt) : new Date();
  if (Number.isNaN(submittedAt.getTime())) {
    throw new ValidationException('Invalid submittedAt');
  }

  return {
    name: text(input.name, 'name', 2, 80),
    phone: phone(input.phone),
    location: text(input.location, 'location', 2, 120),
    readyToBeMentored: oneOf(input.readyToBeMentored, 'readyToBeMentored', READY_OPTIONS),
    headOfficeInvite: oneOf(input.headOfficeInvite, 'headOfficeInvite', INVITE_OPTIONS),
    availability: oneOf(input.availability, 'availability', AVAILABILITY_OPTIONS),
    submittedAt,
    source: 'prolificwoman-web',
  };
};
