"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailerConfigured = void 0;
exports.sendMail = sendMail;
exports.lastMailError = lastMailError;
exports.mailerConfig = mailerConfig;
exports.testEmail = testEmail;
exports.verifyMailer = verifyMailer;
exports.passwordResetEmail = passwordResetEmail;
exports.verificationCodeEmail = verificationCodeEmail;
exports.reminderEmail = reminderEmail;
exports.paymentReminderEmail = paymentReminderEmail;
exports.ticketConfirmationEmail = ticketConfirmationEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const brand_1 = require("./brand");
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || `${brand_1.CLUB_NAME} <no-reply@b2club.in>`;
/** True when real SMTP credentials are present. */
exports.mailerConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
let transport = null;
function getTransport() {
    if (!exports.mailerConfigured)
        return null;
    if (transport)
        return transport;
    transport = nodemailer_1.default.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        // 465 is implicit TLS; everything else upgrades via STARTTLS.
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    return transport;
}
async function sendMail(mail) {
    const t = getTransport();
    if (!t) {
        // Dev fallback: show enough to verify the content and the recipient.
        console.log([
            "",
            "──────── EMAIL (not sent — SMTP not configured) ────────",
            `To:      ${mail.to}`,
            `From:    ${MAIL_FROM}`,
            `Subject: ${mail.subject}`,
            "",
            mail.text,
            "────────────────────────────────────────────────────────",
        ].join("\n"));
        return { ok: true, simulated: true };
    }
    try {
        await t.sendMail({ from: MAIL_FROM, ...mail });
        lastSendError = null;
        return { ok: true, simulated: false };
    }
    catch (error) {
        // Never throw at the caller: a failed send must not abort a sweep that
        // still has other recipients to get through.
        const message = error?.message || "send failed";
        console.error(`[mailer] send to ${mail.to} failed:`, message);
        /*
         * An authentication failure is called out by name, because it has one
         * cause here and it has already bitten the club once.
         *
         * Gmail invalidates every App Password when the account password is
         * changed. SMTP_PASS then silently stops working and every verification
         * email fails — so new members cannot confirm their address and cannot
         * register, while the app looks perfectly healthy. Nothing in the logs
         * said "your credential died"; it just said a send failed, which reads
         * like a transient network problem.
         *
         * Recorded as well as logged, so /api/admin/mailer can show it rather
         * than an organiser needing server logs to find out.
         */
        if (isAuthFailure(error)) {
            lastSendError = {
                at: new Date(),
                message,
                hint: "SMTP authentication was rejected. If the club's Gmail password was changed, " +
                    "the App Password in SMTP_PASS is now void — generate a new one at " +
                    "myaccount.google.com/apppasswords and update it in the deployment's environment.",
            };
            console.error(`[mailer] ${lastSendError.hint}`);
        }
        else {
            lastSendError = { at: new Date(), message };
        }
        return { ok: false, simulated: false, error: message };
    }
}
/** Nodemailer's shape for "the server refused these credentials". */
function isAuthFailure(error) {
    if (error?.code === "EAUTH")
        return true;
    // 535 is SMTP's "authentication credentials invalid".
    if (error?.responseCode === 535)
        return true;
    return /invalid login|username and password not accepted|authentication failed/i.test(String(error?.message ?? ""));
}
/**
 * The most recent send failure, for the admin diagnostics panel.
 *
 * In memory only, and lost on restart — which is the right weight for
 * something whose job is to answer "is mail working right now". A durable log
 * of every failure is a different feature and would need a table.
 */
let lastSendError = null;
function lastMailError() {
    return lastSendError;
}
/**
 * Which mail settings are present, for the admin diagnostics panel.
 *
 * Values are never returned — only whether each is set — so the panel can be
 * looked at over a screen share without leaking the SMTP password.
 */
function mailerConfig() {
    return {
        configured: exports.mailerConfigured,
        host: SMTP_HOST ?? null,
        port: SMTP_PORT,
        /** Implicit TLS on 465, STARTTLS elsewhere. */
        secure: SMTP_PORT === 465,
        user_set: Boolean(SMTP_USER),
        pass_set: Boolean(SMTP_PASS),
        from: MAIL_FROM,
        app_url: process.env.APP_URL ?? "http://localhost:5173 (default)",
        missing: [
            ["SMTP_HOST", SMTP_HOST],
            ["SMTP_USER", SMTP_USER],
            ["SMTP_PASS", SMTP_PASS],
        ]
            .filter(([, v]) => !v)
            .map(([k]) => k),
        /*
         * The last failure, so "members aren't getting verification emails" can
         * be diagnosed from the admin panel. Credentials present but rejected
         * looks identical to credentials working, until something tries to
         * send — which is exactly how a dead Gmail App Password went unnoticed.
         */
        last_error: lastSendError
            ? {
                at: lastSendError.at.toISOString(),
                message: lastSendError.message,
                hint: lastSendError.hint ?? null,
            }
            : null,
    };
}
/** A deliberately plain message for confirming delivery actually works. */
function testEmail(input) {
    const html = shell(`
      <p style="margin:0 0 6px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">Test message</p>
      <h1 style="margin:0 0 14px;color:${INK};font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;">Email is working</h1>
      <p style="margin:0 0 18px;color:#a5aab5;font-size:14px;line-height:1.6;">
        Hi ${input.name}, this was sent from the ${brand_1.CLUB_NAME_HTML} backend through
        <strong style="color:${INK};">${input.host}</strong>. If it reached your inbox, event
        reminders and password-reset links will too.
      </p>
      <p style="margin:0;color:#6d737f;font-size:12px;line-height:1.6;">
        Nobody else received this. Sent because an organiser pressed "Send a test email".
      </p>`, `${brand_1.CLUB_NAME_HTML} email is working`);
    const text = [
        "Email is working",
        "",
        `Hi ${input.name},`,
        `This was sent from the ${brand_1.CLUB_NAME} backend through ${input.host}.`,
        "If it reached your inbox, event reminders and password-reset links will too.",
    ].join("\n");
    return { to: "", subject: `${brand_1.CLUB_NAME} — test email`, html, text };
}
/** Verifies the SMTP connection — used by the admin diagnostics endpoint. */
async function verifyMailer() {
    const t = getTransport();
    if (!t)
        return { ok: true, simulated: true };
    try {
        await t.verify();
        return { ok: true, simulated: false };
    }
    catch (error) {
        return { ok: false, simulated: false, error: error?.message || "verify failed" };
    }
}
/* ── Templates ────────────────────────────────────────────── */
const GOLD = "#e9b949";
const INK = "#f5f5f5";
const SURFACE = "#14161a";
const VOID = "#08090b";
function shell(bodyHtml, preheader) {
    // Inline styles only, and a table shell — that is what survives Gmail,
    // Outlook and Apple Mail. No external CSS, no web fonts.
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${brand_1.CLUB_NAME_HTML}</title></head>
<body style="margin:0;padding:0;background:${VOID};">
<div style="display:none;font-size:1px;color:${VOID};max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${VOID};padding:28px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${SURFACE};border:1px solid rgba(255,255,255,0.08);border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="padding:22px 26px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${GOLD};border-radius:9px;width:32px;height:32px;text-align:center;vertical-align:middle;font-weight:800;color:#161000;font-size:15px;">${brand_1.CLUB_MONOGRAM_HTML}</td>
        <td style="padding-left:10px;font-weight:800;letter-spacing:-0.02em;color:${INK};font-size:16px;">${brand_1.CLUB_WORDMARK_HTML}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 26px 28px;">${bodyHtml}</td></tr>
    <tr><td style="padding:16px 26px 22px;border-top:1px solid rgba(255,255,255,0.08);color:#6d737f;font-size:11px;line-height:1.6;">
      You're getting this because you registered for a ${brand_1.CLUB_NAME_HTML} session.<br>
      Every run starts with one step. Bring water.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
function passwordResetEmail(input) {
    const html = shell(`
      <p style="margin:0 0 6px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">Password reset</p>
      <h1 style="margin:0 0 14px;color:${INK};font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;">Set a new password</h1>
      <p style="margin:0 0 18px;color:#a5aab5;font-size:14px;line-height:1.6;">
        Hi ${input.name}, use the button below to choose a new password. The link works once and
        expires in ${input.minutes} minutes.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0;">
        <tr><td style="background:${GOLD};border-radius:10px;">
          <a href="${input.link}" style="display:inline-block;padding:12px 22px;color:#161000;font-size:14px;font-weight:700;text-decoration:none;">Choose a new password</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;color:#6d737f;font-size:12px;line-height:1.6;">
        If you didn't ask for this, you can ignore it — your password stays as it is.
      </p>`, `Set a new ${brand_1.CLUB_NAME_HTML} password`);
    const text = [
        "Set a new password",
        "",
        `Hi ${input.name},`,
        `Use this link to choose a new password. It works once and expires in ${input.minutes} minutes.`,
        "",
        input.link,
        "",
        "If you didn't ask for this, ignore it — your password stays as it is.",
    ].join("\n");
    return { to: "", subject: `Reset your ${brand_1.CLUB_NAME} password`, html, text };
}
/**
 * The one-time code for proving an email address.
 *
 * No link, deliberately. A click-to-verify link in an email is a redirect a
 * phishing kit can imitate, and it breaks when the member opens their mail on a
 * different device from the one they signed up on — which for a club whose
 * members sign up on a phone and read Gmail on a laptop is most of them. A code
 * they read and type works from anywhere and proves the same thing.
 */
function verificationCodeEmail(input) {
    const html = shell(`
      <p style="margin:0 0 6px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">Verify your email</p>
      <h1 style="margin:0 0 14px;color:${INK};font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-0.03em;">Your code is ${input.code}</h1>
      <p style="margin:0 0 18px;color:#a5aab5;font-size:14px;line-height:1.6;">
        Hi ${input.name}, enter this code in the app to confirm this is your address.
        It expires in ${input.minutes} minutes.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0;">
        <tr><td style="background:rgba(233,185,73,0.10);border:1px solid rgba(233,185,73,0.35);border-radius:10px;">
          <span style="display:inline-block;padding:14px 26px;color:${GOLD};font-size:30px;font-weight:800;letter-spacing:0.22em;font-family:'SF Mono',Menlo,Consolas,monospace;">${input.code}</span>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;color:#6d737f;font-size:12px;line-height:1.6;">
        If you didn't ask for this, you can ignore it. Nobody can use this code but you,
        and we'll never ask you for it by phone or on WhatsApp.
      </p>`, `${input.code} is your ${brand_1.CLUB_NAME_HTML} verification code`);
    const text = [
        "Verify your email",
        "",
        `Hi ${input.name},`,
        `Your ${brand_1.CLUB_NAME} verification code is ${input.code}.`,
        `It expires in ${input.minutes} minutes.`,
        "",
        "If you didn't ask for this, ignore it. We'll never ask you for this code",
        "by phone or on WhatsApp.",
    ].join("\n");
    return {
        to: "",
        subject: `${input.code} is your ${brand_1.CLUB_NAME} verification code`,
        html,
        text,
    };
}
function reminderEmail(input) {
    const lead = input.hoursBefore >= 24
        ? `in ${Math.round(input.hoursBefore / 24)} day${input.hoursBefore >= 48 ? "s" : ""}`
        : `in ${input.hoursBefore} hour${input.hoursBefore === 1 ? "" : "s"}`;
    const action = input.ticketReady
        ? `<p style="margin:0 0 6px;color:#a5aab5;font-size:14px;line-height:1.6;">Your QR ticket is ready — have it open at the start line.</p>`
        : `<p style="margin:0 0 6px;color:#fab219;font-size:14px;line-height:1.6;">Your spot is held but ${input.amountDue ?? "payment"} is still outstanding. Settle it before the day to keep your place.</p>`;
    const html = shell(`
      <p style="margin:0 0 6px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">Starts ${lead}</p>
      <h1 style="margin:0 0 14px;color:${INK};font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-0.03em;">${input.eventTitle}</h1>
      <p style="margin:0 0 18px;color:#a5aab5;font-size:14px;line-height:1.6;">
        Hi ${input.name}, a quick reminder.<br>
        <strong style="color:${INK};">${input.when}</strong><br>${input.location}
      </p>
      ${action}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
        <tr><td style="background:${GOLD};border-radius:10px;">
          <a href="${input.ticketUrl}" style="display:inline-block;padding:12px 22px;color:#161000;font-size:14px;font-weight:700;text-decoration:none;">
            ${input.ticketReady ? "View your ticket" : "Open my tickets"}
          </a>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;color:#6d737f;font-size:12px;line-height:1.6;">
        Arrive 15 minutes early for the briefing. Marshals carry a club ID card — follow their calls at junctions.
      </p>`, `${input.eventTitle} starts ${lead} — ${input.when}`);
    const text = [
        `${input.eventTitle} starts ${lead}.`,
        "",
        `Hi ${input.name},`,
        `${input.when}`,
        `${input.location}`,
        "",
        input.ticketReady
            ? "Your QR ticket is ready — have it open at the start line."
            : `Your spot is held but ${input.amountDue ?? "payment"} is still outstanding.`,
        "",
        input.ticketUrl,
        "",
        "Arrive 15 minutes early for the briefing.",
    ].join("\n");
    return {
        to: "",
        subject: `${input.eventTitle} — starts ${lead}`,
        html,
        text,
    };
}
/**
 * The awaiting-payment nudge, sent partway through a booking's 24-hour hold.
 *
 * Distinct from the event reminder above, which is timed from the event and
 * mentions payment in passing. This one is about the deadline and says the two
 * things a member needs in order to act: what is owed, and how long is left.
 *
 * The time left is stated rather than the deadline timestamp. "16 hours left"
 * needs no timezone and cannot be misread; "expires at 06:00" was the shape of
 * bug that started this whole piece of work.
 */
function paymentReminderEmail(input) {
    const html = shell(`
      <p style="margin:0 0 6px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">Payment pending</p>
      <h1 style="margin:0 0 14px;color:${INK};font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-0.03em;">${input.eventTitle}</h1>
      <p style="margin:0 0 18px;color:#a5aab5;font-size:14px;line-height:1.6;">
        Hi ${input.name}, your spot is held but not yet paid for.<br>
        <strong style="color:${INK};">${input.when}</strong><br>${input.location}
      </p>
      <p style="margin:0 0 6px;color:#fab219;font-size:14px;line-height:1.6;">
        <strong>${input.amountDue}</strong> outstanding — about <strong>${input.timeLeft}</strong> left
        before the spot goes back to other members.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
        <tr><td style="background:${GOLD};border-radius:10px;">
          <a href="${input.payUrl}" style="display:inline-block;padding:12px 22px;color:#161000;font-size:14px;font-weight:700;text-decoration:none;">
            Complete payment
          </a>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;color:#6d737f;font-size:12px;line-height:1.6;">
        Already paid? Open the link above and your ticket will appear — no need to pay twice.
        If the spot does expire you can register again while places remain.
      </p>`, `${input.amountDue} outstanding for ${input.eventTitle} — about ${input.timeLeft} left`);
    const text = [
        `Your spot for ${input.eventTitle} is held but not yet paid for.`,
        "",
        `Hi ${input.name},`,
        `${input.when}`,
        `${input.location}`,
        "",
        `${input.amountDue} outstanding — about ${input.timeLeft} left before the spot is released.`,
        "",
        input.payUrl,
        "",
        "Already paid? Open the link and your ticket will appear — no need to pay twice.",
    ].join("\n");
    return {
        to: "",
        subject: `${input.eventTitle} — ${input.amountDue} outstanding, ${input.timeLeft} left`,
        html,
        text,
    };
}
/**
 * Sent immediately when a member's payment is confirmed (PAID) or when a
 * free/comped registration is completed (FREE). Tells them their ticket is
 * ready so they are not left guessing after the Razorpay overlay closes.
 *
 * Also emitted by the reconciliation sweep when a UPI payment that closed the
 * browser tab is detected later — so the email arrives only once the money is
 * confirmed, never for a stuck PENDING booking.
 */
function ticketConfirmationEmail(input) {
    const paidLine = input.isFree
        ? `<p style="margin:0 0 6px;color:#48bb78;font-size:14px;line-height:1.6;">Your place is confirmed — no payment required.</p>`
        : `<p style="margin:0 0 6px;color:#48bb78;font-size:14px;line-height:1.6;">Payment of <strong style="color:${INK};">${input.amountPaid}</strong> confirmed. Your QR ticket is ready.</p>`;
    const html = shell(`
      <p style="margin:0 0 6px;color:${GOLD};font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">Registration confirmed</p>
      <h1 style="margin:0 0 14px;color:${INK};font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-0.03em;">${input.eventTitle}</h1>
      <p style="margin:0 0 18px;color:#a5aab5;font-size:14px;line-height:1.6;">
        Hi ${input.name}, you're in!<br>
        <strong style="color:${INK};">${input.when}</strong><br>${input.location}
      </p>
      ${paidLine}
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
        <tr><td style="background:${GOLD};border-radius:10px;">
          <a href="${input.ticketUrl}" style="display:inline-block;padding:12px 22px;color:#161000;font-size:14px;font-weight:700;text-decoration:none;">View my ticket</a>
        </td></tr>
      </table>
      <p style="margin:18px 0 0;color:#6d737f;font-size:12px;line-height:1.6;">
        Have this QR code ready at the start line. Arrive 15 minutes early for the briefing.
      </p>`, `You're registered for ${input.eventTitle}`);
    const text = [
        `Registration confirmed — ${input.eventTitle}`,
        "",
        `Hi ${input.name}, you're in!`,
        `${input.when}`,
        `${input.location}`,
        "",
        input.isFree
            ? "Your place is confirmed — no payment required."
            : `Payment of ${input.amountPaid} confirmed. Your QR ticket is ready.`,
        "",
        input.ticketUrl,
        "",
        "Have your QR code ready at the start line. Arrive 15 minutes early.",
    ].join("\n");
    return {
        to: "",
        subject: `You're registered for ${input.eventTitle}`,
        html,
        text,
    };
}
