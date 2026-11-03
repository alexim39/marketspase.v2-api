import {ContactModel, PreapproachDownloadModel} from '../models/contact.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
import { sendEmail } from "../../../services/emailService.js";

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// User contact contnroller
export const ContactController = async (req, res) => {
    try {
        const name = String(req.body?.name ?? '').trim().slice(0, 120);
        const surname = String(req.body?.surname ?? '').trim().slice(0, 120);
        const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 254);
        const subject = String(req.body?.subject ?? '').trim().slice(0, 200);
        const message = String(req.body?.message ?? '').trim().slice(0, 5000);
        const username = String(req.body?.username ?? '').trim().slice(0, 60);

        if (!name || !surname || !subject || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                message: 'Please provide your name, a valid email address, a subject and a message.',
                success: false,
            });
        }

        const contactObject = await ContactModel.create({ name, surname, email, subject, message });

        const emailSubject = 'Diamond Project Contact Form';
        const emailMessage = `
            <h1>Contact Form</h1>
            <p>Kindly note that ${escapeHtml(name)} ${escapeHtml(surname)} filled the contact form on the Diamond Project website.</p>

            <br>
            <h1>Complete Prospect Response</h1>
            <p>Name: ${escapeHtml(name)}</p>
            <p>Surname: ${escapeHtml(surname)}</p>
            <p>Email address: ${escapeHtml(email)}</p>
            <p>Subject: ${escapeHtml(subject)}</p>
            <p>Message: ${escapeHtml(message)}</p>
        `;

        const configured = process.env.CONTACT_ALERT_EMAILS
            || process.env.SUPPORT_OWNER_EMAILS
            || 'contacts@c21fg.online';
        const recipients = new Set(
            configured.split(',').map((entry) => entry.trim()).filter(Boolean)
        );

        if (username && username !== 'business') {
            const partner = await PartnersModel.findOne({ username }).select('email').lean().catch(() => null);
            if (partner?.email) recipients.add(partner.email);
        }

        await Promise.all([...recipients].map((recipient) => sendEmail(recipient, emailSubject, emailMessage)));

        await sendEmail(
            email,
            'We received your message - Diamond Project',
            `<p>Hi ${escapeHtml(name)},</p>
             <p>Thank you for contacting Diamond Project. We have received your message and a member of our team will respond shortly.</p>
             <p><strong>Your subject:</strong> ${escapeHtml(subject)}</p>`
        );

        res.status(200).json({
            contactObject,
            message: 'Thank you. Your message has been received and a member of our team will respond shortly.',
            success: true,
        });

    } catch (error) {
        console.error(error.message);
        const duplicate = error?.code === 11000;
        const invalid = error?.name === 'ValidationError';
        res.status(duplicate ? 409 : invalid ? 400 : 500).json({
            error: duplicate ? 'Duplicate contact' : error.message,
            message: duplicate
                ? 'We already have a message from this email. Please contact us directly at contacts@c21fg.online.'
                : invalid
                    ? 'Please check the contact form and try again.'
                    : 'Contact form submission failed',
            success: false
        })
    }
}



// User download contnroller
export const DownloadPreapproachController = async (req, res) => {
    try {

        //console.log('sent==',req.body);

        const downloadObject = await PreapproachDownloadModel.create({
            name: req.body.name,
            surname: req.body.surname,
            email: req.body.email,
            phone: req.body.phone,
            userDevice: req.body.userDevice,
            username: req.body.username,
        });

         // Find the user by username  
         const partner = await PartnersModel.findOne({ username: req.body.username });  
        
         if (!partner) {  
             return res.status(404).json({ 
                message: 'User not found',
                success: false
            });  
         }  

        // Send email after successfully submitting the records
        const emailSubject = 'Diamond Project Pre-Approach Download';
        const emailMessage = `
            <h1>Pre-Approach Download Form</h1>
            <p>Kindly note that ${req.body.name} ${req.body.surname} downloaded the pre-approach file on Diamond Project webiste.</p>

            <br>
            <h1>Complete Prospect Response</h1>
            <p>Name: ${req.body.name}</p>
            <p>Surname: ${req.body.surname}</p>
            <p>Email address: ${req.body.email}</p>
            <p>Phone: ${req.body.phone}</p>
        `;

        const emailsToSend = ['aleximenwo@gmail.com'];

        for (const email of emailsToSend) {
            await sendEmail(email, emailSubject, emailMessage);
        }

        res.status(200).json({downloadObject, message: 'Pre-approach download form submitted successfully', success: true});

    } catch (error) {
        console.error(error.message);
        res.status(500).json({
            error: error.message,
            message: 'Pre-approach download form submission failed',
            success: false
        })
    }
}