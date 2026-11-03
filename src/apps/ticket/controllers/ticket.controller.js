import {TicketModel} from '../models/ticket.model.js';
import { sendEmail } from "../../../services/emailService.js";


// Save ticket details  
export const saveTicket = async (req, res) => {  
    try {  
        const ticketData = req.body; // Get the ticket data from the request body  
        const newTicket = new TicketModel(ticketData); // Create a new ticket instance  
        await newTicket.save(); // Save the ticket to the database  


        // Send email after successfully submitting the records
        const emailSubject = 'Diamond Project Ticket Submission';
        const emailMessage = `
            <h1>Ticket Submission</h1>
            <p>Kindly note that someone submitted a ticket.</p>
             <br>
            <h1>Complete Ticket Details</h1>
            <p>Subject: ${req.body.subject}</p>
            <p>Description: ${req.body.description}</p>
            <p>Date of submission: ${req.body.date}</p>
            <p>Category: ${req.body.category}</p>
            <p>Priority: ${req.body.priority}</p>
            <p>Comment: ${req.body.comment}</p>
        `;

        const emailsToSend = ['ago.fnc@gmail.com'];

        for (const email of emailsToSend) {
            await sendEmail(email, emailSubject, emailMessage);
        }

        res.status(200).json({ 
            message: 'Ticket submitted successfully!', 
            ticket: newTicket,
            success: true
        });  
    } catch (error) {  
        res.status(500).json({ 
            message: 'There was an error submitting your ticket.',
            error: error.message,
            success: false
        });  
    }  
};
