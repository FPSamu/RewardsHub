import { Request, Response } from 'express';
import * as businessService from '../services/business.service';
import * as uploadService from '../services/upload.service';
import * as emailService from '../services/email.service';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;
const ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || '7d';

export const register = async (req: Request, res: Response) => {
    const { name, email, password, category } = req.body as { name: string; email: string; password: string; category?: string };
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'name, email and password are required' });
    }

    const existing = await businessService.findBusinessByEmail(email);
    if (existing) return res.status(409).json({ message: 'email already used' });

    const biz = await businessService.createBusiness(name, email, password, category);
    
    // Send verification email
    if (biz.verificationToken) {
        try {
            await emailService.sendVerificationEmail(biz.email, biz.verificationToken);
        } catch (error) {
            console.error('Failed to send verification email:', error);
        }
    }

    const accessToken = (jwt as any).sign({ sub: biz.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: biz.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    await businessService.addRefreshToken(biz.id, refreshToken);
    return res.status(201).json({ business: { id: biz.id, name: biz.name, email: biz.email, createdAt: biz.createdAt }, token: accessToken, refreshToken });
};

export const verifyEmail = async (req: Request, res: Response) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const biz = await businessService.verifyBusinessEmail(token as string);
    if (!biz) return res.status(400).json({ message: 'Invalid or expired token' });

    return res.json({ message: 'Email verified successfully' });
};

export const forgotPassword = async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const token = await businessService.generatePasswordResetToken(email);
    if (token) {
        try {
            await emailService.sendPasswordResetEmail(email, token);
        } catch (error) {
            console.error('Failed to send reset email:', error);
            return res.status(500).json({ message: 'Failed to send email' });
        }
    }
    // Always return success to prevent email enumeration
    return res.json({ message: 'If an account exists, a reset email has been sent' });
};

export const resetPassword = async (req: Request, res: Response) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password required' });

    const biz = await businessService.resetPassword(token, password);
    if (!biz) return res.status(400).json({ message: 'Invalid or expired token' });

    return res.json({ message: 'Password reset successfully' });
};

export const sendRewardReminder = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'Not authenticated' });

    const { userEmail, rewardTitle, message } = req.body;
    if (!userEmail || !rewardTitle) return res.status(400).json({ message: 'User email and reward title required' });

    try {
        await emailService.sendRewardReminderEmail(userEmail, biz.name, rewardTitle, message);
        return res.json({ message: 'Reminder sent successfully' });
    } catch (error) {
        console.error('Failed to send reminder:', error);
        return res.status(500).json({ message: 'Failed to send reminder' });
    }
};

export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ message: 'email and password required' });

    const biz = await businessService.findBusinessByEmail(email);
    if (!biz) return res.status(401).json({ message: 'invalid credentials' });

    const ok = await businessService.verifyPassword(password, biz.passHash);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });

    const accessToken = (jwt as any).sign({ sub: biz.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: biz.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    await businessService.addRefreshToken(biz.id, refreshToken);
    return res.json({ token: accessToken, refreshToken });
};

export const refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET) as any;
        const bizId = payload.sub as string;
        const ok = await businessService.hasRefreshToken(bizId, refreshToken);
        if (!ok) return res.status(401).json({ message: 'invalid refresh token' });

        await businessService.removeRefreshToken(bizId, refreshToken);
        const newAccess = (jwt as any).sign({ sub: bizId }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
        const newRefresh = (jwt as any).sign({ sub: bizId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
        await businessService.addRefreshToken(bizId, newRefresh);
        return res.json({ token: newAccess, refreshToken: newRefresh });
    } catch (err) {
        return res.status(401).json({ message: 'invalid refresh token' });
    }
};

export const logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET) as any;
        const bizId = payload.sub as string;
        await businessService.removeRefreshToken(bizId, refreshToken);
        return res.json({ ok: true });
    } catch (err) {
        return res.json({ ok: true });
    }
};

export const me = (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });
    return res.json({ 
        id: biz.id, 
        name: biz.name, 
        email: biz.email, 
        status: biz.status,
        address: biz.address,
        location: biz.location,
        createdAt: biz.createdAt,
        logoUrl: biz.logoUrl,
        category: biz.category
    });
};

/**
 * Update authenticated business information
 * PUT /api/business/me
 */
export const updateBusiness = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const { name, email, category } = req.body;

    try {
        const updatedBusiness = await businessService.updateBusiness(biz.id, { name, email, category });
        return res.json(updatedBusiness);
    } catch (error: any) {
        if (error.code === 11000) {
            return res.status(409).json({ message: 'email already in use' });
        }
        return res.status(500).json({ message: 'failed to update business' });
    }
};

/**
 * Upload business logo
 * POST /api/business/logo
 * Expects multipart/form-data with field 'logo'
 */
export const uploadLogo = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    if (!req.file) {
        return res.status(400).json({ message: 'no file uploaded' });
    }

    try {
        // Upload to S3
        const logoUrl = await uploadService.uploadFile(req.file, 'logos');

        // Update business record
        const updatedBusiness = await businessService.updateBusinessLogo(biz.id, logoUrl);

        return res.json({
            message: 'Logo uploaded successfully',
            logoUrl,
            business: updatedBusiness,
        });
    } catch (error: any) {
        console.error('Upload error:', error);
        return res.status(500).json({ message: 'failed to upload logo' });
    }
};

export const getBusinessById = async (req: Request, res: Response) => {
    const { id } = req.params;
    
    if (!id) {
        return res.status(400).json({ message: 'business id is required' });
    }

    try {
        const business = await businessService.findBusinessById(id);
        
        if (!business) {
            return res.status(404).json({ message: 'business not found' });
        }

        // Return only public information (no passHash)
        return res.json({
            id: business.id,
            name: business.name,
            email: business.email,
            status: business.status,
            address: business.address,
            location: business.location,
            createdAt: business.createdAt,
            logoUrl: business.logoUrl
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get business information' });
    }
};

/**
 * Update business location
 * Expects { address: "calle-numero-ciudad-estado-pais" }
 */
export const updateLocation = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const { address } = req.body as { address?: string };

    if (!address) {
        return res.status(400).json({ message: 'address is required in format: calle-numero-ciudad-estado-pais' });
    }

    try {
        const updatedBusiness = await businessService.updateBusinessLocation(biz.id, address);
        
        return res.json({
            message: 'Location updated successfully',
            business: {
                id: updatedBusiness.id,
                name: updatedBusiness.name,
                location: updatedBusiness.location,
            },
        });
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to update location' });
    }
};

/**
 * Update business coordinates
 * Expects { latitude: number, longitude: number }
 * Used when user adjusts marker position in frontend map
 */
export const updateCoordinates = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const { latitude, longitude } = req.body as { latitude?: number; longitude?: number };

    if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        return res.status(400).json({ message: 'latitude and longitude must be numbers' });
    }

    try {
        const updatedBusiness = await businessService.updateBusinessCoordinates(biz.id, latitude, longitude);
        
        return res.json({
            message: 'Coordinates updated successfully',
            business: {
                id: updatedBusiness.id,
                name: updatedBusiness.name,
                address: updatedBusiness.address,
                location: updatedBusiness.location,
            },
        });
    } catch (error: any) {
        if (error.message) {
            return res.status(400).json({ message: error.message });
        }
        return res.status(500).json({ message: 'failed to update coordinates' });
    }
};

/**
 * Find nearby businesses
 * Query params: latitude, longitude, maxDistanceKm (optional, default 10), category (optional)
 */
export const getNearbyBusinesses = async (req: Request, res: Response) => {
    const { latitude, longitude, maxDistanceKm, category } = req.query;

    if (!latitude || !longitude) {
        return res.status(400).json({ message: 'latitude and longitude are required' });
    }

    const lat = parseFloat(latitude as string);
    const lng = parseFloat(longitude as string);
    const maxDist = maxDistanceKm ? parseFloat(maxDistanceKm as string) : 10;

    if (isNaN(lat) || isNaN(lng) || isNaN(maxDist)) {
        return res.status(400).json({ message: 'invalid coordinates or distance' });
    }

    try {
        const businesses = await businessService.findNearbyBusinesses(lat, lng, maxDist, category as string);
        
        return res.json({
            center: { latitude: lat, longitude: lng },
            maxDistanceKm: maxDist,
            count: businesses.length,
            businesses,
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to find nearby businesses' });
    }
};

/**
 * Delete the authenticated business account
 * DELETE /api/business/me
 */
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

/**
 * Get businesses within map bounds (for dynamic map rendering)
 * GET /api/business/in-bounds?minLat=X&maxLat=Y&minLng=A&maxLng=B&category=food
 */
export const getBusinessesInBounds = async (req: Request, res: Response) => {
    const { minLat, maxLat, minLng, maxLng, category } = req.query;

    if (!minLat || !maxLat || !minLng || !maxLng) {
        return res.status(400).json({ 
            message: 'minLat, maxLat, minLng, and maxLng are required' 
        });
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
        const businesses = await businessService.findBusinessesInBounds(
            bounds.minLat,
            bounds.maxLat,
            bounds.minLng,
            bounds.maxLng,
            category as string
        );
        
        return res.json({
            bounds,
            count: businesses.length,
            businesses,
        });
    } catch (error) {
        console.error('Get businesses in bounds error:', error);
        return res.status(500).json({ message: 'failed to get businesses' });
    }
};

/**
 * Get all businesses ordered by distance from user (for business list)
 * GET /api/business/all?latitude=X&longitude=Y&limit=100&category=food
 */
export const getAllBusinesses = async (req: Request, res: Response) => {
    const { latitude, longitude, limit, category } = req.query;

    let lat: number | undefined;
    let lng: number | undefined;
    let maxLimit = 100;

    if (latitude && longitude) {
        lat = parseFloat(latitude as string);
        lng = parseFloat(longitude as string);

        if (isNaN(lat) || isNaN(lng)) {
            return res.status(400).json({ message: 'invalid coordinates' });
        }
    }

    if (limit) {
        maxLimit = parseInt(limit as string, 10);
        if (isNaN(maxLimit) || maxLimit < 1) {
            maxLimit = 100;
        }
    }

    try {
        const businesses = await businessService.getAllBusinesses(lat, lng, maxLimit, category as string);
        
        return res.json({
            userLocation: lat && lng ? { latitude: lat, longitude: lng } : null,
            count: businesses.length,
            businesses,
        });
    } catch (error) {
        console.error('Get all businesses error:', error);
        return res.status(500).json({ message: 'failed to get businesses' });
    }
};

/**
 * Get list of available business categories
 * GET /api/business/categories
 */
export const getCategories = (req: Request, res: Response) => {
    const categories = ['food', 'retail', 'services', 'entertainment', 'other'];
    return res.json(categories);
};

/**
 * Get businesses by specific category
 * GET /api/business/category/:category
 */
export const getBusinessesByCategory = async (req: Request, res: Response) => {
    const { category } = req.params;
    
    if (!category) {
        return res.status(400).json({ message: 'category is required' });
    }

    try {
        // Reuse the service method with no location (unless passed in query, but let's keep it simple for this route)
        const businesses = await businessService.getAllBusinesses(undefined, undefined, 100, category);
        
        return res.json({
            category,
            count: businesses.length,
            businesses,
        });
    } catch (error) {
        console.error('Get businesses by category error:', error);
        return res.status(500).json({ message: 'failed to get businesses' });
    }
};
