import { User } from '../models/user';
import { ILocation } from '../models/business.model';

/**
 * Business DTO interface (matches the structure returned by business service)
 */
export interface Business {
    id: string;
    name: string;
    email: string;
    passHash: string;
    status: 'active' | 'inactive';
    address?: string;
    location?: ILocation;
    createdAt: string;
    logoUrl: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      business?: Business;
    }
  }
}

export {};
