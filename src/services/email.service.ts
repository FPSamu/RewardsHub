import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// Configuración del transporter de Nodemailer
let transporter: Transporter | null = null;

/**
 * Inicializa el transporter de Nodemailer con las credenciales del entorno.
 * Soporta múltiples proveedores de email (Gmail, Outlook, SMTP personalizado, etc.)
 */
const initializeTransporter = (): Transporter => {
    if (transporter) {
        return transporter;
    }

    const emailService = process.env.EMAIL_SERVICE || 'gmail'; // 'gmail', 'outlook', 'smtp'

    // Configuración para servicios conocidos (Gmail, Outlook, etc.)
    if (emailService !== 'smtp') {
        transporter = nodemailer.createTransport({
            service: emailService,
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD, // Para Gmail, usa "App Password"
            },
        });
    } else {
        // Configuración SMTP personalizada
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true', // true para puerto 465, false para otros
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD,
            },
        });
    }

    // Verificar la conexión al inicializar
    transporter.verify((error: Error | null, success: boolean) => {
        if (error) {
            console.error('⚠️ Error al conectar con el servidor de email:', error);
        } else {
            console.log('✅ Servidor de email listo para enviar mensajes');
        }
    });

    return transporter;
};

/**
 * Función central para enviar correos usando Nodemailer.
 * Soporta HTML y texto plano.
 */
export const sendEmail = async (to: string, subject: string, html: string, text?: string) => {
    const from = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'rewardshubplat@gmail.com';

    try {
        const emailTransporter = initializeTransporter();

        const mailOptions = {
            from: `"RewardsHub" <${from}>`, // Nombre del remitente + email
            to,
            subject,
            html,
            text: text || html.replace(/<[^>]*>/g, ''), // Fallback a texto plano sin HTML
        };

        const info = await emailTransporter.sendMail(mailOptions);
        console.log(`✅ Email enviado exitosamente a: ${to}`);
        console.log(`📧 Message ID: ${info.messageId}`);

        return { success: true, messageId: info.messageId };
    } catch (error: any) {
        console.error('❌ Error al enviar email:', error);

        if (error.code === 'EAUTH') {
            console.error('⚠️ Error de autenticación. Verifica EMAIL_USER y EMAIL_PASSWORD');
        } else if (error.code === 'ECONNECTION') {
            console.error('⚠️ Error de conexión. Verifica SMTP_HOST y SMTP_PORT');
        }

        throw new Error(`Email delivery failed: ${error.message}`);
    }
};

// --- Funciones de lógica de negocio ---

export const sendVerificationEmail = async (to: string, token: string, isBusiness: boolean = false) => {
    const accountType = isBusiness ? 'business' : 'user';
    const verificationUrl = `${process.env.FRONTEND_URL}/${accountType}/verify-email?token=${token}`;
    const subject = `Verify your RewardsHub ${isBusiness ? 'Business ' : ''}Account`;

    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #4CAF50;">Welcome to RewardsHub!</h1>
            <p style="font-size: 16px; color: #333;">Please verify your email address by clicking the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Verify Email</a>
            </div>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${verificationUrl}" style="color: #4CAF50;">${verificationUrl}</a>
            </p>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">If you did not create an account, please ignore this email.</p>
        </div>
    `;

    return sendEmail(to, subject, html);
};

export const sendPasswordResetEmail = async (to: string, token: string, isBusiness: boolean = false) => {
    const accountType = isBusiness ? 'business' : 'user';
    const resetUrl = `${process.env.FRONTEND_URL}/${accountType}/reset-password?token=${token}`;
    const subject = 'Reset your RewardsHub Password';

    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #008CBA;">Password Reset Request</h1>
            <p style="font-size: 16px; color: #333;">You requested a password reset. Click the button below to reset your password:</p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="background-color: #008CBA; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">Reset Password</a>
            </div>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">
                If the button doesn't work, copy and paste this link into your browser:<br>
                <a href="${resetUrl}" style="color: #008CBA;">${resetUrl}</a>
            </p>
            <p style="margin-top: 20px; font-size: 14px; color: #d9534f; font-weight: bold;">⚠️ This link will expire in 1 hour.</p>
            <p style="margin-top: 10px; font-size: 12px; color: #666;">If you did not request this, please ignore this email and your password will remain unchanged.</p>
        </div>
    `;

    return sendEmail(to, subject, html);
};

export const sendRewardReminderEmail = async (to: string, businessName: string, rewardTitle: string, message?: string) => {
    const subject = `Reward Reminder from ${businessName}`;

    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #FF9800;">Hello! 👋</h1>
            <p style="font-size: 16px; color: #333;"><strong>${businessName}</strong> wants to remind you about a reward:</p>
            <div style="background-color: #f9f9f9; padding: 20px; border-left: 4px solid #FF9800; margin: 20px 0;">
                <h2 style="color: #FF9800; margin-top: 0;">${rewardTitle}</h2>
                ${message ? `<p style="font-style: italic; color: #555;">"${message}"</p>` : ''}
            </div>
            <p style="font-size: 16px; color: #333;">Visit us to claim your reward! 🎁</p>
            <p style="margin-top: 20px; font-size: 12px; color: #666;">Thank you for being a valued customer!</p>
        </div>
    `;

    return sendEmail(to, subject, html);
};