/**
 * Mongoose Business model
 *
 * This module defines the schema and the typed interface for business documents.
 * It mirrors the `User` model structure but is stored in a separate collection.
 */
import { Schema, model, Document } from 'mongoose';
import { IRotatedRefreshToken, rotatedRefreshTokenSchema } from './rotatedRefreshToken.schema';
import { bumpBizmapVersion } from '../cache/bizmapVersion';

export interface ILocation {
    _id?: any;
    name?: string;
    address: string;
    latitude: number;
    longitude: number;
    formattedAddress?: string;
    isMain?: boolean;
    /** GeoJSON [lng, lat] para el índice 2dsphere. Interno: no sale en las respuestas. */
    geo?: { type: 'Point'; coordinates: number[] };
}

export interface IBusiness extends Document {
    _id: any;
    username: string;
    email: string;
    passHash: string;
    status: 'active' | 'inactive';
    address?: string;
    locations?: ILocation[];
    logoUrl?: string;
    timezone: string; // IANA timezone name (e.g. "America/Mexico_City")
    createdAt: Date;
    refreshTokens?: string[];
    rotatedRefreshTokens?: IRotatedRefreshToken[];
    isVerified: boolean;
    verificationToken?: string;
    resetPasswordToken?: string;
    resetPasswordExpires?: Date;
    adminPinHash?: string;        // bcrypt hash of the admin PIN
    isAdminPinTemporary?: boolean; // true until the business changes it
    googleUid?: string;
    branchPassHash?: string;      // contraseña de sucursal para acceso de cajeros (sin Google)
}

// Sin defaults a propósito: un { type: 'Point' } sin coordenadas lo rechaza el
// índice 2dsphere. El hook de abajo lo llena siempre a partir de lat/lng.
const geoPointSchema = new Schema(
    {
        type: { type: String, enum: ['Point'], required: true },
        coordinates: { type: [Number], required: true },
    },
    { _id: false }
);

const locationSchema = new Schema<ILocation>(
    {
        name: { type: String },
        address: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        formattedAddress: { type: String },
        isMain: { type: Boolean, default: false },
        geo: { type: geoPointSchema },
    }
);

// latitude/longitude siguen siendo la fuente de verdad (la API los devuelve);
// geo es una copia en GeoJSON para el índice. Todas las escrituras de sucursales
// pasan por doc.save() (addBranch, updateBranch, removeBranch), y cualquier save
// del negocio también rellena las sucursales viejas que aún no tenían geo.
locationSchema.pre('validate', function (next) {
    if (typeof this.latitude === 'number' && typeof this.longitude === 'number') {
        const [lng, lat] = this.geo?.coordinates ?? [];
        if (this.geo?.type !== 'Point' || lng !== this.longitude || lat !== this.latitude) {
            this.geo = { type: 'Point', coordinates: [this.longitude, this.latitude] };
        }
    }
    next();
});

// Las respuestas no cambian: geo es interno.
locationSchema.set('toJSON', {
    transform: (_doc: any, ret: any) => {
        delete ret.geo;
        return ret;
    },
});

const businessSchema = new Schema<IBusiness>(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true, index: true },
        passHash: { type: String, required: true },
        status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
        // address: { type: String },
        locations: { type: [locationSchema], default: [] },
        logoUrl: { type: String },
        timezone: { type: String, default: 'UTC' },
        createdAt: { type: Date, default: Date.now },
        refreshTokens: { type: [String], default: [] },
        rotatedRefreshTokens: { type: [rotatedRefreshTokenSchema], default: [] },
        isVerified: { type: Boolean, default: false },
        verificationToken: { type: String },
        resetPasswordToken: { type: String },
        resetPasswordExpires: { type: Date },
        adminPinHash: { type: String },
        isAdminPinTemporary: { type: Boolean, default: false },
        googleUid: { type: String },
        branchPassHash: { type: String },
    },
    { timestamps: false }
);

// El índice lat/lng lo sigue usando el modo legacy de las consultas del mapa
// (GEO_QUERY_MODE sin definir). Se puede borrar cuando geo esté en todos lados.
businessSchema.index({ 'locations.latitude': 1, 'locations.longitude': 1 });
businessSchema.index({ 'locations.geo': '2dsphere' });

businessSchema.virtual('id').get(function (this: IBusiness) {
    return this._id.toString();
});

/**
 * Middleware para detectar cambios en isVerified
 * Esto nos ayudará a diagnosticar por qué isVerified cambia automáticamente
 */
businessSchema.pre('save', function (next) {
    if (this.isModified('isVerified')) {
        const wasVerified = this.get('isVerified', null, { getters: false });
        console.log('⚠️  [BUSINESS MODEL] isVerified está siendo modificado:', {
            email: this.email,
            businessId: this._id,
            from: wasVerified,
            to: this.isVerified,
            timestamp: new Date().toISOString(),
            stack: new Error().stack?.split('\n').slice(0, 5).join('\n')
        });
    }
    next();
});

businessSchema.pre('findOneAndUpdate', function (next) {
    const update = this.getUpdate() as any;
    if (update && update.$set && 'isVerified' in update.$set) {
        console.log('⚠️  [BUSINESS MODEL] isVerified siendo actualizado via findOneAndUpdate:', {
            newValue: update.$set.isVerified,
            timestamp: new Date().toISOString(),
            stack: new Error().stack?.split('\n').slice(0, 5).join('\n')
        });
    }
    next();
});

// ── Invalidación de la caché del mapa (P4.3) ─────────────────────────────────
// Toda escritura que pueda cambiar lo que muestran /business/nearby, /in-bounds
// o /all sube la versión de la caché (INCR en Redis; no-op sin REDIS_URL, nunca
// falla la escritura). Los campos de sesión/seguridad no cuentan: si no, cada
// login (rotación de refresh tokens) vaciaría la caché.
const NOT_ON_MAP = new Set([
    'refreshTokens', 'rotatedRefreshTokens', 'verificationToken', 'resetPasswordToken',
    'resetPasswordExpires', 'adminPinHash', 'isAdminPinTemporary', 'passHash',
]);
const touchesMap = (paths: string[]) => paths.some((p) => !NOT_ON_MAP.has(p.split('.')[0]));

/** Rutas que toca un update de Mongo ({ $set: {...}, $push: {...}, campo: valor }). */
const updatedPaths = (update: any): string[] => {
    if (!update || typeof update !== 'object') return [];
    if (Array.isArray(update)) return ['*']; // pipeline de agregación: no se analiza
    return Object.entries(update).flatMap(([k, v]) =>
        k.startsWith('$') ? (v && typeof v === 'object' ? Object.keys(v as object) : []) : [k]);
};

businessSchema.pre('save', function (next) {
    this.$locals.bizmapDirty = this.isNew || touchesMap(this.modifiedPaths());
    next();
});
businessSchema.post('save', async function () {
    if (this.$locals.bizmapDirty) await bumpBizmapVersion();
});

const QUERY_UPDATES = ['findOneAndUpdate', 'updateOne', 'updateMany', 'findOneAndReplace', 'replaceOne'] as const;
businessSchema.pre(QUERY_UPDATES as any, function (this: any, next: () => void) {
    this._bizmapDirty = touchesMap(updatedPaths(this.getUpdate()));
    next();
});
businessSchema.post(QUERY_UPDATES as any, async function (this: any) {
    if (this._bizmapDirty) await bumpBizmapVersion();
});
businessSchema.post(['findOneAndDelete', 'deleteOne', 'deleteMany'] as any, { document: false, query: true } as any, async () => {
    await bumpBizmapVersion();
});
businessSchema.post('deleteOne', { document: true, query: false }, async () => {
    await bumpBizmapVersion();
});
businessSchema.post('insertMany', async () => {
    await bumpBizmapVersion();
});

businessSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
        delete ret.passHash;
        if (ret.refreshTokens) delete ret.refreshTokens;
        if (ret.rotatedRefreshTokens) delete ret.rotatedRefreshTokens;
    },
});

/**
 * Collection name resolution.
 * The user requested the env key `BUSINESSES_COLLECTOIN` (note: possible typo).
 * We'll support that exact key plus a corrected `BUSINESSES_COLLECTION` and
 * fall back to `DB_COLLECTION` if provided.
 */
const rawCollection = process.env.BUSINESSES_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const BusinessModel = model<IBusiness>('Business', businessSchema, collectionName);
