/**
 * Con las variables PUESTAS, Stripe, correo, S3 y Firebase se comportan como
 * siempre (los cambios para arrancar sin ellas no tocan ese camino).
 * Las librerías se reemplazan por dobles: nada sale a la red.
 */
const sendMail = jest.fn().mockResolvedValue({ messageId: 'm1' });
const createTransport = jest.fn(() => ({ sendMail, verify: jest.fn() }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport }, createTransport }));

const s3Send = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({ send: s3Send })),
    PutObjectCommand: jest.fn().mockImplementation((input: any) => ({ input })),
}));

const verifyIdToken = jest.fn().mockResolvedValue({ uid: 'u1', email: 'a@b.c', name: 'A' });
const initializeApp = jest.fn();
jest.mock('firebase-admin', () => ({
    __esModule: true,
    default: { initializeApp, credential: { cert: jest.fn((x: any) => x) }, auth: () => ({ verifyIdToken }) },
}));

const stripeCtor = jest.fn().mockImplementation(() => ({ customers: { create: jest.fn().mockResolvedValue({ id: 'cus_1' }) } }));
jest.mock('stripe', () => stripeCtor);

beforeAll(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.EMAIL_USER = 'lab@example.com';
    process.env.EMAIL_PASSWORD = 'app-password';
    process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    process.env.FIREBASE_PROJECT_ID = 'p';
    process.env.FIREBASE_PRIVATE_KEY = 'k';
    process.env.FIREBASE_CLIENT_EMAIL = 'c@p.iam';
});

afterAll(() => {
    for (const k of ['STRIPE_SECRET_KEY', 'EMAIL_USER', 'EMAIL_PASSWORD', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
        'FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL']) delete process.env[k];
});

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

it('Stripe: el cliente se crea una vez con la llave y la misma versión de API, y se usa', async () => {
    const stripe = require('../src/services/stripe.service');
    expect(stripeCtor).not.toHaveBeenCalled(); // ya no al importar
    await expect(stripe.createCustomer('b1', 'a@b.c', 'A')).resolves.toBe('cus_1');
    await stripe.createCustomer('b2', 'a@b.c', 'A');
    expect(stripeCtor).toHaveBeenCalledTimes(1);
    expect(stripeCtor).toHaveBeenCalledWith('sk_test_x', { apiVersion: '2026-02-25.clover' });
});

it('Correo: con EMAIL_USER/EMAIL_PASSWORD manda por nodemailer como antes', async () => {
    const email = require('../src/services/email.service');
    expect(email.isEmailConfigured()).toBe(true);
    await expect(email.sendEmail('x@y.z', 'Hola', '<b>hola</b>')).resolves.toEqual({ success: true, messageId: 'm1' });
    expect(createTransport).toHaveBeenCalledWith({ service: 'gmail', auth: { user: 'lab@example.com', pass: 'app-password' } });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'x@y.z', subject: 'Hola' }));
});

it('S3: con llaves sube el archivo como antes', async () => {
    const upload = require('../src/services/upload.service');
    const url = await upload.uploadFile({ originalname: 'logo.png', buffer: Buffer.from('x'), mimetype: 'image/png' } as any, 'logos');
    expect(url).toMatch(/^https:\/\/rewards-hub-app\.s3\..*\/logos\/[0-9a-f]+\.png$/);
    expect(s3Send).toHaveBeenCalledTimes(1);
});

it('Firebase: con credenciales inicializa una vez y verifica el token como antes', async () => {
    const firebase = require('../src/services/firebase.service');
    await expect(firebase.verifyIdToken('tok')).resolves.toEqual({ uid: 'u1', email: 'a@b.c', name: 'A' });
    await firebase.verifyIdToken('tok');
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(initializeApp.mock.calls[0][0].credential).toEqual({ projectId: 'p', privateKey: 'k', clientEmail: 'c@p.iam' });
});
