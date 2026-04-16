/**
 * Pass controllers — Apple Wallet (.pkpass) and Google Wallet
 */

import { Request, Response } from 'express';
import * as passService from '../services/pass.service';

/**
 * GET /passes/apple
 * Returns a signed .pkpass file for the authenticated user.
 * On iOS Safari, the browser automatically shows the "Add to Wallet" dialog.
 */
export async function applePass(req: Request, res: Response) {
    try {
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ message: 'Authentication required' });

        const buffer = await passService.generateApplePassBuffer(userId);

        res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="rewardshub.pkpass"`
        );
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);
    } catch (err: any) {
        const status = (err as any).status || 500;
        return res
            .status(status)
            .json({ message: err.message || 'Failed to generate Apple Wallet pass' });
    }
}

/**
 * GET /passes/google
 * Returns a JSON object { url } with the Google Wallet save URL.
 * The frontend should redirect the user to that URL.
 */
export async function googlePass(req: Request, res: Response) {
    try {
        const userId = (req as any).user?.id;
        if (!userId) return res.status(401).json({ message: 'Authentication required' });

        const data = await passService.getUserPassData(userId);
        const token = passService.generateGooglePassJwt(data);
        const url = `https://pay.google.com/gp/v/save/${token}`;

        return res.json({ url });
    } catch (err: any) {
        const status = (err as any).status || 500;
        return res
            .status(status)
            .json({ message: err.message || 'Failed to generate Google Wallet pass' });
    }
}
