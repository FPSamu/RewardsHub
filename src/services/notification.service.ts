/**
 * Notification service
 *
 * Evaluates each user's accumulated points/stamps against available business rewards
 * and sends a consolidated email when:
 *   - The user can already redeem one or more rewards (available), OR
 *   - The user is within ~1 purchase of reaching a reward (close)
 *
 * A cooldown (NotificationLog TTL) prevents the same user from being emailed
 * more than once every NOTIFICATION_COOLDOWN_DAYS days.
 */
import { Types } from 'mongoose';
import { UserModel } from '../models/user.model';
import { UserPointsModel, IBusinessPoints } from '../models/userPoints.model';
import { RewardModel, IReward } from '../models/reward.model';
import { BusinessModel } from '../models/business.model';
import { NotificationLogModel } from '../models/notificationLog.model';
import { sendEmail } from './email.service';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RewardEntry {
    rewardName: string;
    businessName: string;
    type: 'available' | 'close';
    /** Only set for 'close' entries */
    gapLabel?: string;
}

interface BusinessRewardSummary {
    businessName: string;
    available: RewardEntry[];
    close: RewardEntry[];
}

// ─── Core eligibility logic ───────────────────────────────────────────────────

/**
 * Determines which rewards a user is eligible for or close to at a given business.
 * Mirrors the same heuristic used in the frontend ClientHome component.
 */
const evaluateRewards = (
    bp: IBusinessPoints,
    rewards: IReward[],
    businessName: string
): { available: RewardEntry[]; close: RewardEntry[] } => {
    const available: RewardEntry[] = [];
    const close: RewardEntry[] = [];

    const avgPointsPerVisit = bp.stamps > 0 ? bp.points / bp.stamps : null;

    for (const reward of rewards) {
        if (!reward.isActive) continue;

        const isPoints = !!reward.pointsRequired;
        const required = isPoints ? reward.pointsRequired! : reward.stampsRequired!;
        const current = isPoints ? bp.points : bp.stamps;

        if (!required || required <= 0) continue;

        if (current >= required) {
            available.push({ rewardName: reward.name, businessName, type: 'available' });
        } else {
            const gap = required - current;
            let isClose = false;

            if (!isPoints) {
                isClose = gap <= 1;
            } else if (avgPointsPerVisit && avgPointsPerVisit > 0) {
                isClose = gap <= avgPointsPerVisit;
            } else {
                isClose = current >= required * 0.75;
            }

            if (isClose) {
                const gapLabel = isPoints
                    ? `~${Math.ceil(gap)} puntos más`
                    : gap === 1
                        ? '1 sello más'
                        : `${gap} sellos más`;

                close.push({ rewardName: reward.name, businessName, type: 'close', gapLabel });
            }
        }
    }

    return { available, close };
};

// ─── Email template ───────────────────────────────────────────────────────────

const buildNotificationEmail = (
    username: string,
    summaries: BusinessRewardSummary[]
): string => {
    const brandOrange = '#FFB733';
    const brandGreen = '#74D680';
    const brandDark = '#8B5A00';

    const availableSection = summaries
        .filter(s => s.available.length > 0)
        .map(s => `
            <div style="background:#f0fdf4;border-left:4px solid ${brandGreen};padding:14px 18px;border-radius:8px;margin-bottom:12px;">
                <p style="margin:0 0 6px;font-weight:700;color:#166534;">${s.businessName}</p>
                ${s.available.map(r =>
                    `<p style="margin:2px 0;color:#15803d;font-size:14px;">🎁 ${r.rewardName}</p>`
                ).join('')}
            </div>`)
        .join('');

    const closeSection = summaries
        .filter(s => s.close.length > 0)
        .map(s => `
            <div style="background:#fffbeb;border-left:4px solid ${brandOrange};padding:14px 18px;border-radius:8px;margin-bottom:12px;">
                <p style="margin:0 0 6px;font-weight:700;color:${brandDark};">${s.businessName}</p>
                ${s.close.map(r =>
                    `<p style="margin:2px 0;color:#92400e;font-size:14px;">⚡ ${r.rewardName} — <em>te falta ${r.gapLabel}</em></p>`
                ).join('')}
            </div>`)
        .join('');

    const hasAvailable = summaries.some(s => s.available.length > 0);
    const hasClose = summaries.some(s => s.close.length > 0);

    return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">

        <div style="text-align:center;margin-bottom:28px;">
            <img src="https://rewards-hub-app.s3.us-east-2.amazonaws.com/app/logoRewardsHub.png"
                 alt="RewardsHub" style="height:48px;object-fit:contain;" />
        </div>

        <h1 style="color:#212529;font-size:22px;margin-bottom:6px;">¡Hola, ${username}! 👋</h1>
        <p style="color:#495057;font-size:15px;margin-bottom:24px;">
            Tienes novedades en tus programas de recompensas. Aquí está tu resumen:
        </p>

        ${hasAvailable ? `
        <h2 style="color:#166534;font-size:17px;margin-bottom:12px;">🎉 Recompensas listas para canjear</h2>
        ${availableSection}
        <p style="font-size:13px;color:#6c757d;margin-bottom:24px;">
            Visita el negocio y muestra tu código QR para canjearlas.
        </p>` : ''}

        ${hasClose ? `
        <h2 style="color:${brandDark};font-size:17px;margin-bottom:12px;">⚡ Estás cerca de conseguir una recompensa</h2>
        ${closeSection}
        <p style="font-size:13px;color:#6c757d;margin-bottom:24px;">
            Con tu próxima compra podrías alcanzarlas. ¡No pares ahora!
        </p>` : ''}

        <div style="text-align:center;margin:28px 0;">
            <a href="${process.env.FRONTEND_URL}/client/dashboard"
               style="background-color:${brandOrange};color:white;padding:13px 32px;
                      text-decoration:none;border-radius:8px;font-weight:700;
                      display:inline-block;font-size:15px;">
                Ver mis recompensas
            </a>
        </div>

        <hr style="border:none;border-top:1px solid #e9ecef;margin:24px 0;" />
        <p style="font-size:12px;color:#adb5bd;text-align:center;">
            RewardsHub · Tu plataforma de lealtad<br/>
            Si no deseas recibir estos correos, ajusta tus preferencias en la app.
        </p>
    </div>`;
};

// ─── Per-user check ───────────────────────────────────────────────────────────

/**
 * Evaluates a single user and sends a notification email if warranted.
 * Returns true if an email was sent.
 */
export const checkAndNotifyUser = async (userId: string): Promise<boolean> => {
    const userObjectId = new Types.ObjectId(userId);

    // Skip if notified recently (TTL handles cleanup, just check existence)
    const recentLog = await NotificationLogModel.findOne({ userId: userObjectId });
    if (recentLog) return false;

    const [user, userPoints] = await Promise.all([
        UserModel.findById(userObjectId),
        UserPointsModel.findOne({ userId: userObjectId }),
    ]);

    if (!user || !user.isVerified || !userPoints?.businessPoints?.length) return false;

    // Fetch all business names and rewards in parallel
    const businessIds = userPoints.businessPoints.map(bp => bp.businessId);

    const [businesses, allRewards] = await Promise.all([
        BusinessModel.find({ _id: { $in: businessIds } }).select('_id name'),
        RewardModel.find({ businessId: { $in: businessIds }, isActive: true }),
    ]);

    const businessNameMap = new Map(
        businesses.map(b => [b._id.toString(), b.name])
    );
    const rewardsByBusiness = new Map<string, IReward[]>();
    for (const reward of allRewards) {
        const key = reward.businessId.toString();
        if (!rewardsByBusiness.has(key)) rewardsByBusiness.set(key, []);
        rewardsByBusiness.get(key)!.push(reward);
    }

    const summaries: BusinessRewardSummary[] = [];

    for (const bp of userPoints.businessPoints) {
        const bizId = bp.businessId.toString();
        const bizName = businessNameMap.get(bizId) ?? 'Negocio';
        const rewards = rewardsByBusiness.get(bizId) ?? [];
        if (!rewards.length) continue;

        const { available, close } = evaluateRewards(bp, rewards, bizName);
        if (available.length || close.length) {
            summaries.push({ businessName: bizName, available, close });
        }
    }

    if (!summaries.length) return false;

    const totalAvailable = summaries.reduce((n, s) => n + s.available.length, 0);
    const totalClose = summaries.reduce((n, s) => n + s.close.length, 0);

    const subject = totalAvailable > 0
        ? `🎉 Tienes ${totalAvailable} recompensa${totalAvailable > 1 ? 's' : ''} lista${totalAvailable > 1 ? 's' : ''} para canjear`
        : `⚡ ¡Estás cerca de conseguir una recompensa!`;

    await sendEmail(user.email, subject, buildNotificationEmail(user.username, summaries));

    await NotificationLogModel.create({
        userId: userObjectId,
        rewardsAvailable: totalAvailable,
        rewardsClose: totalClose,
    });

    return true;
};

// ─── Batch runner ─────────────────────────────────────────────────────────────

/**
 * Processes all users in the database.
 * Called by the scheduler and optionally by the manual-trigger endpoint.
 */
export const runNotificationBatch = async (): Promise<{ processed: number; sent: number }> => {
    console.log('📬 [Notifications] Starting notification batch...');

    const allUserPoints = await UserPointsModel.find({}, { userId: 1 }).lean();
    let sent = 0;

    // Process in chunks of 20 to avoid memory pressure
    const chunkSize = 20;
    for (let i = 0; i < allUserPoints.length; i += chunkSize) {
        const chunk = allUserPoints.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
            chunk.map(up => checkAndNotifyUser(up.userId.toString()))
        );
        sent += results.filter(r => r.status === 'fulfilled' && r.value === true).length;
    }

    console.log(`📬 [Notifications] Batch complete. Processed: ${allUserPoints.length}, Sent: ${sent}`);
    return { processed: allUserPoints.length, sent };
};

// ─── Per-business trigger ─────────────────────────────────────────────────────

/**
 * Sends notifications only to users who have points at a specific business.
 * Used by the business-facing manual trigger endpoint.
 */
export const notifyBusinessUsers = async (
    businessId: string
): Promise<{ processed: number; sent: number }> => {
    console.log(`📬 [Notifications] Running per-business trigger for: ${businessId}`);

    const usersWithPoints = await UserPointsModel.find(
        { 'businessPoints.businessId': new Types.ObjectId(businessId) },
        { userId: 1 }
    ).lean();

    let sent = 0;
    const results = await Promise.allSettled(
        usersWithPoints.map(up => checkAndNotifyUser(up.userId.toString()))
    );
    sent = results.filter(r => r.status === 'fulfilled' && r.value === true).length;

    console.log(`📬 [Notifications] Business trigger done. Processed: ${usersWithPoints.length}, Sent: ${sent}`);
    return { processed: usersWithPoints.length, sent };
};
