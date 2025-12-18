/**
 * Script de verificación de configuración de email
 * 
 * Este script verifica que las variables de entorno de email estén configuradas correctamente
 * y prueba la conexión con el servidor de email.
 * 
 * Uso: npm run verify-email
 */

import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const verifyEmailConfiguration = async () => {
    console.log('\n🔍 Verificando configuración de email...\n');

    // Verificar variables de entorno requeridas
    const requiredVars = ['EMAIL_SERVICE', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_FROM'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        console.error('❌ Variables de entorno faltantes:');
        missingVars.forEach(varName => console.error(`   - ${varName}`));
        console.error('\n💡 Revisa tu archivo .env y asegúrate de configurar todas las variables requeridas.');
        console.error('   Consulta .env.example o NODEMAILER_SETUP.md para más información.\n');
        process.exit(1);
    }

    console.log('✅ Variables de entorno configuradas correctamente\n');

    // Mostrar configuración (sin mostrar la contraseña completa)
    const emailService = process.env.EMAIL_SERVICE;
    const emailUser = process.env.EMAIL_USER;
    const emailFrom = process.env.EMAIL_FROM;
    const emailPassword = process.env.EMAIL_PASSWORD || '';
    const maskedPassword = emailPassword.substring(0, 4) + '****' + emailPassword.substring(emailPassword.length - 4);

    console.log('📧 Configuración actual:');
    console.log(`   Servicio: ${emailService}`);
    console.log(`   Usuario: ${emailUser}`);
    console.log(`   Remitente: ${emailFrom}`);
    console.log(`   Contraseña: ${maskedPassword}\n`);

    // Verificar configuración SMTP si es necesario
    if (emailService === 'smtp') {
        const smtpVars = ['SMTP_HOST', 'SMTP_PORT'];
        const missingSmtpVars = smtpVars.filter(varName => !process.env[varName]);

        if (missingSmtpVars.length > 0) {
            console.error('❌ Variables SMTP faltantes:');
            missingSmtpVars.forEach(varName => console.error(`   - ${varName}`));
            console.error('\n💡 Para usar EMAIL_SERVICE=smtp, debes configurar SMTP_HOST y SMTP_PORT.\n');
            process.exit(1);
        }

        console.log('📡 Configuración SMTP:');
        console.log(`   Host: ${process.env.SMTP_HOST}`);
        console.log(`   Puerto: ${process.env.SMTP_PORT}`);
        console.log(`   Seguro: ${process.env.SMTP_SECURE || 'false'}\n`);
    }

    // Crear transporter
    let transporter;
    try {
        if (emailService !== 'smtp') {
            transporter = nodemailer.createTransport({
                service: emailService,
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD,
                },
            });
        } else {
            transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASSWORD,
                },
            });
        }

        console.log('🔄 Verificando conexión con el servidor de email...\n');

        // Verificar conexión
        await transporter.verify();

        console.log('✅ ¡Conexión exitosa!\n');
        console.log('🎉 Tu configuración de email está lista para usar.\n');
        console.log('💡 Puedes probar enviando un email de prueba con:');
        console.log('   POST http://localhost:3000/auth/register\n');

        process.exit(0);
    } catch (error: any) {
        console.error('❌ Error al conectar con el servidor de email:\n');
        console.error(`   ${error.message}\n`);

        // Mensajes de ayuda específicos según el error
        if (error.code === 'EAUTH') {
            console.error('💡 Error de autenticación. Posibles soluciones:');
            console.error('   1. Verifica que EMAIL_USER y EMAIL_PASSWORD sean correctos');
            console.error('   2. Para Gmail: Usa un "App Password" en lugar de tu contraseña normal');
            console.error('      - Ve a https://myaccount.google.com/apppasswords');
            console.error('      - Genera una contraseña de aplicación');
            console.error('      - Usa esa contraseña de 16 caracteres en EMAIL_PASSWORD');
            console.error('   3. Para Outlook: Verifica que no tengas restricciones de seguridad\n');
        } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
            console.error('💡 Error de conexión. Posibles soluciones:');
            console.error('   1. Verifica tu conexión a internet');
            console.error('   2. Verifica que SMTP_HOST y SMTP_PORT sean correctos');
            console.error('   3. Verifica que tu firewall no bloquee el puerto');
            console.error('   4. Intenta cambiar SMTP_SECURE a true o false\n');
        } else if (error.code === 'ESOCKET') {
            console.error('💡 Error de socket. Posibles soluciones:');
            console.error('   1. Verifica que el servicio EMAIL_SERVICE sea válido');
            console.error('      Servicios soportados: gmail, outlook, smtp');
            console.error('   2. Si usas smtp, verifica SMTP_HOST y SMTP_PORT\n');
        } else {
            console.error('💡 Consulta la guía de solución de problemas en:');
            console.error('   NODEMAILER_SETUP.md\n');
        }

        process.exit(1);
    }
};

// Ejecutar verificación
verifyEmailConfiguration().catch(error => {
    console.error('❌ Error inesperado:', error);
    process.exit(1);
});
