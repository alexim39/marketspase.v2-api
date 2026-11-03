import { asyncHandler } from '../../../shared/http/asyncHandler.js';

/**
 * Interface: HTTP adapter. Parses validated input, calls the use-case,
 * returns the legacy-compatible envelope so existing clients keep working.
 * Prefers the authenticated partnerId when `optionalAuth` populated it.
 */
export const makeSubmitTicketController = (submitTicket) =>
  asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const partnerId = req.auth?.partnerId ?? body.partnerId;
    const ticket = await submitTicket.execute({ ...body, partnerId });

    // Legacy shape `{ message, ticket, success }` + modern `data` alias.
    // Keep 200 until frontends stop asserting it; then move to 201.
    return res.status(200).json({
      message: 'Ticket submitted successfully!',
      ticket,
      data: ticket,
      success: true,
    });
  });
