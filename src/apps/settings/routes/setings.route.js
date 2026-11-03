import express from 'express';
import { 
    UpdateSendNotification, UpdateReceiveNotification, GetNotifications, MarkAsReadNotifications
} from '../controllers/setings.controller.js'
const SettingsRouter = express.Router();

// Sending notification settings
SettingsRouter.put('/notification/send', UpdateSendNotification);
// Receiving notification settings
SettingsRouter.put('/notification/receive', UpdateReceiveNotification);

// get partner notifications by id
SettingsRouter.get('/notification/getById/:partnerId', GetNotifications);

// Delete partner notification by id
SettingsRouter.get('/notification/delete/:prospectId/:notificationId', MarkAsReadNotifications);


export default SettingsRouter;