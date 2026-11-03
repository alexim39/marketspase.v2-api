import { createLeadEntity } from '../domain/Lead.entity.js';

export class SubmitLeadUseCase {
  constructor({ leads }) {
    this.leads = leads;
  }

  async execute(input) {
    const entity = createLeadEntity(input);
    return this.leads.save(entity);
  }
}
