import {ParterSMSModel} from '../models/sms.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
import {TransactionModel} from '../../transaction/models/transaction.model.js';
import mongoose from 'mongoose';  


// Save SMS details  
export const saveSMSDetails = async (req, res) => {  
    //console.log(req.body);  
    try {  
        // Validate incoming request data  
        const { smsBody, transactionId, partner, prospect, status } = req.body;  

        // Initialize prospect as an empty array  
        let prospectArray = [];  

        if (prospect) {  
            if (Array.isArray(prospect)) {  
                // If prospect is an array, validate and store string entries  
                prospectArray = prospect.filter(item => typeof item === 'string'); // Keep only string entries  
            } else if (typeof prospect === 'string') {  
                // If prospect is a single string, wrap it in an array  
                prospectArray = [prospect];  
            }  
        } else {  
            // Handle the case when prospect is undefined  
            console.warn("Prospect is undefined.");  
        }   

        // Ensure partner's ObjectId is valid before proceeding  
        if (!partner || !mongoose.Types.ObjectId.isValid(partner)) {  
            return res.status(400).json({ 
                message: "Invalid partner ID!",
                sucess: false,
            });  
        }  

        // Build SMS details object  
        const smsDetails = {  
            smsBody,  
            transactionId,  
            partnerId: partner,  
            prospect: prospectArray.length > 0 ? prospectArray : undefined, // Store the prospect array directly  
            status  
        };  

        // Create and save SMS entry  
        const saveSMS = await ParterSMSModel.create(smsDetails);  

        // Return response  
        res.status(200).json({
            data: saveSMS,
            message: 'SMS record saved successfully!',
            sucess: true,
        });  

    } catch (error) {  
        res.status(500).json({  
            error: error.message,
            message: 'Error saving SMS details',
            sucess: false,
        });  
    }  
};

// Route handler to fetch all SMS by createdBy and the associated transactions  
export const getSMSCreatedBy = async (req, res) => {  
    try {  
        const { partnerId } = req.params;  
  
        // Step 1: Find the partner and get partner details  
        const partner = await PartnersModel.findById(partnerId);  
        if (!partner) {  
            return res.status(404).json({ 
                message: 'User not found',
                success: false, 
            });  
        }  
      
        // Step 2: Find SMS objects for the partner  
        const smsObject = await ParterSMSModel.find({  
            partnerId: partner._id  
        });  
  
        if (!smsObject || smsObject.length === 0) {  
            return res.status(400).json({ 
                message: 'SMS not found',
                success: false,
            });  
        }  
  
        // Step 3: Create a map of transaction records using transactionId  
        const transactions = await TransactionModel.find({  
            partnerId: partner._id  
        });  

        // Create a map for quick lookup of transactions by transactionId  
        const transactionMap = {};  
        transactions.forEach(transaction => {  
            transactionMap[transaction._id] = transaction; // assuming transactionId is _id  
        });  

        // Step 4: Attach corresponding transaction to each SMS  
        const smsWithTransactions = smsObject.map(sms => ({  
            ...sms.toObject(), // Convert mongoose Document to plain object  
            transaction: transactionMap[sms.transactionId] || null // Attach transaction or null if none found  
        }));  
  
        res.status(200).json({  
            message: 'SMS with corresponding transactions retrieved successfully!',  
            data: smsWithTransactions,
            success: true,
        });  
  
    } catch (error) {  
        res.status(500).json({  
            message: 'Error retrieving SMS and transactions',  
            error: error.message, 
            success: false, 
        });  
    }  
};

// delete sms
export const deleteSMS = async (req, res) => {
  try {
    const { id } = req.params;

    const sms = await ParterSMSModel.findById(id);

    // Check if the sms exists
    if (!sms) {
      return res.status(404).json({
        message: "sms not found",
        success: false,
      });
    }

    // Here we delete the entry
    await ParterSMSModel.findByIdAndDelete(id);

    res.status(200).json({
      message: "SMS deleted successfully!",
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting sms",
      error: error.message,
      success: false,
    });
  }
};