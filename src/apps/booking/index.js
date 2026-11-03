import express from 'express';
const app = express();
app.use(express.json()); // Use json middleware
app.use(express.urlencoded({extended: false})); // Use formdata middleware
import BookingRouter from './routes/booking.route.js';
export default BookingRouter;