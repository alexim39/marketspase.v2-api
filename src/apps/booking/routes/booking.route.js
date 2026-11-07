import express from 'express';
import { z } from 'zod';
import { 
    SessionBookingController, getBookingsForPartner, deleteBooking, UpdateBooking
} from '../controllers/booking.controller.js'
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { validateBodyInPlace } from '../../../shared/http/validate.js';
const BookingRouter = express.Router();

const BookingCreate = z.object({
  reason: z.string().trim().max(500).optional(),
  description: z.string().trim().max(2000).optional(),
  referralCode: z.string().trim().max(80).optional(),
  consultDate: z.string().trim().min(1).max(80),
  consultTime: z.string().trim().min(1).max(40),
  contactMethod: z.string().trim().max(40).optional(),
  referral: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254).optional().or(z.literal('')),
  name: z.string().trim().max(120).optional(),
  surname: z.string().trim().max(120).optional(),
  userDevice: z.string().trim().max(200).optional(),
  username: z.string().trim().min(1).max(80),
  prospectId: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid prospect').optional().or(z.literal('')),
});
const BookingUpdate = z.object({
  id: z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid booking'),
  sessionStatus: z.string().trim().min(1).max(40),
  sessionRemark: z.string().trim().max(2000).optional(),
});

// Session booking — partner-authenticated (attribution rides the form's username).
BookingRouter.post('/submit', requireAuth, validateBodyInPlace(BookingCreate), SessionBookingController);
// Bookings for one partner — owner, upline or admin.
BookingRouter.get('/for/:createdBy', requireAuth, getBookingsForPartner);
// Delete booking — owner or admin.
BookingRouter.delete('/delete/:id', requireAuth, deleteBooking );
// Update booking status — owner, upline (support) or admin.
BookingRouter.put('/update', requireAuth, validateBodyInPlace(BookingUpdate), UpdateBooking);


export default BookingRouter;
