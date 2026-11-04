import {ParterEmailsModel} from '../models/email.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
 
// get bulck email by partner
export const getEmailsCreatedBy = async (req, res) => {
    try {  
        const { partnerId } = req.params;  
  
        // Step 1: Find the partner and get partner details  
        const partner = await PartnersModel.findById(partnerId);  
        if (!partner) {  
            return res.status(404).json({ 
                message: 'Partner not found',
                success: false,
            });  
        }  
      
        // Step 2: Find email objects for the partner  
        const emailObject = await ParterEmailsModel.find({  
            partnerId: partner._id  
        });  
  
        if (!emailObject || emailObject.length === 0) {  
            return res.status(400).json({ 
                message: 'Email not found',
                success: false,
            });  
        } 

        res.status(200).json({  
            message: 'Emails retrieved successfully!',  
            data: emailObject,
            success: true,
        });

    } catch (error) {  
        res.status(500).json({  
            message: 'Error retrieving Emails',  
            error: error.message,  
            success: false,
        });  
    }  
}

// delete email
export const deleteEmail = async (req, res) => {
    try {
      const { id } = req.params;
  
      const email = await ParterEmailsModel.findById(id);
  
      // Check if the email exists
      if (!email) {
        return res.status(404).json({
          message: "email not found",
          success: false,
        });
      }
  
      // Here we delete the entry
      await ParterEmailsModel.findByIdAndDelete(id);
  
      res.status(200).json({
        message: "Email deleted successfully!",
        success: true,
      });
    } catch (error) {
      console.error(error.message);
      res.status(500).json({
        message: "Error deleting email",
        error: error.message,
        success: false,
      });
    }
  };