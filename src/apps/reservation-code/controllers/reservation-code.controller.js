import {ReservationCodeModel} from '../models/reservation-code.model.js';
import { sendEmail } from "../../../services/emailService.js";
import { ownerEmailTemplate } from '../services/email/ownerTemplate.js';


export const submitReservationCode = async (req, res) => {
    try {  
        const { code, partnerId, prospectId } = req.body;

        // Check if the reservation code exists  
        const existingCode = await ReservationCodeModel.findOne({ code });  

        if (existingCode) {
            // If the code exists, check its status  
            if (existingCode.status === 'Pending') {  
                //throw new Error('The code has not been approved.');  
                return res.status(400).json({  
                    message: 'This code exist but has not been approved',  
                    success: false,
                }); 
            } else if (existingCode.status === 'Approved') {  
                //throw new Error('The code has already been used.'); 
                return res.status(401).json({  
                    message: 'This code has already been used',  
                    success: false,
                });  
            }  
        }  

        // If the code does not exist or is approved, save the new reservation code  
        const newReservationCode = new ReservationCodeModel({  
            code,  
            partnerId,  
            prospectId,  
            //status: 'Pending' // or set to whatever status is appropriate  
        });  

        // Send email to form owner
        const ownerSubject = 'Activation Code Submission';
        const ownerMessage = ownerEmailTemplate(req.body);
        const ownerEmails = ['ago.fnc@gmail.com'];
        for (const email of ownerEmails) {
            await sendEmail(email, ownerSubject, ownerMessage);
        }

        await newReservationCode.save();  
        //return { success: true, message: 'Reservation code saved successfully.' };  
        res.status(200).json({  
            message: 'Code created successfully!',  
            data: newReservationCode, // Include the saved data in the response  
            success: true,
        });

    } catch (error) {  
        res.status(500).json({  
            success: false, 
            error: error.message,
            message: 'An error occurred while submitting the reservation code.'
        });  
    }  
}  

export const activateNewPartnerCode = async (req, res) => {
    try {  
        const { code, partnerId } = req.body;

        // Check if the reservation code exists  
        const existingCode = await ReservationCodeModel.findOne({ code });  

        if (existingCode) {  
            // If the code exists, check its status  
            if (existingCode.status === 'Pending') {  
                //throw new Error('The code has not been approved.');  
                return res.status(400).json({  
                    message: 'This code exist but has not been approved',  
                    success: false,
                }); 
            } else if (existingCode.status === 'Approved') {  
                //throw new Error('The code has already been used.'); 
                return res.status(401).json({  
                    message: 'This code has already been used',  
                    success: false,
                });  
            }  
        }  

        // If the code does not exist or is approved, save the new reservation code  
        const newReservationCode = new ReservationCodeModel({  
            code,  
            partnerId,  
            //prospectId,  
            //status: 'Pending' // or set to whatever status is appropriate  
        });  

         // Send email to form owner
         const ownerSubject = 'Activation Code Submission';
         const ownerMessage = ownerEmailTemplate(req.body);
         const ownerEmails = ['ago.fnc@gmail.com'];
         for (const email of ownerEmails) {
             await sendEmail(email, ownerSubject, ownerMessage);
         } 

        await newReservationCode.save();  
        //return { success: true, message: 'Reservation code saved successfully.' };  
        res.status(200).json({  
            message: 'Code created successfully!',  
            data: newReservationCode, // Include the saved data in the response  
            success: true,
        });

    } catch (error) {  
        res.status(500).json({  
            success: false, 
            error: error.message,
            message: 'An error occurred while submitting the reservation code.'
        });  
    }  
}  

