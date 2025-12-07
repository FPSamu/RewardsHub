import bcrypt from 'bcryptjs';
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
});

export const createBusiness = async (name: string, email: string, password: string) => {
    const passHash = await bcrypt.hash(password, 10);
    const doc = await BusinessModel.create({ name, email: email.toLowerCase(), passHash });
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
    updates: { name?: string; email?: string; status?: 'active' | 'inactive' }
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
 * @returns Array of nearby businesses
 */
export const findNearbyBusinesses = async (
    latitude: number,
    longitude: number,
    maxDistanceKm: number = 300
): Promise<any[]> => {
    // Simple distance calculation using lat/lng
    // 1 degree ≈ 111km, so we calculate a rough bounding box
    const latDelta = maxDistanceKm / 111;
    const lngDelta = maxDistanceKm / (111 * Math.cos(latitude * Math.PI / 180));

    const businesses = await BusinessModel.find({
        'location.latitude': {
            $gte: latitude - latDelta,
            $lte: latitude + latDelta,
        },
        'location.longitude': {
            $gte: longitude - lngDelta,
            $lte: longitude + lngDelta,
        },
        'location': { $exists: true },
    }).exec();

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
