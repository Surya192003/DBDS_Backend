const nodemailer = require('nodemailer');

// Configure your SMTP settings via environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,               // e.g., smtp.gmail.com
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,             // your email
    pass: process.env.SMTP_PASS              // your password / app-specific password
  }
});

exports.sendPasswordResetEmail = async (to, userName, resetLink) => {
  const mailOptions = {
    from: `"DBDS Ireland" <${process.env.SMTP_USER}>`,
    to,
    subject: 'Password Reset Request',
    text: `Hi ${userName},\n\n` +
          `We received a request to reset your password for your DBDS Ireland account.\n\n` +
          `Please click the link below to reset your password (valid for 1 hour):\n` +
          `${resetLink}\n\n` +
          `If you did not request this, please ignore this email.\n\n` +
          `Best regards,\nDBDS Ireland Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #FD6585;">DBDS Ireland</h2>
        <p>Hi ${userName},</p>
        <p>We received a request to reset your password for your DBDS Ireland account.</p>
        <p>
          <a href="${resetLink}" 
             style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #FFD3A5, #FD6585); 
                    color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">
            Reset Password
          </a>
        </p>
        <p style="margin-top: 20px; font-size: 0.9em; color: #666;">
          This link is valid for 1 hour. If you did not request this, please ignore this email.
        </p>
        <hr style="border: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 0.8em; color: #999;">DBDS Ireland – Dance Academy</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
};