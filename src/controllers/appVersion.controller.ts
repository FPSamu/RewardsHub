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
 * raises the minimum.
 *
 * Config is scoped by app AND platform, because the business and client apps
 * share this backend and ship on their own schedules — a business release must
 * never mark the client app as out of date.
 */

type Platform = 'ios' | 'android';
type App = 'business' | 'client';

const readPlatform = (raw: unknown): Platform =>
    String(raw).toLowerCase() === 'android' ? 'android' : 'ios';

/**
 * Defaults to `business`: the build already in App Review predates this
 * parameter and sends no `app`, so it must keep resolving to its own config.
 */
const readApp = (raw: unknown): App =>
    String(raw).toLowerCase() === 'client' ? 'client' : 'business';

const config = (app: App, platform: Platform) => {
    const suffix = `${app.toUpperCase()}_${platform.toUpperCase()}`;
    const legacySuffix = platform.toUpperCase();

    // Scoped names win. The business app also falls back to the original
    // unscoped names so values already set in the dashboard keep working; the
    // client app deliberately does not, so it can never inherit them.
    const read = (key: string): string | undefined =>
        process.env[`APP_${key}_${suffix}`] ||
        (app === 'business' ? process.env[`APP_${key}_${legacySuffix}`] : undefined);

    return {
        minVersion: read('MIN_VERSION') || '0.0.0',
        latestVersion: read('LATEST_VERSION') || '0.0.0',
        storeUrl: read('STORE_URL') || null,
        updateMessage:
            process.env[`APP_UPDATE_MESSAGE_${app.toUpperCase()}`] ||
            (app === 'business' ? process.env.APP_UPDATE_MESSAGE : undefined) ||
            null,
    };
};

export const getAppVersion = (req: Request, res: Response) => {
    const app = readApp(req.query.app);
    const platform = readPlatform(req.query.platform);

    return res.json({ app, platform, ...config(app, platform) });
};
