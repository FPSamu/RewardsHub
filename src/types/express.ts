import { User } from '../models/user';

/**
 * Business DTO interface (matches the structure returned by business service)
 */
export interface Business {
    id: string;
    name: string;
    email: string;
    passHash: string;
    createdAt: string;
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
