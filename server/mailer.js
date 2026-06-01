const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter object using SMTP transport
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE === 'true' || true, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const baseEmailTemplate = (title, content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 0; color: #0f172a; }
    .email-wrapper { padding: 40px 20px; background-color: #f8fafc; }
    .email-card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
    .email-header { background: linear-gradient(135deg, #0ea5e9 0%, #8b5cf6 100%); padding: 30px; text-align: center; color: white; }
    .email-header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .email-body { padding: 40px 30px; line-height: 1.6; font-size: 16px; color: #334155; }
    .code-block { background: #f0fdf4; border: 2px dashed #10b981; border-radius: 12px; padding: 20px; text-align: center; margin: 30px 0; }
    .code-text { font-size: 32px; font-weight: 900; color: #047857; letter-spacing: 4px; font-family: monospace; }
    .alert-block { background: #fff1f2; border: 2px dashed #e11d48; border-radius: 12px; padding: 20px; text-align: center; margin: 30px 0; }
    .alert-text { font-size: 24px; font-weight: 800; color: #be123c; }
    .email-footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-card">
      <div class="email-header">
        <h1>${title}</h1>
      </div>
      <div class="email-body">
        ${content}
      </div>
      <div class="email-footer">
        &copy; ${new Date().getFullYear()} OlasTech Link. All rights reserved.<br>
        Encrypted Connection &middot; Omada Auth System V2.1
      </div>
    </div>
  </div>
</body>
</html>
`;

/**
 * Send the success email with the access code
 */
async function sendSuccessEmail(toEmail, accessCode, planName, amount) {
  if (!process.env.SMTP_USER || !toEmail) return false;

  const content = `
    <p>Hi there,</p>
    <p>Thank you for choosing <strong>OlasTech Link</strong>! Your payment for the <strong>${planName}</strong> plan (₦${amount}) was successful.</p>
    <p>Here is your secure access token to connect to the network:</p>
    
    <div class="code-block">
      <div style="font-size: 12px; color: #059669; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Access Code</div>
      <div class="code-text">${accessCode}</div>
    </div>
    
    <p><strong>How to connect:</strong></p>
    <ol style="padding-left: 20px;">
      <li>Connect your device to the <strong>OlasTech_WIFI</strong> network.</li>
      <li>When the login portal appears, tap "Authenticate here".</li>
      <li>Enter your exact Access Code above.</li>
    </ol>
    <p>Enjoy your ultra-fast internet!</p>
  `;

  const mailOptions = {
    from: `"OlasTech Link" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Your Internet Access Code - OlasTech Link',
    html: baseEmailTemplate('Connection Approved', content),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[mailer] Success email sent to ${toEmail}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error('[mailer] Error sending success email:', err.message);
    return false;
  }
}

/**
 * Send warning email when 200MB is remaining
 */
async function sendWarningEmail(toEmail, dataRemainingMB) {
  if (!process.env.SMTP_USER || !toEmail) return false;

  const content = `
    <p>Hi there,</p>
    <p>We are writing to let you know that your internet session is running low on data.</p>
    
    <div class="alert-block" style="background: #fff7ed; border-color: #f97316;">
      <div style="font-size: 12px; color: #c2410c; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Remaining Data</div>
      <div class="alert-text" style="color: #ea580c;">${Math.max(0, dataRemainingMB).toFixed(1)} MB</div>
    </div>
    
    <p>To avoid any unexpected interruptions to your connection, please prepare to purchase a new plan from the portal once your current session expires.</p>
  `;

  const mailOptions = {
    from: `"OlasTech Link" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Data Running Low - OlasTech Link',
    html: baseEmailTemplate('Data Usage Warning', content),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[mailer] Warning email sent to ${toEmail}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error('[mailer] Error sending warning email:', err.message);
    return false;
  }
}

/**
 * Send exhaustion email when data is depleted
 */
async function sendDepletionEmail(toEmail) {
  if (!process.env.SMTP_USER || !toEmail) return false;

  const content = `
    <p>Hi there,</p>
    <p>You have successfully used up all the data allocated to your current plan.</p>
    
    <div class="alert-block">
      <div style="font-size: 12px; color: #be123c; text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Status</div>
      <div class="alert-text">Data Exhausted</div>
    </div>
    
    <p>Your devices have been safely disconnected from the network. Whenever you are ready to get back online, simply reconnect to the Wi-Fi and purchase a new access token from the portal!</p>
  `;

  const mailOptions = {
    from: `"OlasTech Link" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Data Exhausted - OlasTech Link',
    html: baseEmailTemplate('Data Exhausted', content),
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[mailer] Depletion email sent to ${toEmail}: ${info.messageId}`);
    return true;
  } catch (err) {
    console.error('[mailer] Error sending depletion email:', err.message);
    return false;
  }
}

module.exports = {
  sendSuccessEmail,
  sendWarningEmail,
  sendDepletionEmail,
};
