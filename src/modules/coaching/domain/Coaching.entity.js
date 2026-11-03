import { ValidationException } from '../../../shared/domain/AppError.js';

export const createNoteEntity = (input) => {
  const body = String(input.body ?? '').trim();
  if (body.length < 3 || body.length > 2000) throw new ValidationException('Note must be 3–2000 characters');
  return { body };
};
