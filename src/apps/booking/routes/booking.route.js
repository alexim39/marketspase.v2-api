import express from 'express';
import { 
    SessionBookingController, getBookingsForPartner, deleteBooking, UpdateBooking, getPartnerEmailList
} from '../controllers/booking.controller.js'
import { requireAuth } from '../../../shared/http/requireAuth.js';
const BookingRouter = express.Router();

// Session booking — partner-authenticated (attribution rides the form's username).
BookingRouter.post('/submit', requireAuth, SessionBookingController);
// Bookings for one partner — owner, upline or admin.
BookingRouter.get('/for/:createdBy', requireAuth, getBookingsForPartner);
// Delete booking — owner or admin.
BookingRouter.delete('/delete/:id', requireAuth, deleteBooking );
// Update booking status — owner, upline (support) or admin.
BookingRouter.put('/update', requireAuth, UpdateBooking);
// Partner email list — owner, upline or admin (PII harvest guard).
BookingRouter.get('/email-list/:createdBy', requireAuth, getPartnerEmailList);


export default BookingRouter;
