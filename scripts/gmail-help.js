#!/usr/bin/env node

/**
 * Script de ayuda para configurar Gmail
 * Muestra instrucciones paso a paso en la terminal
 */

console.log('\n');
console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║                                                                ║');
console.log('║          📧 CONFIGURACIÓN DE GMAIL - REWARDSHUB 📧             ║');
console.log('║                                                                ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('\n');

console.log('🎯 PASO 1: Obtén tu App Password de Gmail\n');
console.log('   1. Abre este link en tu navegador:');
console.log('      👉 https://myaccount.google.com/apppasswords\n');
console.log('   2. Si no ves la opción, activa primero la verificación en dos pasos:');
console.log('      👉 https://myaccount.google.com/security\n');
console.log('   3. Genera una contraseña:');
console.log('      - App: "Correo"');
console.log('      - Dispositivo: "Otro" → escribe "RewardsHub"');
console.log('      - Click en "Generar"\n');
console.log('   4. Copia la contraseña de 16 caracteres (sin espacios)\n');

console.log('─────────────────────────────────────────────────────────────────\n');

console.log('📝 PASO 2: Agrega estas líneas a tu archivo .env\n');
console.log('   Abre: .env\n');
console.log('   Agrega estas líneas (reemplaza los valores):\n');
console.log('   ┌─────────────────────────────────────────────────────────┐');
console.log('   │ EMAIL_SERVICE=gmail                                     │');
console.log('   │ EMAIL_USER=tu-email@gmail.com                           │');
console.log('   │ EMAIL_PASSWORD=abcdefghijklmnop                         │');
console.log('   │ EMAIL_FROM=tu-email@gmail.com                           │');
console.log('   │ FRONTEND_URL=http://localhost:5173                      │');
console.log('   └─────────────────────────────────────────────────────────┘\n');

console.log('   ⚠️  IMPORTANTE:');
console.log('   - Reemplaza "tu-email@gmail.com" con tu email real');
console.log('   - Reemplaza "abcdefghijklmnop" con tu App Password');
console.log('   - El App Password debe ser de 16 caracteres SIN ESPACIOS\n');

console.log('─────────────────────────────────────────────────────────────────\n');

console.log('✅ PASO 3: Verifica la configuración\n');
console.log('   Ejecuta este comando:\n');
console.log('   $ npm run verify-email\n');
console.log('   Deberías ver: ✅ ¡Conexión exitosa!\n');

console.log('─────────────────────────────────────────────────────────────────\n');

console.log('🧪 PASO 4: Prueba enviando un email\n');
console.log('   1. Inicia el servidor:');
console.log('      $ npm run dev\n');
console.log('   2. Registra un usuario de prueba (Postman o frontend):');
console.log('      POST http://localhost:3000/auth/register');
console.log('      {');
console.log('        "username": "Test User",');
console.log('        "email": "tu-email@gmail.com",');
console.log('        "password": "password123"');
console.log('      }\n');
console.log('   3. Revisa tu bandeja de entrada ✉️\n');

console.log('─────────────────────────────────────────────────────────────────\n');

console.log('📚 DOCUMENTACIÓN:\n');
console.log('   - Guía completa de Gmail: GMAIL_SETUP.md');
console.log('   - Configuración general: NODEMAILER_SETUP.md');
console.log('   - Líneas para copiar: COPY_TO_ENV.txt\n');

console.log('❓ PROBLEMAS COMUNES:\n');
console.log('   • "Invalid login" → Usa App Password, NO tu contraseña normal');
console.log('   • "EAUTH" → Verifica EMAIL_USER y EMAIL_PASSWORD');
console.log('   • No recibo emails → Revisa la carpeta de Spam\n');

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  ¿Necesitas ayuda? Consulta GMAIL_SETUP.md                    ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('\n');
