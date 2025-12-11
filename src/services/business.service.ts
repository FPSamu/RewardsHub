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
    location: doc.location,
    logoUrl: doc.logoUrl,
    createdAt: doc.createdAt.toISOString(),
    isVerified: doc.isVerified,
    category: doc.category,
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

/**
 * Update business coordinates directly
 * @param businessId - The business ID
 * @param latitude - Latitude coordinate
 * @param longitude - Longitude coordinate
 * @returns Updated business object
 */
export const updateBusinessCoordinates = async (
    businessId: string,
    latitude: number,
    longitude: number
) => {
    // Validate coordinates
    if (latitude < -90 || latitude > 90) {
        throw new Error('Invalid latitude. Must be between -90 and 90.');
    }
    if (longitude < -180 || longitude > 180) {
        throw new Error('Invalid longitude. Must be between -180 and 180.');
    }

    // Get current business to preserve address
    const currentBusiness = await BusinessModel.findById(businessId).exec();
    if (!currentBusiness) {
        throw new Error('Business not found');
    }

    // Update only coordinates, preserving the address
    const updatedLocation: ILocation = {
        address: currentBusiness.location?.address || currentBusiness.address || '',
        latitude,
        longitude,
        formattedAddress: currentBusiness.location?.formattedAddress,
    };

    const doc = await BusinessModel.findByIdAndUpdate(
        businessId,
        { location: updatedLocation },
        { new: true }
    ).exec();

    if (!doc) {
        throw new Error('Business not found');
    }

    return toPublic(doc as IBusiness);
};

/**
 * Update business location using geocoding
 * @param businessId - The business ID
 * @param addressString - Address in format "calle-numero-ciudad-estado-pais"
 * @returns Updated business object
 */
export const updateBusinessLocation = async (businessId: string, addressString: string) => {
    // Validate address format
    if (!geocodingService.validateAddressFormat(addressString)) {
        throw new Error('Invalid address format. Expected: calle-numero-ciudad-estado-pais');
    }

    // Geocode the address
    const geocodingResult = await geocodingService.geocodeAddress(addressString);

    // Update business with location
    const location: ILocation = {
        address: addressString,
        latitude: geocodingResult.latitude,
        longitude: geocodingResult.longitude,
        formattedAddress: geocodingResult.displayName,
    };

    const doc = await BusinessModel.findByIdAndUpdate(
        businessId,
        { 
            address: addressString,
            location 
        },
        { new: true }
    ).exec();

    if (!doc) {
        throw new Error('Business not found');
    }

    return toPublic(doc as IBusiness);
};

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
        'location.latitude': {
            $gte: latitude - latDelta,
            $lte: latitude + latDelta,
        },
        'location.longitude': {
            $gte: longitude - lngDelta,
            $lte: longitude + lngDelta,
        },
        'location': { $exists: true },
        'isVerified': true
    };

    if (category) {
        query.category = category;
    }

    const businesses = await BusinessModel.find(query).exec();

    // Calculate actual distances and filter
    const businessesWithDistance = businesses.map((doc) => {
        const biz = toPublic(doc as IBusiness);
        if (biz.location) {
            const distance = calculateDistance(
                latitude,
                longitude,
                biz.location.latitude,
                biz.location.longitude
            );
            return { ...biz, distance };
        }
        return null;
    }).filter((biz): biz is NonNullable<typeof biz> => biz !== null && biz.distance <= maxDistanceKm);

    // Sort by distance
    businessesWithDistance.sort((a, b) => a.distance - b.distance);

    return businessesWithDistance;
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
        'location.latitude': {
            $gte: minLat,
            $lte: maxLat,
        },
        'location.longitude': {
            $gte: minLng,
            $lte: maxLng,
        },
        'location': { $exists: true },
        'status': 'active'
    };

    if (category) {
        query.category = category;
    }

    const businesses = await BusinessModel.find(query).exec();

    return businesses.map((doc) => toPublic(doc as IBusiness));
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
    const query: any = {
        'location': { $exists: true },
        'status': 'active'
    };

    if (category) {
        query.category = category;
    }

    const businesses = await BusinessModel.find(query).limit(limit).exec();

    const businessList = businesses.map((doc) => toPublic(doc as IBusiness));

    // If user location is provided, calculate distances and sort
    if (latitude !== undefined && longitude !== undefined) {
        const businessesWithDistance = businessList.map((biz) => {
            if (biz.location) {
                const distance = calculateDistance(
                    latitude,
                    longitude,
                    biz.location.latitude,
                    biz.location.longitude
                );
                return { ...biz, distance };
            }
            return { ...biz, distance: Infinity };
        });

        // Sort by distance (closest first)
        businessesWithDistance.sort((a, b) => a.distance - b.distance);
        return businessesWithDistance;
    }

    // Return without distance calculation if no user location
    return businessList;
};
