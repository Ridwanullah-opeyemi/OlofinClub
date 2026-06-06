import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Create the reusable transporter engine using your SMTP configurations
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com", 
  port: process.env.EMAIL_PORT || 465,
  secure: true, // true for port 465, false for other ports
  auth: {
    user: process.env.SYSTEM_EMAIL, // Your platform email address
    pass: process.env.SYSTEM_EMAIL_PASSWORD, // Your email app-specific password
  },
});

// Reusable function to send automated system emails
export const sendSystemEmail = async (toEmail, subject, htmlContent) => {
  try {
    const mailOptions = {
      from: `"Olofin Heritage Club" <${process.env.SYSTEM_EMAIL}>`,
      to: toEmail,
      subject: subject,
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    console.log(`[EMAIL SYSTEM] Message successfully delivered to ${toEmail}`);
  } catch (error) {
    console.error("[EMAIL SYSTEM] Error dispatching mail transit: ", error.message);
  }
};