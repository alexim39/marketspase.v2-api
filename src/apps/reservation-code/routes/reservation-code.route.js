import express from 'express';
import { 
    submitReservationCode, activateNewPartnerCode
} from '../controllers/reservation-code.controller.js'
const ReservationCodeRouter = express.Router();

// submit code from prospect contact
ReservationCodeRouter.post('/submit', submitReservationCode);
// submit new partner code
ReservationCodeRouter.post('/new-partner', activateNewPartnerCode);


export default ReservationCodeRouter;