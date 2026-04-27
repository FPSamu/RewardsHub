import { Request, Response } from 'express';
import * as businessService from '../services/business.service';
import * as authService from '../services/auth.service';
import * as uploadService from '../services/upload.service';
import * as emailService from '../services/email.service';
import { BusinessModel } from '../models/business.model';

export const verifyEmail = async (req: Request, res: Response) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const business = await businessService.verifyBusinessEmail(token as string);
    if (!business) return res.status(400).json({ message: 'Invalid or expired token' });

    return res.json({ message: 'Email verified successfully', user: business });
};

export const forgotPassword = async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    console.log('🔵 [BUSINESS FORGOT PASSWORD] Request received for:', email);

    const token = await authService.generatePasswordResetToken(BusinessModel, email);

    console.log('🟡 [BUSINESS FORGOT PASSWORD] Token generation result:', {
        email, hasToken: !!token, tokenLength: token ? token.length : 0
    });

    if (token) {
        try {
            console.log('🔵 [BUSINESS FORGOT PASSWORD] Attempting to send email...');
            await emailService.sendPasswordResetEmail(email, token, true);
            console.log('✅ [BUSINESS FORGOT PASSWORD] Email sent successfully');
        } catch (error) {
            console.error('❌ [BUSINESS FORGOT PASSWORD] Failed to send reset email:', error);
            return res.status(500).json({ message: 'Failed to send email' });
        }
    } else {
        console.log('⚠️  [BUSINESS FORGOT PASSWORD] No token generated (business not found)');
    }

    return res.json({ message: 'If an account exists, a reset email has been sent' });
};

export const resetPassword = async (req: Request, res: Response) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password required' });

    const ok = await authService.resetPassword(BusinessModel, token, password);
    if (!ok) return res.status(400).json({ message: 'Invalid or expired token' });

    return res.json({ message: 'Password reset successfully' });
};

export const sendRewardReminder = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'Not authenticated' });

    const { userEmail, rewardTitle, message } = req.body;
    if (!userEmail || !rewardTitle) return res.status(400).json({ message: 'User email and reward title required' });

    try {
        await emailService.sendRewardReminderEmail(userEmail, biz.username, rewardTitle, message);
        return res.json({ message: 'Reminder sent successfully' });
    } catch (error) {
        console.error('Failed to send reminder:', error);
        return res.status(500).json({ message: 'Failed to send reminder' });
    }
};

export const me = (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });
    return res.json({
        id: biz.id,
        username: biz.username,
        email: biz.email,
        status: biz.status,
        address: biz.address,
        locations: biz.locations,
        createdAt: biz.createdAt,
        logoUrl: biz.logoUrl,
        category: biz.category,
        timezone: biz.timezone || 'UTC',
        isVerified: biz.isVerified
    });
};

export const updateBusiness = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const { username, email } = req.body;
    try {
        const updated = await businessService.updateBusiness(biz.id, { username, email });
        return res.json(updated);
    } catch (error: any) {
        if (error.code === 11000) return res.status(409).json({ message: 'email already in use' });
        return res.status(500).json({ message: 'failed to update business' });
    }
};

export const uploadLogo = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });
    if (!req.file) return res.status(400).json({ message: 'no file uploaded' });

    try {
        const logoUrl = await uploadService.uploadFile(req.file, 'logos');
        const updated = await businessService.updateBusinessLogo(biz.id, logoUrl);
        return res.json({ message: 'Logo uploaded successfully', logoUrl, business: updated });
    } catch (error: any) {
        console.error('Upload error:', error);
        return res.status(500).json({ message: 'failed to upload logo' });
    }
};

export const getBusinessById = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'business id is required' });

    try {
        const business = await businessService.findBusinessById(id);
        if (!business) return res.status(404).json({ message: 'business not found' });
        return res.json({
            id: business.id, username: business.username, email: business.email,
            status: business.status, address: business.address,
            locations: business.locations, createdAt: business.createdAt, logoUrl: business.logoUrl
        });
    } catch {
        return res.status(500).json({ message: 'failed to get business information' });
    }
};

export const updateLocation = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const { locationId } = req.params;
    const { address, name, isMain, latitude, longitude } = req.body;

    try {
        const updated = await businessService.updateBranch(biz.id, locationId, { address, name, isMain, latitude, longitude });
        return res.json(updated);
    } catch (error: any) {
        return res.status(500).json({ message: error.message || 'failed to update location' });
    }
};

export const getNearbyBusinesses = async (req: Request, res: Response) => {
    const { latitude, longitude, maxDistanceKm } = req.query;
    if (!latitude || !longitude) return res.status(400).json({ message: 'latitude and longitude are required' });

    const lat = parseFloat(latitude as string);
    const lng = parseFloat(longitude as string);
    const maxDist = maxDistanceKm ? parseFloat(maxDistanceKm as string) : 10;

    if (isNaN(lat) || isNaN(lng) || isNaN(maxDist)) {
        return res.status(400).json({ message: 'invalid coordinates or distance' });
    }

    try {
        const businesses = await businessService.findNearbyBusinesses(lat, lng, maxDist);
        return res.json({ center: { latitude: lat, longitude: lng }, maxDistanceKm: maxDist, count: businesses.length, businesses });
    } catch {
        return res.status(500).json({ message: 'failed to find nearby businesses' });
    }
};

export const deleteAccount = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    try {
        await businessService.deleteBusiness(biz.id);
        return res.json({ message: 'Account deleted successfully' });
    } catch (error: any) {
        console.error('Delete account error:', error);
        return res.status(500).json({ message: error.message || 'Failed to delete account' });
    }
};

export const getBusinessesInBounds = async (req: Request, res: Response) => {
    const { minLat, maxLat, minLng, maxLng } = req.query;
    if (!minLat || !maxLat || !minLng || !maxLng) {
        return res.status(400).json({ message: 'minLat, maxLat, minLng, and maxLng are required' });
    }

    const bounds = {
        minLat: parseFloat(minLat as string),
        maxLat: parseFloat(maxLat as string),
        minLng: parseFloat(minLng as string),
        maxLng: parseFloat(maxLng as string),
    };

    if (Object.values(bounds).some(isNaN)) {
        return res.status(400).json({ message: 'invalid bounds coordinates' });
    }

    try {
        const businesses = await businessService.findBusinessesInBounds(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng);
        return res.json({ bounds, count: businesses.length, businesses });
    } catch {
        console.error('Get businesses in bounds error');
        return res.status(500).json({ message: 'failed to get businesses' });
    }
};

export const getAllBusinesses = async (req: Request, res: Response) => {
    const { latitude, longitude, limit } = req.query;

    let lat: number | undefined;
    let lng: number | undefined;
    let maxLimit = 100;

    if (latitude && longitude) {
        lat = parseFloat(latitude as string);
        lng = parseFloat(longitude as string);
        if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ message: 'invalid coordinates' });
    }

    if (limit) {
        maxLimit = parseInt(limit as string, 10);
        if (isNaN(maxLimit) || maxLimit < 1) maxLimit = 100;
    }

    try {
        const businesses = await businessService.getAllBusinesses(lat, lng, maxLimit);
        return res.json({
            userLocation: lat && lng ? { latitude: lat, longitude: lng } : null,
            count: businesses.length,
            businesses
        });
    } catch {
        console.error('Get all businesses error');
        return res.status(500).json({ message: 'failed to get businesses' });
    }
};

export const getCategories = (_req: Request, res: Response) => {
    return res.json(['food', 'retail', 'services', 'entertainment', 'other']);
};

export const getBusinessesByCategory = async (req: Request, res: Response) => {
    const { category } = req.params;
    if (!category) return res.status(400).json({ message: 'category is required' });

    try {
        const businesses = await businessService.getAllBusinesses(undefined, undefined, 100);
        return res.json({ count: businesses.length, businesses });
    } catch {
        return res.status(500).json({ message: 'failed to get businesses' });
    }
};

export const addLocation = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const { address, name, latitude, longitude } = req.body;
    if (!address) return res.status(400).json({ message: 'address is required' });

    try {
        const updated = await businessService.addBranch(biz.id, address, name, latitude, longitude);
        return res.json(updated);
    } catch (error: any) {
        return res.status(500).json({ message: error.message || 'failed to add location' });
    }
};

export const removeLocation = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const { locationId } = req.params;
    try {
        const updated = await businessService.removeBranch(biz.id, locationId);
        return res.json(updated);
    } catch {
        return res.status(500).json({ message: 'failed to remove location' });
    }
};
