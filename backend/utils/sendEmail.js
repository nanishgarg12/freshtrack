const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.EMAIL_SMTP_PORT || 465),
  secure: String(process.env.EMAIL_SMTP_SECURE || "true") === "true",
  connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT_MS || 30000),
  greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT_MS || 30000),
  socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT_MS || 30000),
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendWithResend(to, subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.RESEND_FROM || process.env.EMAIL_USER;

  if (!apiKey || !fromAddress) {
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `FreshTrack <${fromAddress}>`,
      to: [to],
      subject,
      text
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Resend failed: ${response.status} ${payload}`);
  }

  return true;
}

async function sendWithSmtp(to, subject, text) {
  await transporter.sendMail({
    from: `FreshTrack <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text
  });
}

module.exports = async (to, subject, text) => {
  const hasResend = Boolean(process.env.RESEND_API_KEY && (process.env.RESEND_FROM || process.env.EMAIL_USER));

  // On Render, SMTP often times out. Prefer HTTP API when available.
  if (hasResend) {
    try {
      await sendWithResend(to, subject, text);
      console.log(`Email sent to ${to} via Resend`);
      return;
    } catch (error) {
      console.error(`Resend primary send failed for ${to}:`, error.message);
    }
  }

  try {
    await sendWithSmtp(to, subject, text);
    console.log(`Email sent to ${to} via SMTP`);
  } catch (error) {
    console.error(`SMTP email failed for ${to}:`, error.message);
    if (!hasResend) {
      console.error("Set RESEND_API_KEY and RESEND_FROM in Render env to avoid SMTP timeout issues.");
    }
    throw new Error(`Email delivery failed for ${to}`);
  }
};
