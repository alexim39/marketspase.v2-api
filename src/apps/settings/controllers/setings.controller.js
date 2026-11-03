import { sendEmail } from "../../../services/emailService.js";
import { PartnersModel } from './../../partner/models/partner.model.js';
import { ProspectModel } from './../../prospect/models/prospect.model.js';
import { GeneratePartnerNotifications } from './../../utils/generateNotifications.js'

// Save send notification settings
export const UpdateSendNotification = async (req, res) => {
  try {
    const { value, partnerId } = req.body;
    // value should be a string: 'email' | 'sms' | 'both' | 'off'

    // Update only the 'send' field inside settings.notification
    const updatedPartner = await PartnersModel.findByIdAndUpdate(
      partnerId,
      { 'settings.notification.send': value },
      { new: true, runValidators: true }
    );

    if (!updatedPartner) {
      return res.status(404).json({
        message: 'Partner not found',
        success: false
      });
    }

    res.status(200).json({
      message: 'Send notification setting updated successfully',
      success: true
    });

  } catch (error) {
    res.status(500).json({
      message: 'There was an error updating your settings',
      error: error.message,
      success: false
    });
  }
};

// Save receive notification settings
export const UpdateReceiveNotification = async (req, res) => {
  try {
    const { value, partnerId } = req.body;
    // value should be a string: 'email' | 'sms' | 'both' | 'off'

    // Update only the 'receive' field inside settings.notification
    const updatedPartner = await PartnersModel.findByIdAndUpdate(
      partnerId,
      { 'settings.notification.receive': value },
      { new: true, runValidators: true }
    );

    if (!updatedPartner) {
      return res.status(404).json({
        message: 'Partner not found',
        success: false
      });
    }

    res.status(200).json({
      message: 'Receive notification setting updated successfully',
      success: true
    });

  } catch (error) {
    res.status(500).json({
      message: 'There was an error updating your settings',
      error: error.message,
      success: false
    });
  }
};

// Get partner notifications
export const GetNotifications = async (req, res) => {
  try {
    const { partnerId } = req.params;

    // Validate partnerId
    if (!partnerId) {
      return res.status(400).json({
        message: "partnerId is required.",
        success: false
      });
    }

    // Find the partner by ID
    const partner = await PartnersModel.findById(partnerId);

    // Check if partner exists
    if (!partner) {
      return res.status(404).json({
        message: "Partner not found.",
        success: false
      });
    }

    
  GeneratePartnerNotifications(partner._id)
  .then((notifications) => {
    //console.log(notifications);

    res.status(200).json({
      message: "Notifications retrieved successfully!",
      data: notifications,
      success: true
    });
  })
  .catch((error) => {
    res.status(500).json({
      message: "An error occurred while fetching notifications.",
      error: error.message,
      success: false
    });
  });

  } catch (error) {
    res.status(500).json({
      message: "An error occurred while fetching the partner.",
      error: error.message,
      success: false
    });
  }
};


/**
 * Update a prospect's communication or status entry to "Closed"
 * @param {string} prospectId - ID of the Prospect
 * @param {string} id - ID of the communication or status to be closed
 */
export const MarkAsReadNotifications = async (req, res) => {
  try {
    const { prospectId, notificationId } = req.params;

    const prospect = await ProspectModel.findById(prospectId);
    //if (!prospect) throw new Error('Prospect not found');

     if (!prospect) {
      return res.status(404).json({
        message: "Prospect not found.",
        success: false
      });
    }

    let updated = false;

    // Check and update communication status if matching ID found
    if (Array.isArray(prospect.communications)) {
      for (let comm of prospect.communications) {
        if (comm._id.toString() === notificationId.toString()) {
          comm.status = 'Closed';
          updated = true;
          break;
        }
      }
    }

    // If not found in communications, check the status
    if (!updated && prospect.status && prospect.status._id?.toString() === notificationId.toString()) {
      prospect.status.status = 'Closed';
      updated = true;
    }

    if (!updated) {
      //throw new Error('Matching communication or status not found');
      return res.status(404).json({
        message: 'Matching communication or status not found',
        success: false
      });
    }

    await prospect.save();
    //return { message: 'Successfully closed', prospectId, closedId: id };
     res.status(200).json({
      message: 'Notification successfully marked as close',
      success: true
    });
  } catch (error) {
     res.status(500).json({
      message: "Error closing notifications",
      error: error.message,
      success: false
    });
  }
};