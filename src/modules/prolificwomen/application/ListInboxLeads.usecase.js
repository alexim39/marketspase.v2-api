export class ListInboxLeadsUseCase {
  constructor({ leads }) {
    this.leads = leads;
  }

  async execute({ q = '', limit = 500, skip = 0 } = {}) {
    return this.leads.listPending({ q, limit, skip });
  }
}
