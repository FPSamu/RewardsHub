/**
 * Script de prueba para push notifications via Firebase Admin SDK.
 * Uso: node scripts/test-push.js <fcm-token> [engagement|rewards]
 *
 * Ejemplo:
 *   node scripts/test-push.js eM4I_edy0kvYkg4SNOZD9W:APA91b... engagement
 */

require('dotenv').config();
const admin = require('firebase-admin');

const fcmToken = process.argv[2];
const type = process.argv[3] || 'engagement';

if (!fcmToken) {
    console.error('❌ Uso: node scripts/test-push.js <fcm-token> [engagement|rewards]');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
});

const messages = {
    engagement: {
        title: '¡Hola desde RewardsHub! 👋',
        body: 'Este es un test del recordatorio diario. ¡Las notificaciones funcionan correctamente!',
    },
    rewards: {
        title: '🎉 Tienes recompensas disponibles',
        body: 'Test: tienes recompensas listas para canjear en tus negocios favoritos.',
    },
};

const { title, body } = messages[type] || messages.engagement;

admin.messaging().send({
    token: fcmToken,
    notification: { title, body },
    apns: { payload: { aps: { sound: 'default' } } },
    android: { priority: 'high' },
})
.then((response) => {
    console.log('✅ Notificación enviada correctamente');
    console.log('   Message ID:', response);
})
.catch((error) => {
    console.error('❌ Error al enviar:', error.message);
    if (error.code === 'messaging/registration-token-not-registered') {
        console.error('   El token FCM expiró o es inválido. Obtén uno nuevo corriendo la app.');
    }
})
.finally(() => process.exit());
