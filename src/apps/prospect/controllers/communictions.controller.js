import { ProspectModel } from "../models/prospect.model.js";
import { PartnersModel } from '../../partner/models/partner.model.js';
import { buildProspectAccess } from '../../../modules/crm/application/Prospect.access.js';

// Same ownership guard as the v1 slice: touches need owner/upline/admin,
// history deletes need owner/admin. These routes previously had no auth.
const guard = buildProspectAccess({
  findProspectById: (id) => ProspectModel.findById(id).select('partnerId').lean().catch(() => null),
  findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf').lean().catch(() => null),
});
const deny = (res, err) => res.status(err?.statusCode ?? 403).json({ message: err?.message ?? 'Forbidden', success: false });


/**
 * Update the prospect's communications status
 * @param {Object} req - The request object containing the prospectId, communications status, and other details
 * @param {Object} res - The response object to send the result back to the client  
 */
export const UpdateProspectCommunications = async (req, res) => {
  try {
    const { prospectId, ...communicationData } = req.body;

    try {
      await guard.requireSupport(req.auth?.partnerId, prospectId);
    } catch (err) {
      return deny(res, err);
    }

    const { interestLevel, date, type, duration, description, topicsDiscussed } = communicationData;

    // Validate required fields for a new communication
    if (!interestLevel || !date || !type || !description) {
      return res.status(400).json({
        message: "Missing required fields for communication",
        success: false,
      });
    }

    const newCommunication = {
      interestLevel,
      date: new Date(date), // Ensure date is a Date object
      type,
      duration: duration !== undefined ? parseInt(duration, 10) : undefined,
      description,
      topicsDiscussed: Array.isArray(topicsDiscussed) ? topicsDiscussed : (typeof topicsDiscussed === 'string' ? topicsDiscussed.split(',').map(topic => topic.trim()) : []),
      // You might want to pass other communication details in the request body as well
    };

    // Find the prospect and update their communications array
    const prospect = await ProspectModel.findByIdAndUpdate(
      prospectId,
      { $push: { communications: newCommunication } }, // Push the new communication object to the array
      { new: true, runValidators: true }
    );

    if (!prospect) {
      return res.status(404).json({
        message: "Prospect not found",
        success: false
      });
    }

    res.status(200).json({
      message: "Prospect communication updated successfully!",
      success: true,
    });

  } catch (error) {
    res.status(500).json({
      message: "Error updating prospect communications",
      error: error.message,
      success: false
    });
  }
};


/**
 * Delete prospect communiction list entry
 */
export const DeleteProspectCommunication = async (req, res) => {
  try {
    const { prospectId, communicationId } = req.params;

    if (!prospectId || !communicationId) {
      return res.status(400).json({
        message: "Prospect ID and Communication ID are required",
        success: false,
      });
    }

    try {
      await guard.requireOwner(req.auth?.partnerId, prospectId, 'delete communication history');
    } catch (err) {
      return deny(res, err);
    }

    const prospect = await ProspectModel.findByIdAndUpdate(
      prospectId,
      { $pull: { communications: { _id: communicationId } } },
      { new: true }
    );

    if (!prospect) {
      return res.status(404).json({
        message: "Prospect not found",
        success: false,
      });
    }

    // Check if the communication was actually deleted (optional)
    const updatedProspect = await ProspectModel.findById(prospectId);
    const communicationExists = updatedProspect?.communications.some(
      (comm) => comm._id.toString() === communicationId
    );

    if (communicationExists) {
      return res.status(404).json({
        message: "Communication not found within the prospect",
        success: false,
      });
    }

    res.status(200).json({
      message: "Communication deleted successfully!",
      success: true,
    });

  } catch (error) {
    res.status(500).json({
      message: "Error deleting communication",
      error: error.message,
      success: false,
    });
  }
};