import { ProspectSurveyModel, PartnerSurveyModel } from '../models/survey.model.js';
import { PartnersModel } from '../../partner/models/partner.model.js';
import { sendEmail } from "../../../services/emailService.js";
import { ownerEmailTemplate, partnerOwnerEmailTemplate } from '../services/email/ownerTemplate.js';
import { userWelcomeEmailTemplate } from '../services/email/userTemplate.js';
import { normalizeState, sameState } from '../../../shared/geo/nigerianStates.js';
import { NotifyUseCase } from '../../../modules/notifications/application/NotificationsCenter.usecases.js';
import { MongoStoredNotificationStore } from '../../../modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';

// Prospect survey form handler
export const ProspectSurveyForm = async (req, res) => {
  try {
    const surveyData = req.body;

    // Check if the phone number or email already exists in the database
    const existingSurvey = await ProspectSurveyModel.findOne({
      $or: [
        { phoneNumber: surveyData.phoneNumber },
        { email: surveyData.email }
      ]
    });

    if (existingSurvey) {
      return res.status(400).json({ 
        success: false, 
        message: 'You\'ve already taken our survey with this email or phone. Thanks for your interest!' 
      });
    }

    // Save the survey data to MongoDB (state normalized for pool geo matching).
    const survey = new ProspectSurveyModel({ ...surveyData, stateNorm: normalizeState(surveyData.state) });
    await survey.save();

    const notifyNewLead = async (partner) => {
      try {
        const stored = new MongoStoredNotificationStore();
        await new NotifyUseCase({ stored }).execute({
          recipientId: String(partner._id),
          category: 'system',
          priority: 'medium',
          title: `New lead in ${surveyData.state || 'your area'}`,
          body: `${surveyData.name ?? 'Someone'} just asked to be contacted — open Buy Prospect to claim first.`,
          icon: 'person_add',
          link: '/dashboard/prospects/general-list',
          key: `new-lead:${String(survey._id)}:${String(partner._id)}`,
        });
      } catch { /* arrival alerts never fail the submit */ }
    };

    const notifyPageLead = async (partner) => {
      try {
        const stored = new MongoStoredNotificationStore();
        await new NotifyUseCase({ stored }).execute({
          recipientId: String(partner._id),
          category: 'system',
          priority: 'high',
          title: `New page lead: ${surveyData.name ?? 'Someone'} via /${surveyData.username}`,
          body: `${surveyData.name ?? 'Someone'} (${surveyData.phoneNumber ?? 'no phone'}) joined via your public page — open My Page Leads to accept.`,
          icon: 'inbox',
          link: '/dashboard/prospects/personal-list',
          key: `page-lead:${String(survey._id)}:${String(partner._id)}`,
        });
      } catch { /* arrival alerts never fail the submit */ }
    };

    // Prepare email templates
    const ownerSubject = 'New Prospect Notification - Diamond Project';
    const ownerMessage = ownerEmailTemplate(surveyData);
    const userSubject = 'Welcome to Diamond Project';
    const userMessage = userWelcomeEmailTemplate(surveyData);

    // Find the referring partner
    const referringPartner = await PartnersModel.findOne({ username: surveyData.username });

    // Case 1: Send to referring partner if found, not 'business', and receive notification is not 'off'
    if (
      referringPartner &&
      referringPartner.username !== 'business' &&
      (!referringPartner.settings ||
        !referringPartner.settings.notification ||
        referringPartner.settings.notification.receive !== 'off')
    ) {
      await sendEmail(referringPartner.email, ownerSubject, ownerMessage);
      await notifyPageLead(referringPartner);
    } else {
      // Case 2: partners in the lead's (normalized) state. Normalization
      // matters: exact-match once spammed the whole platform over casing.
      // Only partners with a state set are candidates (null can't match).
      // Bounded: per-lead fan-out must not grow with the platform.
      const candidates = await PartnersModel.find({ 'address.state': { $ne: null } })
        .select('email settings address').limit(500).lean();
      const eligibleStatePartners = candidates.filter(
        partner =>
          sameState(partner?.address?.state, surveyData.state) &&
          (!partner.settings ||
            !partner.settings.notification ||
            partner.settings.notification.receive !== 'off')
      );

      if (eligibleStatePartners.length > 0) {
        for (const partner of eligibleStatePartners) {
          await sendEmail(partner.email, ownerSubject, ownerMessage);
          await notifyNewLead(partner);
        }
      } else {
        // Case 3: no state match — notify platform admins only (capped),
        // never the whole member base. Blasting every partner per lead
        // is both spam and an unbounded read + mail fan-out.
        // (Legacy rows store mixed-case roles — match all casings.)
        const admins = await PartnersModel.find({ role: { $in: ['admin', 'Admin', 'ADMIN'] } })
          .select('email settings').limit(50).lean();
        const eligibleAdmins = (admins ?? []).filter(
          (partner) =>
            !partner.settings ||
            !partner.settings.notification ||
            partner.settings.notification.receive !== 'off'
        );
        for (const partner of eligibleAdmins) {
          await sendEmail(partner.email, ownerSubject, ownerMessage);
        }
      }
    }

    // Send welcome email to the prospect
    await sendEmail(surveyData.email, userSubject, userMessage);

    res.status(200).json({ 
      success: true, 
      message: 'Thank you for completing our survey, someone will be in touch with you soon.' 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'An error occurred while saving your survey. Please try again later.'
    });
  }
};


// Partner Survey form handler
export const PartnerSurveyForm = async (req, res) => {
  try {
    const surveyData = req.body;

    // Save the survey data to MongoDB
    const survey = new PartnerSurveyModel(surveyData);
    await survey.save();


    // Send email to form owner
    const ownerSubject = 'Partner Survey Submission';
    const ownerMessage = partnerOwnerEmailTemplate(surveyData);
    const ownerEmails = ['ago.fnc@gmail.com'];
    for (const email of ownerEmails) {
      await sendEmail(email, ownerSubject, ownerMessage);
    }

    res.status(200).json({
        success: true, 
        survey
    });

  } catch (error) {
    res.status(500).json({ 
        success: false,
        error: error.message,
        message: 'An error occurred while processing your request. Please try again later.'
    });
  }
};
