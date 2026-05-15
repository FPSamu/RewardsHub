import admin from 'firebase-admin';

let initialized = false;

const getAdmin = () => {
    if (initialized) return admin;

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
    });

    initialized = true;
    return admin;
};

export interface FirebaseTokenPayload {
    uid: string;
    email: string;
    name: string;
}

/** Verifica cualquier ID token de Firebase (email/password o Google). */
export const verifyIdToken = async (idToken: string): Promise<FirebaseTokenPayload> => {
    try {
        const decoded = await getAdmin().auth().verifyIdToken(idToken);
        if (!decoded.email) throw new Error('Token has no email');
        return {
            uid: decoded.uid,
            email: decoded.email,
            name: decoded.name || decoded.email.split('@')[0],
        };
    } catch (err: any) {
        console.error('[Firebase] verifyIdToken failed:', err?.errorInfo?.code || err?.message);
        throw err;
    }
};

/** Elimina una cuenta de Firebase por uid. Usado para revertir si el registro en MongoDB falla. */
export const deleteUser = async (uid: string): Promise<void> => {
    try {
        await getAdmin().auth().deleteUser(uid);
    } catch (err: any) {
        console.error('[Firebase] deleteUser failed for uid', uid, ':', err?.message);
    }
};

/** Comprueba si un email ya tiene cuenta en Firebase. */
export const checkEmailExists = async (email: string): Promise<boolean> => {
    try {
        await getAdmin().auth().getUserByEmail(email);
        return true;
    } catch {
        return false;
    }
};

// Alias para compatibilidad con código existente
export const verifyGoogleToken = verifyIdToken;

export const sendPushNotification = async (
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
): Promise<void> => {
    await getAdmin().messaging().send({
        token: fcmToken,
        notification: { title, body },
        data,
        apns: { payload: { aps: { sound: 'default' } } },
        android: { priority: 'high' },
    });
};

export const sendMultiplePushNotifications = async (
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
): Promise<{ successCount: number; failureCount: number }> => {
    if (tokens.length === 0) return { successCount: 0, failureCount: 0 };
    const response = await getAdmin().messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
        data,
        apns: { payload: { aps: { sound: 'default' } } },
        android: { priority: 'high' },
    });
    return { successCount: response.successCount, failureCount: response.failureCount };
};
