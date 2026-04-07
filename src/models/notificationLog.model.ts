/**
 * NotificationLog model
 *
 * Tracks when a notification was last sent to each user to prevent spam.
 * Documents expire automatically after NOTIFICATION_COOLDOWN_DAYS days (default: 3).
 */
import { Schema, model, Document, Types } from 'mongoose';

export interface INotificationLog extends Document {
    userId: Types.ObjectId;
    sentAt: Date;
    rewardsAvailable: number;
    rewardsClose: number;
}

const notificationLogSchema = new Schema<INotificationLog>({
    userId: { type: Schema.Types.ObjectId, required: true, ref: 'User', index: true },
    sentAt: { type: Date, default: Date.now },
    rewardsAvailable: { type: Number, default: 0 },
    rewardsClose: { type: Number, default: 0 },
});

const cooldownDays = parseInt(process.env.NOTIFICATION_COOLDOWN_DAYS || '3', 10);
notificationLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: cooldownDays * 24 * 60 * 60 });
notificationLogSchema.index({ userId: 1, sentAt: -1 });

export const NotificationLogModel = model<INotificationLog>('NotificationLog', notificationLogSchema);
