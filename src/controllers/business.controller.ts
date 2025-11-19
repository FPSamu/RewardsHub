import { Request, Response } from 'express';
import * as businessService from '../services/business.service';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;
const ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || '7d';

export const register = async (req: Request, res: Response) => {
    const { name, email, password } = req.body as { name: string; email: string; password: string };
    if (!name || !email || !password) {
        return res.status(400).json({ message: 'name, email and password are required' });
    }

    const existing = await businessService.findBusinessByEmail(email);
    if (existing) return res.status(409).json({ message: 'email already used' });

    const biz = await businessService.createBusiness(name, email, password);
    const accessToken = (jwt as any).sign({ sub: biz.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: biz.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    await businessService.addRefreshToken(biz.id, refreshToken);
    return res.status(201).json({ business: { id: biz.id, name: biz.name, email: biz.email, createdAt: biz.createdAt }, token: accessToken, refreshToken });
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
        createdAt: biz.createdAt 
    });
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
 * Query params: latitude, longitude, maxDistanceKm (optional, default 10)
 */
export const getNearbyBusinesses = async (req: Request, res: Response) => {
    const { latitude, longitude, maxDistanceKm } = req.query;

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
        const businesses = await businessService.findNearbyBusinesses(lat, lng, maxDist);
        
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
