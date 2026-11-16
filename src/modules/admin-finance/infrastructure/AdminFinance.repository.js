import { TransactionModel } from '../../billing/infrastructure/Billing.models.js';

const DEPOSIT_METHODS = ['Paystack Deposit', 'Opay Deposit', 'Manual Transfer', 'Admin Credit'];
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const typeMatch = (type) => {
  if (type === 'deposits') return { paymentMethod: { $in: DEPOSIT_METHODS } };
  if (type === 'withdrawals') return { paymentMethod: 'Withdrawal' };
  if (type === 'refunds') return { paymentMethod: 'Withdrawal Refund' };
  return {
    $or: [
      { paymentMethod: { $in: DEPOSIT_METHODS } },
      { paymentMethod: { $in: ['Withdrawal', 'Withdrawal Refund'] } },
    ],
  };
};

export class AdminFinanceRepository {
  async transactions({ type = 'all', status = '', q = '', from = null, to = null, limit = 50, skip = 0 } = {}) {
    const size = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const offset = Math.max(Number(skip) || 0, 0);
    const match = { ...typeMatch(type) };
    if (status) match.status = status;
    if (from || to) {
      match.date = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const pipeline = [
      { $match: match },
      { $lookup: { from: 'partners', localField: 'partnerId', foreignField: '_id', as: 'partner' } },
      { $unwind: { path: '$partner', preserveNullAndEmptyArrays: true } },
    ];

    const term = String(q ?? '').trim();
    if (term) {
      const rx = new RegExp(escapeRegex(term), 'i');
      pipeline.push({
        $match: {
          $or: [
            { reference: rx },
            { accountName: rx },
            { accountLast4: rx },
            { 'partner.name': rx },
            { 'partner.surname': rx },
            { 'partner.email': rx },
            { 'partner.username': rx },
          ],
        },
      });
    }

    pipeline.push(
      { $sort: { date: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: offset },
            { $limit: size },
            {
              $project: {
                id: { $toString: '$_id' },
                partnerId: { $toString: '$partnerId' },
                partnerName: {
                  $trim: {
                    input: {
                      $concat: [
                        { $ifNull: ['$partner.name', ''] },
                        ' ',
                        { $ifNull: ['$partner.surname', ''] },
                      ],
                    },
                  },
                },
                partnerEmail: '$partner.email',
                partnerUsername: '$partner.username',
                amount: '$amount',
                status: '$status',
                method: '$paymentMethod',
                type: '$transactionType',
                reference: '$reference',
                date: '$date',
                bank: '$bank',
                bankCode: '$bankCode',
                accountName: '$accountName',
                accountLast4: '$accountLast4',
                payoutMode: '$payoutMode',
                transferStatus: '$transferStatus',
                failureReason: '$payoutFailureReason',
                balanceBefore: '$balanceBefore',
                balanceAfter: '$balanceAfter',
                createdAt: '$createdAt',
              },
            },
          ],
          total: [{ $count: 'count' }],
          totals: [{ $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }],
        },
      },
    );

    const [result] = await TransactionModel.aggregate(pipeline);
    const totals = result?.totals?.[0] ?? { amount: 0, count: 0 };
    return {
      items: result?.items ?? [],
      total: result?.total?.[0]?.count ?? 0,
      limit: size,
      skip: offset,
      totals: { amount: Number(totals.amount) || 0, count: Number(totals.count) || 0 },
    };
  }
}

export default AdminFinanceRepository;
