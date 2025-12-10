/**
 * Lightweight user DTO used by some parts of the codebase before persisting
 * to the database. Fields:
 * - id: string identifier
 * - username: display name
 * - email: user email
 * - passHash: bcrypt hashed password
 * - createdAt: ISO timestamp string
 */
export interface User {
    id: string;
    username: string;
    email: string;
    passHash: string;
    profilePicture?: string;
    isVerified: boolean;
    createdAt: string;
}
