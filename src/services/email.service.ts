import sgMail from '@sendgrid/mail';

// Configuración inicial de la API Key
if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
    console.error("⚠️ ALERTA: No se encontró SENDGRID_API_KEY en las variables de entorno.");
}

/**
 * Función central para enviar correos usando la API HTTP de SendGrid.
 * Esto evita los bloqueos de puertos SMTP en servidores como Render/AWS.
 */
export const sendEmail = async (to: string, subject: string, html: string) => {
    // IMPORTANTE: Este email debe estar verificado en "Sender Authentication" en SendGrid
    const from = process.env.EMAIL_FROM || 'rewardshubplat@gmail.com'; 

    const msg = {
        to,
        from, 
        subject,
        html,
    };

    try {
        await sgMail.send(msg);
        console.log(`Email sent successfully to: ${to}`);
        return { success: true };
    } catch (error: any) {
        console.error('Error sending email via SendGrid:', error);

        if (error.response) {
            // SendGrid devuelve detalles muy útiles en error.response.body
            console.error('SendGrid Error Body:', error.response.body);
        }
        
        // No lanzamos el error para no romper el flujo de la app (opcional, depende de tu lógica)
        // pero retornamos false para saber que falló.
        throw new Error('Email delivery failed'); 
    }
};

// --- Tus funciones originales (Lógica de negocio) ---

export const sendVerificationEmail = async (to: string, token: string, isBusiness: boolean = false) => {
    const accountType = isBusiness ? 'business' : 'user';
    // Asegúrate de que FRONTEND_URL no tenga slash al final en el .env, o ajusta aquí
    const verificationUrl = `${process.env.FRONTEND_URL}/${accountType}/verify-email?token=${token}`;
    const subject = `Verify your RewardsHub ${isBusiness ? 'Business ' : ''}Account`;
    
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h1>Welcome to RewardsHub!</h1>
            <p>Please verify your email address by clicking the link below:</p>
            <a href="${verificationUrl}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Verify Email</a>
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
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h1>Password Reset Request</h1>
            <p>You requested a password reset. Click the link below to reset your password:</p>
            <a href="${resetUrl}" style="background-color: #008CBA; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Password</a>
            <p>If you did not request this, please ignore this email.</p>
            <p>This link will expire in 1 hour.</p>
        </div>
    `;
    
    return sendEmail(to, subject, html);
};

export const sendRewardReminderEmail = async (to: string, businessName: string, rewardTitle: string, message?: string) => {
    const subject = `Reward Reminder from ${businessName}`;
    
    const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h1>Hello!</h1>
            <p><strong>${businessName}</strong> wants to remind you about a reward:</p>
            <h2>${rewardTitle}</h2>
            ${message ? `<p><em>"${message}"</em></p>` : ''}
            <p>Visit us to claim your reward!</p>
        </div>
    `;
    
    return sendEmail(to, subject, html);
};