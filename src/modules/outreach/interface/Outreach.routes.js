import express from 'express';
import { z } from 'zod';
import { validate } from '../../../shared/http/validate.js';
import { requireAuth } from '../../../shared/http/requireAuth.js';
import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import {
  CancelScheduledSmsUseCase, ListMyEmailsUseCase, ListMySmsUseCase,
  ListScheduledSmsUseCase, ScheduleBulkSmsUseCase, SendBulkEmailUseCase, SendBulkSmsUseCase,
} from '../application/Outreach.usecases.js';
import { SmsDeliveryCallbackUseCase } from '../application/Outreach.delivery.js';
import { outreachDeps, outreachSms } from '../infrastructure/Outreach.store.js';
import { env } from '../../../shared/config/env.js';

const objectId = z.string().trim().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

/** 11-char sender ids stay valid if a provider ever accepts per-send from. */
const BulkSmsSchema = z.object({
  to: z.array(z.string().trim().min(7).max(20)).min(1).max(200),
  body: z.string().trim().min(1).max(960),
  campaignId: objectId.optional(),
});

const ScheduleSmsSchema = BulkSmsSchema.extend({
  sendAt: z.coerce.date(),
});

const EmailSchema = z.object({
  to: z.array(z.string().trim().email().max(254)).min(1).max(200),
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20000),
});

const ScheduleEmailSchema = EmailSchema.extend({
  sendAt: z.coerce.date(),
});

const ScheduleIdParam = z.object({ scheduleId: objectId });

/** Manual wiring — explicit for onboarding; pass fakes in tests. */
export const buildOutreachRouter = (deps = {}) => {
  const stores = outreachDeps(deps);
  const link = outreachSms({ smsEnv: deps.smsEnv ?? env.sms });
  const sendBulk = deps.sendBulk
    ?? new SendBulkSmsUseCase({ ...stores, sms: link.sms, smsEnabled: link.smsEnabled });
  const sendEmail = deps.sendEmail
    ?? new SendBulkEmailUseCase({ partners: stores.partners, records: stores.emailRecords });
  const scheduleBulk = deps.scheduleBulk ?? new ScheduleBulkSmsUseCase(stores);
  const listScheduled = deps.listScheduled ?? new ListScheduledSmsUseCase(stores);
  const cancelScheduled = deps.cancelScheduled ?? new CancelScheduledSmsUseCase(stores);
  const mySms = deps.mySms ?? new ListMySmsUseCase({ records: stores.records, transactions: stores.transactions });
  const myEmails = deps.myEmails ?? new ListMyEmailsUseCase({ emailRecords: stores.emailRecords });
  const deliveryCallback = deps.deliveryCallback ?? new SmsDeliveryCallbackUseCase({
    records: stores.records,
    callbackToken: deps.callbackToken ?? process.env.SMS_CALLBACK_TOKEN ?? '',
  });

  const router = express.Router();
  // Delivery reports come from the provider (no session) — mounted before auth.
  router.post('/sms/delivery', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const data = await deliveryCallback.execute({
      token: req.query.token ?? body.token,
      reference: body.customer_reference ?? body.reference ?? body.ref,
      status: body.status ?? body.delivery_status ?? body.state ?? body.event,
      raw: body,
    });
    res.status(200).json({ message: 'Delivery report received', data, success: true });
  }));

  // Session identity owns the wallet charge — no body partnerId to tamper with.
  router.use(requireAuth);

  router.post('/sms', validate({ body: BulkSmsSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await sendBulk.execute({ partnerId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: `SMS sent to ${data.sent} of ${data.total} recipients`, data, success: true });
  }));

  router.post('/sms/schedule', validate({ body: ScheduleSmsSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await scheduleBulk.execute({ partnerId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: 'SMS scheduled successfully', data, success: true });
  }));

  router.get('/sms/scheduled', asyncHandler(async (req, res) => {
    const data = await listScheduled.execute({ partnerId: req.auth?.partnerId, channel: 'sms' });
    res.status(200).json({ message: 'Scheduled sends retrieved successfully', data, success: true });
  }));

  router.delete('/sms/scheduled/:scheduleId', validate({ params: ScheduleIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await cancelScheduled.execute({ partnerId: req.auth?.partnerId, scheduleId: params.scheduleId });
    res.status(200).json({ message: 'Scheduled send cancelled', data, success: true });
  }));

  router.post('/email', validate({ body: EmailSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await sendEmail.execute({ partnerId: req.auth?.partnerId, ...body });
    res.status(200).json({ message: `Email sent to ${data.sent} of ${data.total} recipients`, data, success: true });
  }));

  // Session-owned inboxes — owner from the session, never a URL param.
  router.get('/sms/mine', requireAuth, asyncHandler(async (req, res) => {
    const data = await mySms.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'SMS history retrieved successfully', data, success: true });
  }));

  router.get('/email/mine', requireAuth, asyncHandler(async (req, res) => {
    const data = await myEmails.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Email history retrieved successfully', data, success: true });
  }));

  router.post('/email/schedule', validate({ body: ScheduleEmailSchema }), asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await scheduleBulk.execute({
      partnerId: req.auth?.partnerId,
      channel: 'email',
      to: body.to,
      subject: body.subject,
      body: body.body,
      sendAt: body.sendAt,
    });
    res.status(200).json({ message: 'Email scheduled successfully', data, success: true });
  }));

  router.get('/email/scheduled', asyncHandler(async (req, res) => {
    const data = await listScheduled.execute({ partnerId: req.auth?.partnerId, channel: 'email' });
    res.status(200).json({ message: 'Scheduled emails retrieved successfully', data, success: true });
  }));

  router.delete('/email/scheduled/:scheduleId', validate({ params: ScheduleIdParam }), asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await cancelScheduled.execute({ partnerId: req.auth?.partnerId, scheduleId: params.scheduleId });
    res.status(200).json({ message: 'Scheduled email cancelled', data, success: true });
  }));

  return router;
};

export default buildOutreachRouter();
