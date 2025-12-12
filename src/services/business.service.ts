import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { BusinessModel, IBusiness, ILocation } from '../models/business.model';
import * as geocodingService from './geocoding.service';

const toPublic = (doc: IBusiness) => ({
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    passHash: doc.passHash,
    status: doc.status,
    address: doc.address,
    locations: doc.locations,
    logoUrl: doc.logoUrl,
    createdAt: doc.createdAt.toISOString(),
    isVerified: doc.isVerified,
    category: doc.category,
    mainLocation: doc.locations && doc.locations.length > 0
        ? doc.locations.find(l => l.isMain) || doc.locations[0]
        : undefined,
});

export const createBusiness = async (name: string, email: string, password: string, category: string = 'food') => {
    const passHash = await bcrypt.hash(password, 10);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const doc = await BusinessModel.create({ 
        name, 
        email: email.toLowerCase(), 
        passHash,
        verificationToken,
        isVerified: false,
        locations: [],
        category
    });
    // Return the full doc (or extended public object) so controller can access verificationToken
    return { ...toPublic(doc as IBusiness), verificationToken };
};

export const generateVerificationToken = async (userId: string): Promise<string> => {
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    await BusinessModel.findByIdAndUpdate(userId, { verificationToken: token }).exec();
    return token;
};

export const verifyBusinessEmail = async (token: string) => {
    const doc = await BusinessModel.findOne({ verificationToken: token }).exec();
    
    if (!doc) return undefined;
    
    doc.isVerified = true;
    doc.verificationToken = undefined;
    await doc.save();
    
    return {
        id: doc.id,
        name: doc.name,
        email: doc.email,
        isVerified: doc.isVerified,
        role: 'business'
    };
};

export const generatePasswordResetToken = async (email: string) => {
    const doc = await BusinessModel.findOne({ email: email.toLowerCase() }).exec();
    if (!doc) return null;

    const resetToken = crypto.randomBytes(32).toString('hex');
    doc.resetPasswordToken = resetToken;
    doc.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
    await doc.save();
    
    return resetToken;
};

export const resetPassword = async (token: string, newPassword: string) => {
    const doc = await BusinessModel.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() }
    }).exec();

    if (!doc) return null;

    doc.passHash = await bcrypt.hash(newPassword, 10);
    doc.resetPasswordToken = undefined;
    doc.resetPasswordExpires = undefined;
    await doc.save();

    return toPublic(doc as IBusiness);
};

export const findBusinessByEmail = async (email: string) => {
    const doc = await BusinessModel.findOne({ email: email.toLowerCase() }).exec();
    return doc ? toPublic(doc as IBusiness) : undefined;
};

export const findBusinessById = async (id: string) => {
    const doc = await BusinessModel.findById(id).exec();
    return doc ? toPublic(doc as IBusiness) : undefined;
};

export const verifyPassword = async (password: string, passHash: string): Promise<boolean> => {
    return bcrypt.compare(password, passHash);
};

export const addRefreshToken = async (businessId: string, token: string): Promise<void> => {
    await BusinessModel.findByIdAndUpdate(businessId, { $push: { refreshTokens: token } }).exec();
};

export const removeRefreshToken = async (businessId: string, token: string): Promise<void> => {
    await BusinessModel.findByIdAndUpdate(businessId, { $pull: { refreshTokens: token } }).exec();
};

export const hasRefreshToken = async (businessId: string, token: string): Promise<boolean> => {
    const doc = await BusinessModel.findOne({ _id: businessId, refreshTokens: token }).exec();
    return !!doc;
};

export const addBranch = async (businessId: string, addressString: string, branchName?: string) => {
    const geo = await geocodingService.geocodeAddress(addressString);
    
    const newLocation = {
        name: branchName || 'Sucursal Principal',
        address: addressString,
        formattedAddress: geo.displayName,
        latitude: geo.latitude,
        longitude: geo.longitude,
        isMain: false 
    };

    const business = await BusinessModel.findById(businessId);
    if (!business) throw new Error('Business not found');

    if (business.locations && business.locations.length === 0) newLocation.isMain = true;

    if (!business.locations) {
        business.locations = [];
    }
    business.locations.push(newLocation);
    await business.save();

    return toPublic(business);
};

export const removeBranch = async (businessId: string, locationId: string) => {
    const business = await BusinessModel.findById(businessId);
    if (!business) throw new Error('Business not found');

    if (business.locations) {
        business.locations = business.locations.filter(l => (l as any)._id.toString() !== locationId);
    } else {
        business.locations = [];
    }
    
    // Si borramos la principal y quedan otras, asignamos una nueva principal
    if (business.locations.length > 0 && !business.locations.some(l => l.isMain)) {
        business.locations[0].isMain = true;
    }

    await business.save();
    return toPublic(business);
};

/**
 * Update business information
 * @param businessId - The business ID
 * @param updates - Object containing fields to update
 * @returns Updated business object
 */
export const updateBusiness = async (
    businessId: string,
    updates: { name?: string; email?: string; status?: 'active' | 'inactive'; category?: string }
) => {
    const doc = await BusinessModel.findByIdAndUpdate(
        businessId,
        { $set: updates },
        { new: true, runValidators: true }
    ).exec();

    if (!doc) {
        throw new Error('Business not found');
    }

    return toPublic(doc as IBusiness);
};

/**
 * Update business logo URL
 * @param businessId - The business ID
 * @param logoUrl - The new logo URL
 * @returns Updated business object
 */
export const updateBusinessLogo = async (businessId: string, logoUrl: string) => {
    const doc = await BusinessModel.findByIdAndUpdate(
        businessId,
        { logoUrl },
        { new: true }
    ).exec();

    if (!doc) {
        throw new Error('Business not found');
    }

    return toPublic(doc as IBusiness);
};

export const updateBranch = async (
    businessId: string, 
    locationId: string, 
    updates: { address?: string; name?: string; isMain?: boolean }
) => {
    const business = await BusinessModel.findById(businessId);
    if (!business) throw new Error('Business not found');

    if (!business.locations) throw new Error('No locations found for this business');
    const location = business.locations.find(l => l._id && l._id.toString() === locationId);
    if (!location) throw new Error('Location not found');

    if (updates.name) location.name = updates.name;

    if (updates.address && updates.address !== location.address) {
        const geo = await geocodingService.geocodeAddress(updates.address);
        location.address = updates.address;
        location.formattedAddress = geo.displayName;
        location.latitude = geo.latitude;
        location.longitude = geo.longitude;
    }

    if (updates.isMain !== undefined && updates.isMain) {
        business.locations.forEach(l => l.isMain = false);
        location.isMain = true;
    }

    await business.save();
    return toPublic(business);
};

/**
 * Update business location using geocoding
 * @param businessId - The business ID
 * @param addressString - Address in format "calle-numero-ciudad-estado-pais"
 * @returns Updated business object
 */

/**
 * Find businesses near a specific location
 * @param latitude - Center latitude
 * @param longitude - Center longitude
 * @param maxDistanceKm - Maximum distance in kilometers (default: 10km)
 * @param category - Optional category to filter by
 * @returns Array of nearby businesses
 */
export const findNearbyBusinesses = async (
    latitude: number,
    longitude: number,
    maxDistanceKm: number = 300,
    category?: string
): Promise<any[]> => {
    // Simple distance calculation using lat/lng
    // 1 degree ≈ 111km, so we calculate a rough bounding box
    const latDelta = maxDistanceKm / 111;
    const lngDelta = maxDistanceKm / (111 * Math.cos(latitude * Math.PI / 180));

    const query: any = {
        'locations': {
            $elemMatch: {
                'latitude': { 
                    $gte: latitude - latDelta, 
                    $lte: latitude + latDelta
                },
                'longitude': {
                    $gte: longitude - lngDelta, 
                    $lte: longitude + lngDelta
                }
            }
        },
        // 'location': { $exists: true },
        'isVerified': true
    };

    if (category) {
        query.category = category;
    }

    const businesses = await BusinessModel.find(query).exec();

    let results: any[] = [];

    businesses.forEach(doc => {
        const biz = toPublic(doc as IBusiness);
        
        if (doc.locations && Array.isArray(doc.locations)) {
            doc.locations.forEach(loc => {
                const distance = calculateDistance(latitude, longitude, loc.latitude, loc.longitude);
                
                if (distance <= maxDistanceKm) {
                    results.push({
                        id: biz.id,
                        branchId: loc._id,
                        name: biz.name,
                        branchName: loc.name,
                        category: biz.category,
                        logoUrl: biz.logoUrl,
                        location: loc,
                        distance: distance
                    });
                }
            });
        }
    });

    results.sort((a, b) => a.distance - b.distance);

    return results;
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in kilometers
 */
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Delete a business account
 * @param businessId - The business ID to delete
 * @returns void
 */
export const deleteBusiness = async (businessId: string): Promise<void> => {
    const business = await BusinessModel.findById(businessId).exec();
    
    if (!business) {
        throw new Error('Business not found');
    }

    await BusinessModel.findByIdAndDelete(businessId).exec();
};

/**
 * Find businesses within map bounds (bounding box)
 * @param minLat - Minimum latitude
 * @param maxLat - Maximum latitude
 * @param minLng - Minimum longitude
 * @param maxLng - Maximum longitude
 * @param category - Optional category filter
 * @returns Array of businesses within the bounds
 */
export const findBusinessesInBounds = async (
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    category?: string
) => {
    const query: any = {
        'locations': {
            $elemMatch: {
                latitude: { $gte: minLat, $lte: maxLat },
                longitude: { $gte: minLng, $lte: maxLng }
            }
        },
        'isVerified': true,
        'status': 'active'
    };

    if (category) {
        query.category = category;
    }

    const businesses = await BusinessModel.find(query).exec();

    let results: any[] = [];

    businesses.forEach(doc => {
        const biz = toPublic(doc as IBusiness);
        
        if (doc.locations && Array.isArray(doc.locations)) {
            doc.locations.forEach((loc: any) => {
                if (loc.latitude >= minLat && loc.latitude <= maxLat &&
                    loc.longitude >= minLng && loc.longitude <= maxLng) {
                    
                    results.push({
                        id: biz.id,
                        branchId: loc._id,
                        name: biz.name,
                        branchName: loc.name,
                        category: biz.category,
                        logoUrl: biz.logoUrl,
                        location: { 
                            latitude: loc.latitude,
                            longitude: loc.longitude,
                            address: loc.address,
                            formattedAddress: loc.formattedAddress
                        }
                    });
                }
            });
        }
    });

    return results;
};

/**
 * Get all businesses ordered by distance from user location
 * @param latitude - User's latitude (optional)
 * @param longitude - User's longitude (optional)
 * @param limit - Maximum number of results (default: 100)
 * @param category - Optional category filter
 * @returns Array of all businesses, ordered by distance if coordinates provided
 */
export const getAllBusinesses = async (
    latitude?: number,
    longitude?: number,
    limit: number = 100,
    category?: string
) => {    
    if (latitude === undefined || longitude === undefined) {
        const query: any = { status: 'active' };
        if (category) query.category = category;
        const docs = await BusinessModel.find(query).limit(limit).exec();
        return docs.map(doc => toPublic(doc as IBusiness));
    }

    return findNearbyBusinesses(latitude, longitude, 5000, category);
};
