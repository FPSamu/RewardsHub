import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: 'smtp.sendgrid.net',
    port: 443, // Using port 443 as requested to avoid blocking
    secure: true, // Use SSL/TLS
    auth: {
        user: 'apikey', // SendGrid requires 'apikey' as the username
        pass: process.env.SENDGRID_API_KEY,
    },
});

export const sendEmail = async (to: string, subject: string, html: string) => {
    const from = process.env.EMAIL_FROM || 'noreply@rewardshub.com';
    
    try {
        const info = await transporter.sendMail({
            from,
            to,
            subject,
            html,
        });
        console.log(`Email sent: ${info.messageId}`);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
};

export const sendVerificationEmail = async (to: string, token: string) => {
    const verificationUrl = `${process.env.FRONTEND_URL}/business/verify-email?token=${token}`;
    const subject = 'Verify your RewardsHub Business Account';
    const html = `
        <h1>Welcome to RewardsHub!</h1>
        <p>Please verify your email address by clicking the link below:</p>
        <a href="${verificationUrl}">Verify Email</a>
        <p>If you did not create an account, please ignore this email.</p>
    `;
    return sendEmail(to, subject, html);
};

export const sendPasswordResetEmail = async (to: string, token: string) => {
    const resetUrl = `${process.env.FRONTEND_URL}/business/reset-password?token=${token}`;
    const subject = 'Reset your RewardsHub Password';
    const html = `
        <h1>Password Reset Request</h1>
        <p>You requested a password reset. Click the link below to reset your password:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>If you did not request this, please ignore this email.</p>
        <p>This link will expire in 1 hour.</p>
    `;
    return sendEmail(to, subject, html);
};

export const sendRewardReminderEmail = async (to: string, businessName: string, rewardTitle: string, message?: string) => {
    const subject = `Reward Reminder from ${businessName}`;
    const html = `
        <h1>Hello!</h1>
        <p>${businessName} wants to remind you about a reward:</p>
        <h2>${rewardTitle}</h2>
        ${message ? `<p>${message}</p>` : ''}
        <p>Visit us to claim your reward!</p>
    `;
    return sendEmail(to, subject, html);
};
