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

module.exports = async (to, subject, text) => {
  try {
    await transporter.sendMail({
      from: `FreshTrack <${process.env.EMAIL_USER}>`,
      to,
      subject,
      text
    });

    console.log(`Email sent to ${to}`);
  } catch (error) {
    console.error(`SMTP email failed for ${to}:`, error.message);

    try {
      const usedFallback = await sendWithResend(to, subject, text);
      if (usedFallback) {
        console.log(`Email sent to ${to} via Resend fallback`);
        return;
      }
    } catch (fallbackError) {
      console.error(`Resend fallback failed for ${to}:`, fallbackError.message);
    }

    throw error;
  }
};
