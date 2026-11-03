import express from 'express';
import { bookingForm} from '../controllers/image.controller.js'
const AuthRouter = express.Router();

//
AuthRouter.post('/submit', bookingForm);


export default AuthRouter;