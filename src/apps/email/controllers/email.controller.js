import {ParterEmailsModel} from '../models/email.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
import { sendEmail } from "../../../services/emailService.js";

 
// send email to prospect
export const SendSingleEmailsToProspect = async (req, res) => {
    try {
  
        //console.log('sent==',req.body);
  
        const saveEmail = await ParterEmailsModel.create({
            emailSubject: req.body.emailSubject,
            emailBody: req.body.emailBody,
            partnerId: req.body.partner._id,
            prospects: req.body.prospect.prospectEmail,
           
        });
  
        // Send email after successfully submitting the records
        const emailSubject = req.body.emailSubject;
        const emailMessage = req.body.emailBody;
  
        const emailsToSend = [`${req.body.prospect.prospectEmail}`];
  
        for (const email of emailsToSend) {
            await sendEmail(email, emailSubject, emailMessage);
        }
  
        res.status(200).json({
            message: 'Email sent successfully!',
            success: true,
        });
  
    } catch (error) {
        res.status(500).json({
            error: error.message,
            message: 'Error sending email',
            success: false,
        })
    }
}

// send bulck email to prospectgetEmailsCreatedBy
export const SendEmailsToProspect = async (req, res) => {

    // Function to format email data into a string array
    function formatEmailData(emailData) {
        // Handle different input formats (string or array)
        if (typeof emailData === 'string') {
        return emailData.split(',').map(email => email.trim());
        } else if (Array.isArray(emailData)) {
        return emailData.map(email => email.trim());
        } else {
        throw new Error('Invalid email data format');
        }
    }

    try {
  
       const {emailSubject, prospects, emailBody, partnerId } = req.body;

        // Step 1: Find the user
        const partner = await PartnersModel.findById(partnerId);
        if (!partner) {
            return res.status(404).json({ 
                message: 'Partner not found',
                success: false,
            });
        }

        // formated emails
        const formattedEmails = formatEmailData(prospects); // Format the email data: prospects == emails

        for (const email of formattedEmails) {
            await sendEmail(email, emailSubject, emailBody);
        }

        
        await ParterEmailsModel.create({
            emailSubject,
            emailBody,
            partnerId,
            prospects: formattedEmails
        });

        res.status(200).json({
            message: 'Email sent successfully!',
            success: true,
        });
    
    } catch (error) {
        res.status(500).json({
            error: error.message,
            message: 'Error sending email',
            success: false,
        })
    }
}


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