import { Request, Response } from 'express';

/**
 * Version gate for the mobile apps.
 *
 * Two thresholds, both driven by environment variables so a release can be
 * gated without redeploying code:
 *
 *   - minVersion    below this the app blocks and demands an update
 *   - latestVersion below this the app shows a dismissible nudge
 *
 * Both default to 0.0.0, which disables the gate entirely. Blocking every till
 * in every store is a big hammer, so it only happens when someone deliberately
 * raises APP_MIN_VERSION_*.
 */

type Platform = 'ios' | 'android';

const readPlatform = (raw: unknown): Platform =>
    String(raw).toLowerCase() === 'android' ? 'android' : 'ios';

const config = (platform: Platform) => {
    const suffix = platform.toUpperCase();
    return {
        minVersion: process.env[`APP_MIN_VERSION_${suffix}`] || '0.0.0',
        latestVersion: process.env[`APP_LATEST_VERSION_${suffix}`] || '0.0.0',
        storeUrl: process.env[`APP_STORE_URL_${suffix}`] || null,
    };
};

export const getAppVersion = (req: Request, res: Response) => {
    const platform = readPlatform(req.query.platform);
    const { minVersion, latestVersion, storeUrl } = config(platform);

    return res.json({
        platform,
        minVersion,
        latestVersion,
        storeUrl,
        updateMessage: process.env.APP_UPDATE_MESSAGE || null,
    });
};
