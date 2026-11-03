export class ListLeadsUseCase {
  constructor({ leads }) {
    this.leads = leads;
  }

  async execute({ q = '', limit = 25, skip = 0, status = 'all' } = {}) {
    return this.leads.list({ q, limit, skip, status });
  }
}
