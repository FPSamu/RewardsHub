/**
 * Firebase falso para los tests de auth.
 *
 * El idToken es `fake:<uid>:<email>[:<name>]`; cualquier otra cosa se rechaza
 * como lo haría firebase-admin. Uso:
 *
 *   jest.mock('../src/services/firebase.service', () => require('./helpers/fakeFirebase').firebaseMock);
 */
export const fakeIdToken = (uid: string, email: string, name?: string): string =>
    ['fake', uid, email, ...(name ? [name] : [])].join(':');

export const firebaseMock = {
    verifyIdToken: jest.fn(async (idToken: string) => {
        const [prefix, uid, email, name] = String(idToken).split(':');
        if (prefix !== 'fake' || !uid || !email) throw new Error('invalid token');
        return { uid, email, name };
    }),
    verifyGoogleToken: jest.fn(),
    deleteUser: jest.fn(async () => undefined),
    checkEmailExists: jest.fn(async () => true),
    sendPushNotification: jest.fn(async () => undefined),
    sendMultiplePushNotifications: jest.fn(async () => ({ successCount: 0, failureCount: 0 })),
};
