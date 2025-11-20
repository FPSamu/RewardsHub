/**
 * System service (persistence layer)
 *
 * This module manages reward systems for businesses.
 */
import { SystemModel, ISystem, IPointsConversion } from '../models/system.model';
import { Types } from 'mongoose';

/**
 * Public system object interface
 */
export interface PublicSystem {
    id: string;
    businessId: string;
    type: 'points' | 'stamps';
    name: string;
    description?: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    pointsConversion?: IPointsConversion;
    targetStamps?: number;
    productType?: 'specific' | 'general' | 'any';
    productIdentifier?: string;
}

/**
 * Convert a Mongoose document into a plain public object
 */
const toPublic = (doc: ISystem): PublicSystem => ({
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    type: doc.type,
    name: doc.name,
    description: doc.description,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    pointsConversion: doc.pointsConversion,
    targetStamps: doc.targetStamps,
    productType: doc.productType,
    productIdentifier: doc.productIdentifier,
});

/**
 * Create a new points-based system
 */
export const createPointsSystem = async (
    businessId: string,
    name: string,
    description: string | undefined,
    pointsConversion: IPointsConversion
): Promise<PublicSystem> => {
    const doc = await SystemModel.create({
        businessId: new Types.ObjectId(businessId),
        type: 'points',
        name,
        description,
        pointsConversion,
        isActive: true,
    });
    return toPublic(doc as ISystem);
};

/**
 * Create a new stamps-based system
 */
export const createStampsSystem = async (
    businessId: string,
    name: string,
    description: string | undefined,
    targetStamps: number,
    productType: 'specific' | 'general' | 'any',
    productIdentifier: string | undefined
): Promise<PublicSystem> => {
    const doc = await SystemModel.create({
        businessId: new Types.ObjectId(businessId),
        type: 'stamps',
        name,
        description,
        targetStamps,
        productType,
        productIdentifier,
        isActive: true,
    });
    return toPublic(doc as ISystem);
};

/**
 * Find all systems for a business
 */
export const findSystemsByBusinessId = async (
    businessId: string,
    includeInactive: boolean = false
): Promise<PublicSystem[]> => {
    const query: any = { businessId: new Types.ObjectId(businessId) };
    if (!includeInactive) {
        query.isActive = true;
    }
    
    const docs = await SystemModel.find(query).exec();
    return docs.map((doc) => toPublic(doc as ISystem));
};

/**
 * Find a system by ID and business ID
 */
export const findSystemByIdAndBusinessId = async (
    systemId: string,
    businessId: string
): Promise<PublicSystem | undefined> => {
    const doc = await SystemModel.findOne({
        _id: new Types.ObjectId(systemId),
        businessId: new Types.ObjectId(businessId),
    }).exec();
    return doc ? toPublic(doc as ISystem) : undefined;
};

/**
 * Find a system by ID (without business validation)
 */
export const findSystemById = async (systemId: string): Promise<PublicSystem | undefined> => {
    const doc = await SystemModel.findById(systemId).exec();
    return doc ? toPublic(doc as ISystem) : undefined;
};

/**
 * Update a points system
 */
export const updatePointsSystem = async (
    systemId: string,
    businessId: string,
    updates: {
        name?: string;
        description?: string;
        isActive?: boolean;
        pointsConversion?: IPointsConversion;
    }
): Promise<PublicSystem | undefined> => {
    const doc = await SystemModel.findOneAndUpdate(
        {
            _id: new Types.ObjectId(systemId),
            businessId: new Types.ObjectId(businessId),
            type: 'points',
        },
        { $set: updates },
        { new: true, runValidators: true }
    ).exec();
    
    return doc ? toPublic(doc as ISystem) : undefined;
};

/**
 * Update a stamps system
 */
export const updateStampsSystem = async (
    systemId: string,
    businessId: string,
    updates: {
        name?: string;
        description?: string;
        isActive?: boolean;
        targetStamps?: number;
        productType?: 'specific' | 'general' | 'any';
        productIdentifier?: string;
    }
): Promise<PublicSystem | undefined> => {
    const doc = await SystemModel.findOneAndUpdate(
        {
            _id: new Types.ObjectId(systemId),
            businessId: new Types.ObjectId(businessId),
            type: 'stamps',
        },
        { $set: updates },
        { new: true, runValidators: true }
    ).exec();
    
    return doc ? toPublic(doc as ISystem) : undefined;
};

/**
 * Delete a system (soft delete by setting isActive to false, or hard delete)
 */
export const deleteSystem = async (
    systemId: string,
    businessId: string,
    hardDelete: boolean = false
): Promise<boolean> => {
    if (hardDelete) {
        const result = await SystemModel.deleteOne({
            _id: new Types.ObjectId(systemId),
            businessId: new Types.ObjectId(businessId),
        }).exec();
        return result.deletedCount > 0;
    } else {
        const doc = await SystemModel.findOneAndUpdate(
            {
                _id: new Types.ObjectId(systemId),
                businessId: new Types.ObjectId(businessId),
            },
            { $set: { isActive: false } },
            { new: true }
        ).exec();
        return !!doc;
    }
};
