import { asyncHandler } from '../../../shared/http/asyncHandler.js';

const pid = (req) => req.validated?.params?.partnerId ?? req.params.partnerId;

/** Interface: HTTP adapters for the network read-model. */
export const makeNetworkController = (uc) => ({
  tree: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.tree.execute({ partnerId: pid(req), depth: q?.depth });
    res.status(200).json({ message: 'Network tree retrieved successfully', data, success: true });
  }),

  upline: asyncHandler(async (req, res) => {
    const data = await uc.upline.execute({ partnerId: pid(req) });
    res.status(200).json({ message: 'Upline chain retrieved successfully', data, success: true });
  }),
});
