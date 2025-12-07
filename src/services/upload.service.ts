/**
 * Upload service
 *
 * Handles file uploads to AWS S3.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'crypto';

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
});

const BUCKET_NAME = 'rewards-hub-app';

/**
 * Upload a file to S3
 * @param file - The file object from multer
 * @param folder - The folder path in the bucket (e.g., 'logos')
 * @returns The public URL of the uploaded file
 */
export const uploadFile = async (file: Express.Multer.File, folder: string = 'uploads'): Promise<string> => {
    // Generate a unique filename
    const fileExtension = file.originalname.split('.').pop();
    const randomName = crypto.randomBytes(16).toString('hex');
    const fileName = `${folder}/${randomName}.${fileExtension}`;

    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        // ACL: 'public-read', // Uncomment if you want the file to be publicly readable via S3 URL directly (requires bucket config)
    });

    await s3Client.send(command);

    // Construct the public URL
    // Note: This assumes the bucket is configured for public access or you are using CloudFront
    // If using standard S3 public access:
    return `https://${BUCKET_NAME}.s3.amazonaws.com/${fileName}`;
};
