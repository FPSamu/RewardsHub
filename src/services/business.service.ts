import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { BusinessModel, IBusiness, ILocation } from '../models/business.model';
import * as geocodingService from './geocoding.service';

const toPublic = (doc: IBusiness) => ({
    id: doc._id.toString(),
    username: doc.username,
    email: doc.email,
    passHash: doc.passHash,
    branchPassHash: doc.branchPassHash,
    status: doc.status,
    address: doc.address,
    locations: doc.locations || [],
    logoUrl: doc.logoUrl,
    timezone: doc.timezone || 'UTC',
    createdAt: doc.createdAt.toISOString(),
    isVerified: doc.isVerified,
    registeredWithGoogle: !!doc.googleUid,
    hasBranchPassword: !!doc.branchPassHash || !doc.googleUid, // email/password accounts always have one (passHash)
    mainLocation: doc.locations && doc.locations.length > 0
        ? doc.locations.find(l => l.isMain) || doc.locations[0]
        : undefined,
});

export const findBusinessByGoogleUid = async (googleUid: string) => {
    const doc = await BusinessModel.findOne({ googleUid }).exec();
    return doc ? toPublic(doc as IBusiness) : undefined;
};

export const createBusiness = async (username: string, email: string, password?: string, googleUid?: string) => {
    const passHash = password
        ? await bcrypt.hash(password, 10)
        : await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    console.log('🔵 [CREATE BUSINESS] Creando negocio:', { email: email.toLowerCase(), timestamp: new Date().toISOString() });

    const doc = await BusinessModel.create({
        username,
        email: email.toLowerCase(),
        passHash,
        isVerified: !!googleUid,
        locations: [],
        ...(googleUid && { googleUid }),
    });

    console.log('🟢 [CREATE BUSINESS] Negocio creado:', {
        email: doc.email,
        id: doc._id,
        isVerified: doc.isVerified,
        timestamp: new Date().toISOString()
    });

    return toPublic(doc as IBusiness);
};

export const verifyBusinessEmail = async (token: string) => {
    const doc = await BusinessModel.findOne({ verificationToken: token }).exec();
    if (!doc) return undefined;

    doc.isVerified = true;
    doc.verificationToken = undefined;
    await doc.save();

    return { id: doc.id, username: doc.username, email: doc.email, isVerified: doc.isVerified, role: 'business' };
};

export const findBusinessByEmail = async (email: string) => {
    const doc = await BusinessModel.findOne({ email: email.toLowerCase() }).exec();
    return doc ? toPublic(doc as IBusiness) : undefined;
};

export const findBusinessById = async (id: string) => {
    const doc = await BusinessModel.findById(id).exec();
    return doc ? toPublic(doc as IBusiness) : undefined;
};

export const addBranch = async (
    businessId: string,
    addressString: string,
    branchName?: string,
    lat?: number,
    lng?: number
) => {
    let latitude = lat;
    let longitude = lng;
    let formattedAddress = '';

    if (latitude === undefined || longitude === undefined) {
        const geo = await geocodingService.geocodeAddress(addressString);
        latitude = geo.latitude;
        longitude = geo.longitude;
        formattedAddress = geo.displayName;
    }

    const newLocation = {
        name: branchName || 'Sucursal',
        address: addressString,
        formattedAddress,
        latitude: latitude!,
        longitude: longitude!,
        isMain: false
    };

    const business = await BusinessModel.findById(businessId);
    if (!business) throw new Error('Business not found');

    if (business.locations && business.locations.length === 0) newLocation.isMain = true;
    if (!business.locations) business.locations = [];
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

    if (business.locations.length > 0 && !business.locations.some(l => l.isMain)) {
        business.locations[0].isMain = true;
    }

    await business.save();
    return toPublic(business);
};

export const updateBusiness = async (
    businessId: string,
    updates: { username?: string; email?: string; status?: 'active' | 'inactive' }
) => {
    const doc = await BusinessModel.findByIdAndUpdate(
        businessId,
        { $set: updates },
        { new: true, runValidators: true }
    ).exec();
    if (!doc) throw new Error('Business not found');
    return toPublic(doc as IBusiness);
};

export const updateBusinessLogo = async (businessId: string, logoUrl: string) => {
    const doc = await BusinessModel.findByIdAndUpdate(
        businessId,
        { logoUrl },
        { new: true }
    ).exec();
    if (!doc) throw new Error('Business not found');
    return toPublic(doc as IBusiness);
};

export const updateBranch = async (
    businessId: string,
    locationId: string,
    updates: { address?: string; name?: string; isMain?: boolean; latitude?: number; longitude?: number }
) => {
    const business = await BusinessModel.findById(businessId);
    if (!business) throw new Error('Business not found');
    if (!business.locations) throw new Error('No locations found for this business');

    const location = business.locations.find(l => l._id && l._id.toString() === locationId);
    if (!location) throw new Error('Location not found');

    if (updates.name) location.name = updates.name;

    if (updates.latitude !== undefined && updates.longitude !== undefined) {
        location.latitude = updates.latitude;
        location.longitude = updates.longitude;
        if (updates.address) location.address = updates.address;
    } else if (updates.address && updates.address !== location.address) {
        const geo = await geocodingService.geocodeAddress(updates.address);
        location.address = updates.address;
        location.formattedAddress = geo.displayName;
        location.latitude = geo.latitude;
        location.longitude = geo.longitude;
    }

    if (updates.isMain) {
        business.locations.forEach(l => l.isMain = false);
        location.isMain = true;
    }

    await business.save();
    return toPublic(business);
};

export const updateTimezone = async (businessId: string, timezone: string): Promise<void> => {
    await BusinessModel.findByIdAndUpdate(businessId, { $set: { timezone } });
};

export const deleteBusiness = async (businessId: string): Promise<void> => {
    const business = await BusinessModel.findById(businessId).exec();
    if (!business) throw new Error('Business not found');
    await BusinessModel.findByIdAndDelete(businessId).exec();
};

/** Establece o actualiza la contraseña de sucursal para acceso de cajeros. */
export const setBranchPassword = async (businessId: string, password: string): Promise<void> => {
    const hash = await bcrypt.hash(password, 10);
    await BusinessModel.findByIdAndUpdate(businessId, { branchPassHash: hash }).exec();
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const findNearbyBusinesses = async (
    latitude: number,
    longitude: number,
    maxDistanceKm: number = 300
): Promise<any[]> => {
    const latDelta = maxDistanceKm / 111;
    const lngDelta = maxDistanceKm / (111 * Math.cos(latitude * Math.PI / 180));

    const businesses = await BusinessModel.find({
        locations: {
            $elemMatch: {
                latitude: { $gte: latitude - latDelta, $lte: latitude + latDelta },
                longitude: { $gte: longitude - lngDelta, $lte: longitude + lngDelta }
            }
        },
        isVerified: true,
        status: 'active'
    }).exec();

    const results: any[] = [];

    businesses.forEach(doc => {
        const biz = toPublic(doc as IBusiness);
        if (doc.locations && Array.isArray(doc.locations)) {
            doc.locations.forEach(loc => {
                const distance = calculateDistance(latitude, longitude, loc.latitude, loc.longitude);
                if (distance <= maxDistanceKm) {
                    results.push({
                        id: biz.id,
                        branchId: loc._id,
                        username: biz.username,
                        branchName: loc.name,
                        logoUrl: biz.logoUrl,
                        location: loc,
                        distance
                    });
                }
            });
        }
    });

    results.sort((a, b) => a.distance - b.distance);
    return results;
};

export const findBusinessesInBounds = async (
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number
) => {
    const businesses = await BusinessModel.find({
        locations: {
            $elemMatch: {
                latitude: { $gte: minLat, $lte: maxLat },
                longitude: { $gte: minLng, $lte: maxLng }
            }
        },
        isVerified: true,
        status: 'active'
    }).exec();

    const results: any[] = [];

    businesses.forEach(doc => {
        const biz = toPublic(doc as IBusiness);
        if (doc.locations && Array.isArray(doc.locations)) {
            doc.locations.forEach((loc: any) => {
                if (loc.latitude >= minLat && loc.latitude <= maxLat &&
                    loc.longitude >= minLng && loc.longitude <= maxLng) {
                    results.push({
                        id: biz.id,
                        branchId: loc._id,
                        username: biz.username,
                        branchName: loc.name,
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

export const getAllBusinesses = async (
    latitude?: number,
    longitude?: number,
    limit: number = 100
) => {
    if (latitude === undefined || longitude === undefined) {
        const docs = await BusinessModel.find({ status: 'active', isVerified: true }).limit(limit).exec();
        return docs.map(doc => toPublic(doc as IBusiness));
    }
    return findNearbyBusinesses(latitude, longitude, 5000);
};
