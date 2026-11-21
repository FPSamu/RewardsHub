import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { BusinessModel, IBusiness } from '../models/business.model';
import * as geocodingService from './geocoding.service';
import { isCacheEnabled } from '../cache/redis';
import {
    CacheMeta, bypass, cachedBusinessDocs, roundCoord, roundRadiusUp, roundBoundsOut, CENTER_ROUNDING_PAD_KM,
} from '../cache/bizmapCache';

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

export type InternalBusiness = ReturnType<typeof toPublic>;

/**
 * DTO para respuestas a clientes: lo mismo que toPublic pero sin los hashes.
 * toPublic se queda para uso interno (req.business, login), que sí los necesita.
 */
export const toPublicResponse = (business: InternalBusiness) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passHash, branchPassHash, ...rest } = business;
    return rest;
};

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

// ── Consultas del mapa ───────────────────────────────────────────────────────
//
// GEO_QUERY_MODE=geo → índice 2dsphere sobre locations.geo ($geoNear / $geoWithin).
// Sin definir → consulta legacy por recuadro de lat/lng (la de siempre).
// En los dos modos el filtro fino (distancia haversine, bordes del recuadro) se
// hace en JS con el mismo código, así que la respuesta es la misma: el índice
// solo trae un superconjunto de candidatos más rápido.
// Producción sigue en legacy hasta que corra scripts/migrate-locations-geo.ts.

export const geoQueryMode = (): 'geo' | 'legacy' => (process.env.GEO_QUERY_MODE === 'geo' ? 'geo' : 'legacy');

const VISIBLE = { isVerified: true, status: 'active' };

// $geoNear mide con radio terrestre 6378.1 km y calculateDistance con 6371 km:
// se pide un poco más de radio para no perder candidatos en el borde.
const GEO_RADIUS_MARGIN = (6378.1 / 6371) * 1.001;

/** Fila del mapa: una por sucursal (contrato fijado en tests/business.geoContracts.test.ts). */
const branchRow = (biz: InternalBusiness, loc: any, distance: number) => ({
    id: biz.id,
    branchId: loc._id,
    username: biz.username,
    branchName: loc.name,
    logoUrl: biz.logoUrl,
    location: loc,
    distance,
});

const findDocsNear = async (latitude: number, longitude: number, maxDistanceKm: number, limit?: number) => {
    if (geoQueryMode() === 'geo') {
        const pipeline: any[] = [{
            $geoNear: {
                near: { type: 'Point', coordinates: [longitude, latitude] },
                key: 'locations.geo',
                distanceField: '_geoDistance',
                maxDistance: maxDistanceKm * 1000 * GEO_RADIUS_MARGIN,
                spherical: true,
                query: VISIBLE,
            },
        }];
        if (limit) pipeline.push({ $limit: limit });
        const raw = await BusinessModel.aggregate(pipeline);
        return raw.map(({ _geoDistance, ...doc }) => BusinessModel.hydrate(doc));
    }

    const latDelta = maxDistanceKm / 111;
    const lngDelta = maxDistanceKm / (111 * Math.cos(latitude * Math.PI / 180));

    return BusinessModel.find({
        locations: {
            $elemMatch: {
                latitude: { $gte: latitude - latDelta, $lte: latitude + latDelta },
                longitude: { $gte: longitude - lngDelta, $lte: longitude + lngDelta }
            }
        },
        ...VISIBLE
    }).exec();
};

/**
 * @param limit - máximo de NEGOCIOS candidatos (los más cercanos). Solo aplica
 *                en modo geo; sin limit, como siempre, no hay tope.
 */
export const findNearbyBusinesses = async (
    latitude: number,
    longitude: number,
    maxDistanceKm: number = 300,
    limit?: number,
    meta?: CacheMeta
): Promise<any[]> => {
    // Con caché: candidatos de un área un poco mayor, por parámetros redondeados;
    // el filtro exacto de abajo usa las coordenadas reales (respuesta idéntica).
    let businesses: any[];
    if (isCacheEnabled()) {
        const [qLat, qLng, qKm] = [roundCoord(latitude), roundCoord(longitude), roundRadiusUp(maxDistanceKm)];
        businesses = await cachedBusinessDocs(
            `near:${geoQueryMode()}:${qLat}:${qLng}:${qKm}:${limit ?? ''}`,
            () => findDocsNear(qLat, qLng, qKm + CENTER_ROUNDING_PAD_KM, limit),
            meta
        );
    } else {
        bypass(meta);
        businesses = await findDocsNear(latitude, longitude, maxDistanceKm, limit);
    }

    const results: any[] = [];

    businesses.forEach(doc => {
        const biz = toPublic(doc as IBusiness);
        if (doc.locations && Array.isArray(doc.locations)) {
            doc.locations.forEach((loc: any) => {
                const distance = calculateDistance(latitude, longitude, loc.latitude, loc.longitude);
                if (distance <= maxDistanceKm) {
                    results.push(branchRow(biz, loc, distance));
                }
            });
        }
    });

    results.sort((a, b) => a.distance - b.distance);
    return results;
};

const GEO_BOX_MARGIN_DEG = 0.01; // ~1 km: cubre la curvatura de los bordes geodésicos
const GEO_EDGE_STEP_DEG = 0.5;

/**
 * Polígono GeoJSON del recuadro, un poco más grande. En GeoJSON los bordes son
 * geodésicas (no paralelos), así que los bordes norte/sur se parten en tramos
 * de 0.5° para que no se curven más que unos metros.
 */
const boxPolygon = (minLat: number, maxLat: number, minLng: number, maxLng: number) => {
    const lo = Math.max(-89, minLat - GEO_BOX_MARGIN_DEG);
    const hi = Math.min(89, maxLat + GEO_BOX_MARGIN_DEG);
    const west = Math.max(-180, minLng - GEO_BOX_MARGIN_DEG);
    const east = Math.min(180, maxLng + GEO_BOX_MARGIN_DEG);

    const lngs: number[] = [];
    for (let x = west; x < east; x += GEO_EDGE_STEP_DEG) lngs.push(x);
    lngs.push(east);

    const ring = [
        ...lngs.map((x) => [x, lo]),
        ...[...lngs].reverse().map((x) => [x, hi]),
        [west, lo],
    ];
    return { type: 'Polygon', coordinates: [ring] };
};

/**
 * El polígono solo sirve para recuadros "normales". Para los demás se usa la
 * consulta legacy, que da el resultado de siempre: cerca de los polos, de
 * 180° o más de ancho (un polígono así no es un recuadro), o cruzando el
 * antimeridiano (minLng > maxLng: hoy devuelve vacío y se conserva).
 */
const canUseGeoBox = (minLat: number, maxLat: number, minLng: number, maxLng: number) =>
    minLat >= -85 && maxLat <= 85 && minLat <= maxLat && minLng <= maxLng && maxLng - minLng < 180;

const findDocsInBounds = (minLat: number, maxLat: number, minLng: number, maxLng: number) =>
    geoQueryMode() === 'geo' && canUseGeoBox(minLat, maxLat, minLng, maxLng)
        ? BusinessModel.find({
            'locations.geo': { $geoWithin: { $geometry: boxPolygon(minLat, maxLat, minLng, maxLng) } },
            ...VISIBLE,
        }).sort({ _id: 1 }).exec()
        : BusinessModel.find({
            locations: {
                $elemMatch: {
                    latitude: { $gte: minLat, $lte: maxLat },
                    longitude: { $gte: minLng, $lte: maxLng }
                }
            },
            ...VISIBLE
        }).exec();

export const findBusinessesInBounds = async (
    minLat: number,
    maxLat: number,
    minLng: number,
    maxLng: number,
    meta?: CacheMeta
) => {
    // Con caché: el recuadro se redondea HACIA AFUERA (contiene al pedido) y
    // el filtro de abajo usa los bordes reales.
    let businesses: any[];
    if (isCacheEnabled()) {
        const q = roundBoundsOut(minLat, maxLat, minLng, maxLng);
        businesses = await cachedBusinessDocs(
            `bounds:${geoQueryMode()}:${q.minLat}:${q.maxLat}:${q.minLng}:${q.maxLng}`,
            () => findDocsInBounds(q.minLat, q.maxLat, q.minLng, q.maxLng),
            meta
        );
    } else {
        bypass(meta);
        businesses = await findDocsInBounds(minLat, maxLat, minLng, maxLng);
    }

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
    limit: number = 100,
    meta?: CacheMeta
) => {
    if (latitude === undefined || longitude === undefined) {
        const load = () => BusinessModel.find({ status: 'active', isVerified: true }).limit(limit).exec();
        const docs = isCacheEnabled() ? await cachedBusinessDocs(`all:${limit}`, load, meta) : (bypass(meta), await load());
        return docs.map(doc => toPublicResponse(toPublic(doc as IBusiness)));
    }
    // En modo geo se acota a los 200 negocios más cercanos (el radio de 5000 km es casi todo el país)
    return findNearbyBusinesses(latitude, longitude, 5000, geoQueryMode() === 'geo' ? 200 : undefined, meta);
};
