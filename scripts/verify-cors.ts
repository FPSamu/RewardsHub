/**
 * Script to verify CORS configuration
 * Run this to check if your CORS settings are properly configured
 */

import dotenv from 'dotenv';

dotenv.config();

console.log('🔍 Verificando configuración de CORS...\n');

const nodeEnv = process.env.NODE_ENV;
const allowedOrigins = process.env.ALLOWED_ORIGINS;

console.log('📋 Variables de entorno:');
console.log(`   NODE_ENV: ${nodeEnv || '❌ NO CONFIGURADO'}`);
console.log(`   ALLOWED_ORIGINS: ${allowedOrigins || '❌ NO CONFIGURADO'}\n`);

// Validaciones
let hasErrors = false;

if (!nodeEnv) {
    console.log('⚠️  WARNING: NODE_ENV no está configurado');
    console.log('   Recomendación: Configura NODE_ENV=production en Render\n');
    hasErrors = true;
}

if (nodeEnv === 'production' && !allowedOrigins) {
    console.log('❌ ERROR: ALLOWED_ORIGINS no está configurado en producción');
    console.log('   Esto causará que todas las peticiones CORS sean rechazadas');
    console.log('   Acción requerida: Configura ALLOWED_ORIGINS en Render\n');
    hasErrors = true;
}

if (allowedOrigins) {
    const origins = allowedOrigins.split(',').map(o => o.trim());
    console.log('✅ Orígenes permitidos configurados:');
    origins.forEach((origin, index) => {
        console.log(`   ${index + 1}. ${origin}`);

        // Validaciones de formato
        if (origin.includes(' ')) {
            console.log(`      ⚠️  WARNING: El origen contiene espacios`);
            hasErrors = true;
        }
        if (origin.endsWith('/')) {
            console.log(`      ⚠️  WARNING: El origen termina con '/' (no recomendado)`);
        }
        if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
            console.log(`      ❌ ERROR: El origen debe empezar con http:// o https://`);
            hasErrors = true;
        }
    });
    console.log('');
}

// Verificar frontend de Vercel
const vercelDomain = 'https://rewards-hub-opal.vercel.app';
if (allowedOrigins && !allowedOrigins.includes(vercelDomain)) {
    console.log('⚠️  NOTA: El dominio de Vercel no está en ALLOWED_ORIGINS');
    console.log(`   Dominio esperado: ${vercelDomain}`);
    console.log('   Si este es tu frontend, agrégalo a ALLOWED_ORIGINS\n');
}

// Resumen
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (hasErrors) {
    console.log('❌ Se encontraron problemas en la configuración');
    console.log('   Revisa los mensajes arriba y corrige los errores');
    console.log('   Consulta CORS_SETUP.md para más información');
    process.exit(1);
} else if (nodeEnv === 'production' && allowedOrigins) {
    console.log('✅ Configuración de CORS correcta para producción');
    console.log('   Tu backend debería aceptar peticiones de los orígenes configurados');
} else {
    console.log('ℹ️  Modo desarrollo - Se permiten todos los orígenes');
    console.log('   Asegúrate de configurar ALLOWED_ORIGINS antes de desplegar');
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
