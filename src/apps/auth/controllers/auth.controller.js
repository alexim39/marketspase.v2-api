//import { PartnersModel } from "../../partner/models/partner.model.js";
import bcrypt from "bcryptjs";
import { sendEmail, appBaseUrl } from "../../../services/emailService.js";
import { sessionCookieFlags } from "../../../modules/identity-access/interface/Auth.controller.js";
import jwt from "jsonwebtoken";
import dotenv  from "dotenv"
dotenv.config()
import { PartnersModel } from './../../partner/models/partner.model.js';


// Partner registration is retired on the legacy surface — POST /v1/auth/signup
// is the only signup path (transactional consume + verification email).

// Get current signed in user
export const getPartner = async (req, res) => {
  try {
    // Cookie primary, Bearer fallback (see requireAuth) — same cross-site story.
    const header = req.headers?.authorization;
    const bearer = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() : null;
    const token = req.cookies["jwt"] ?? bearer;
    if (!token) {
      return res.status(401).json({ message: "No authentication token provided", success: false });
    }

    let claims;
    try {
      claims = jwt.verify(token, process.env.JWTTOKENSECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid or expired token", success: false });
    }

    if (!claims || !claims.id) {
      return res.status(401).json({ message: "User unauthenticated", success: false });
    }

    const user = await PartnersModel.findById(claims.id);
    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }
    if (user.suspendedAt) {
      return res.status(403).json({ message: "Account suspended — contact support", success: false });
    }
    try {
      const { isSessionRevoked } = await import("../../../modules/identity-access/infrastructure/SessionRevocation.js");
      if (await isSessionRevoked(String(user._id)).catch(() => false)) {
        return res.status(401).json({ message: "Session revoked — sign in again", success: false });
      }
    } catch { /* revocation check unavailable — JWT verification still applies */ }

    const { password: _, ...userObject } = user.toJSON();
    res.status(200).json({ data: userObject, message: 'User authenticated', success: true });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message, success: false });
  }
};

// Partner login
export const signin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required", success: false });
    }

    const user = await PartnersModel.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Wrong email or password", success: false });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Wrong email or password", success: false });
    }
    if (user.suspendedAt) {
      return res.status(403).json({ message: "Account suspended — contact support", success: false });
    }
    if (user.emailVerified === false) {
      return res.status(403).json({
        message: "Please verify your email address before signing in.",
        success: false,
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWTTOKENSECRET, {
      expiresIn: "1d",
    });

    // Fresh login lifts any prior revocation (force-sign-out path).
    try {
      const { clearRevocations } = await import("../../../modules/identity-access/infrastructure/SessionRevocation.js");
      await clearRevocations(String(user._id)).catch(() => null);
    } catch { /* revocation store unavailable — cookie session still applies */ }

    res.cookie("jwt", token, sessionCookieFlags());

    // Bearer fallback in the body (additive): cross-site cookie blocking
    // can drop the Set-Cookie while login succeeds — the SPA replays the
    // token as `Authorization: Bearer`. Cookie remains the primary transport.
    res.status(200).json({ message: "Login successful", success: true, token });
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message, success: false });
  }
};

// Logout
export const partnerSignout = async (req, res) => {
  try {
    res.cookie("jwt", "", { ...sessionCookieFlags(), maxAge: 0 });
    res.status(200).json({ message: "Logged out successfully", success: true });
  } catch (error) {
    res.status(500).json({ message: "Logout failed", error: error.message, success: false });
  }
};








// Reset password
export const requestPasswordReset  = async (req, res) => {

  try {

    const { email } = req.body;
    const SECRET_KEY = process.env.JWTTOKENSECRET;
    const RESET_TOKEN_EXPIRY = '1h'; // Token expires in 1 hour

    const partner = await PartnersModel.findOne({ email });
    if (!partner) return res.status(404).send('Partner not found');

    // Generate JWT token
    const resetToken = jwt.sign({ email: partner.email }, SECRET_KEY, { expiresIn: RESET_TOKEN_EXPIRY });

    // Store the token and expiration in the user's record
    //partner.resetPasswordToken = resetToken;
    //partner.resetPasswordExpires = RESET_TOKEN_EXPIRY;

    // Save the updated user record
    //await partner.save();

    // Create reset URL for the public platform (never a legacy host).
    const resetUrl = `${appBaseUrl()}/partner/reset-password?token=${resetToken}`;

    const mail = await sendEmail(
      email,
      "Password Reset Request",
      `<p>You requested to reset your password. This link expires in 1 hour.</p>
       <p>If you did not request this, please ignore this email.</p>`,
      { title: "Password Reset Request", actionUrl: resetUrl, actionLabel: "Reset password" },
    );
    if (!mail.sent) {
      return res.status(502).json({ message: "Could not send the reset email. Please try again later." });
    }

    res.status(200).json({
      message: "Password reset link sent to your email.",
    });


  } catch (error) {
    console.error(error.message);
    res.status(500).json({
        message: error.message
    })
  }

}

// Reset password
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Check if newPassword is provided
    if (!newPassword) {
      return res.status(400).json({ message: "New password is required." });
    }

    const decoded = jwt.verify(token, process.env.JWTTOKENSECRET);
    const partner = await PartnersModel.findOne({ email: decoded.email });
    if (!partner) return res.status(404).send('Partner not found');

    // Hash the new password
    partner.password = await bcrypt.hash(newPassword, 10);
    await partner.save();

    res.send('Password successfully updated');

  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({
      message: "An error occurred while resetting the password.",
      error: error.message,
    });
  }
};