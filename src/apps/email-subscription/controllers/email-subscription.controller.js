import { createHash, randomBytes } from 'crypto';
import { EmailSubscriptionModel } from '../models/email-subscription.model.js';
import { sendEmail } from "../../../services/emailService.js";

const newToken = () => randomBytes(32).toString('hex');
const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const publicSiteUrl = () => (process.env.PUBLIC_SITE_URL || 'https://diamondproject.c21fg.online').replace(/\/+$/, '');

const apiBaseUrl = (req) => {
    const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    const host = String(req.get('x-forwarded-host') || req.get('host') || '').trim();
    return (process.env.API_BASE_URL || `${proto}://${host}`).replace(/\/+$/, '');
};

const alertRecipients = () => String(
    process.env.EMAIL_SUBSCRIPTION_ALERTS
    || process.env.SUPPORT_OWNER_EMAILS
    || 'contacts@c21fg.online'
).split(',').map((email) => email.trim()).filter(Boolean);

const safeSubscription = (subscription) => ({
    email: subscription.email,
    status: subscription.status,
    confirmedAt: subscription.confirmedAt ?? null,
});

const responsePage = (title, message, actionUrl = null, actionLabel = 'Visit Diamond Project') => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Diamond Project</title>
</head>
<body style="margin:0;padding:0;background:#faf8f3;font-family:Arial,Helvetica,sans-serif;color:#1c1a15;">
  <main style="max-width:560px;margin:10vh auto;padding:32px 24px;background:#ffffff;border:1px solid #e4ddcd;border-radius:12px;text-align:center;">
    <p style="color:#a97f2c;font-weight:bold;letter-spacing:.12em;text-transform:uppercase;font-size:12px;">Diamond Project</p>
    <h1 style="margin:0 0 12px;font-size:26px;">${escapeHtml(title)}</h1>
    <p style="line-height:1.6;color:#444;">${escapeHtml(message)}</p>
    ${actionUrl ? `<a href="${escapeHtml(actionUrl)}" style="display:inline-block;margin-top:16px;padding:12px 24px;border-radius:6px;background:#a97f2c;color:#fff;text-decoration:none;font-weight:bold;">${escapeHtml(actionLabel)}</a>` : ''}
  </main>
</body>
</html>`;

export const emailSubscription = async (req, res) => {
    try {
        const email = String(req.body?.email ?? '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address.",
            });
        }

        const existing = await EmailSubscriptionModel.findOne({ email })
            .select('+confirmTokenHash +unsubscribeTokenHash')
            .collation({ locale: 'en', strength: 2 });
        if (existing?.status === 'Subscribed') {
            return res.status(200).json({
                success: true,
                message: "You are already subscribed. We will not spam your mailbox.",
                emailSubscription: safeSubscription(existing),
            });
        }

        const token = newToken();
        const subscription = existing ?? new EmailSubscriptionModel({ email });
        subscription.email = email;
        subscription.userDevice = req.body?.userDevice;
        subscription.username = req.body?.username || 'business';
        subscription.status = 'Pending';
        subscription.confirmTokenHash = hashToken(token);
        subscription.confirmExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        subscription.confirmedAt = undefined;
        subscription.unsubscribedAt = undefined;
        subscription.unsubscribeTokenHash = undefined;
        await subscription.save();

        const confirmUrl = `${apiBaseUrl(req)}/emailSubscription/confirm/${token}`;
        const sent = await sendEmail(
            email,
            'Confirm your Diamond Project subscription',
            `<p>Hi,</p>
             <p>Please confirm that you want to receive occasional updates and insights from Diamond Project.</p>
             <p>This link expires in 24 hours. If you did not request this, you can safely ignore this email.</p>`,
            { actionUrl: confirmUrl, actionLabel: 'Confirm subscription' }
        );

        if (!sent?.sent) {
            return res.status(502).json({
                success: false,
                message: "We could not send the confirmation email. Please try again shortly.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Check your inbox and confirm your subscription.",
            emailSubscription: safeSubscription(subscription),
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            message: "Error subscribing to email list",
        })
    }
};

export const confirmEmailSubscription = async (req, res) => {
    try {
        const token = String(req.params.token ?? '');
        if (!token) {
            return res.status(400).type('html').send(responsePage('Invalid link', 'This confirmation link is not valid.'));
        }

        const hash = hashToken(token);
        const subscription = await EmailSubscriptionModel.findOne({
            confirmTokenHash: hash,
            confirmExpiresAt: { $gt: new Date() },
        }).select('+confirmTokenHash +unsubscribeTokenHash');

        if (!subscription) {
            const expired = await EmailSubscriptionModel.findOne({ confirmTokenHash: hash }).catch(() => null);
            return res.status(expired ? 410 : 404).type('html').send(
                responsePage(
                    expired ? 'Link expired' : 'Invalid link',
                    expired
                        ? 'This confirmation link has expired. Please subscribe again from the website.'
                        : 'This confirmation link is not valid or has already been used.',
                    publicSiteUrl(),
                    'Back to Diamond Project'
                )
            );
        }

        const unsubscribeToken = newToken();
        subscription.status = 'Subscribed';
        subscription.confirmedAt = new Date();
        subscription.confirmTokenHash = undefined;
        subscription.confirmExpiresAt = undefined;
        subscription.unsubscribeTokenHash = hashToken(unsubscribeToken);
        await subscription.save();

        const unsubscribeUrl = `${apiBaseUrl(req)}/emailSubscription/unsubscribe/${unsubscribeToken}`;
        await sendEmail(
            subscription.email,
            'You are subscribed to Diamond Project updates',
            `<p>Hi,</p>
             <p>Your subscription is confirmed. You will receive occasional updates, insights and event news from Diamond Project.</p>
             <p>You can unsubscribe at any time using the link below.</p>`,
            { actionUrl: unsubscribeUrl, actionLabel: 'Unsubscribe' }
        );

        const alertSubject = 'New confirmed email subscriber';
        const alertMessage = `<p>${escapeHtml(subscription.email)} confirmed their Diamond Project email subscription.</p>
            <p>Partner attribution: ${escapeHtml(subscription.username || 'business')}</p>`;
        await Promise.all(alertRecipients().map((recipient) => sendEmail(recipient, alertSubject, alertMessage)));

        return res.status(200).type('html').send(
            responsePage(
                'Subscription confirmed',
                'Thank you. You are now subscribed to occasional Diamond Project updates.',
                publicSiteUrl(),
                'Back to Diamond Project'
            )
        );

    } catch (error) {
        res.status(500).type('html').send(
            responsePage('Something went wrong', 'We could not confirm your subscription. Please try again later.')
        );
    }
};

export const unsubscribeEmailSubscription = async (req, res) => {
    try {
        const token = String(req.params.token ?? '');
        if (!token) {
            return res.status(400).type('html').send(responsePage('Invalid link', 'This unsubscribe link is not valid.'));
        }

        const subscription = await EmailSubscriptionModel.findOne({ unsubscribeTokenHash: hashToken(token) });
        if (!subscription) {
            return res.status(404).type('html').send(
                responsePage(
                    'Invalid link',
                    'This unsubscribe link is not valid or has already been used.',
                    publicSiteUrl(),
                    'Back to Diamond Project'
                )
            );
        }

        subscription.status = 'Unsubscribed';
        subscription.unsubscribedAt = new Date();
        await subscription.save();

        return res.status(200).type('html').send(
            responsePage(
                'You are unsubscribed',
                'You will no longer receive Diamond Project email updates. You can subscribe again at any time.',
                publicSiteUrl(),
                'Back to Diamond Project'
            )
        );

    } catch (error) {
        res.status(500).type('html').send(
            responsePage('Something went wrong', 'We could not process your unsubscribe request. Please try again later.')
        );
    }
};

export const deleteSingleEmailFromEmailList = async (req, res) => {
    try {
      const { emailId } = req.params;
      const email = await EmailSubscriptionModel.findById(emailId);

      if (!email) {
        return res.status(404).json({
          message: "Email not found",
          success: false,
        });
      }

      await EmailSubscriptionModel.findByIdAndDelete(emailId);

      res.status(200).json({
        message: "Email deleted successfully!",
        success: true,
      });
    } catch (error) {
      res.status(500).json({
        message: "Error deleting email",
        error: error.message,
        success: false,
      });
    }
  };
