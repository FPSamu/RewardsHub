/**
 * Geocoding service using Nominatim (OpenStreetMap)
 * 
 * This service provides geocoding functionality using the open-source Nominatim API
 * from OpenStreetMap. It converts addresses into geographic coordinates (latitude/longitude).
 */
import axios from 'axios';

/**
 * Geocoding result interface
 */
export interface GeocodingResult {
    latitude: number;
    longitude: number;
    displayName: string;
    formattedAddress: string;
}

/**
 * Parse address string in format: "calle-numero-ciudad-estado-pais"
 * Example: "Av Revolución-123-Guadalajara-Jalisco-México"
 */
const parseAddressString = (addressString: string): {
    street: string;
    number: string;
    city: string;
    state: string;
    country: string;
} => {
    const parts = addressString.split('-').map(part => part.trim());
    
    if (parts.length < 5) {
        throw new Error('Address format must be: calle-numero-ciudad-estado-pais');
    }

    return {
        street: parts[0],
        number: parts[1],
        city: parts[2],
        state: parts[3],
        country: parts[4],
    };
};

/**
 * Nominatim API response interface
 */
interface NominatimResult {
    lat: string;
    lon: string;
    display_name: string;
    address?: any;
    importance?: number;
    class?: string;
    type?: string;
}

/**
 * Try geocoding with a specific query format
 */
const tryGeocode = async (query: string): Promise<NominatimResult[]> => {
    const nominatimUrl = 'https://nominatim.openstreetmap.org/search';
    
    const response = await axios.get<NominatimResult[]>(nominatimUrl, {
        params: {
            q: query,
            format: 'json',
            limit: 5, // Get multiple results to find the best match
            addressdetails: 1,
        },
        headers: {
            'User-Agent': 'RewardsHub/1.0 (Business Location Service)',
        },
        timeout: 5000,
    });

    return response.data || [];
};

/**
 * Geocode an address using Nominatim API (OpenStreetMap)
 * 
 * @param addressString - Address in format "calle-numero-ciudad-estado-pais"
 * @returns Geocoding result with latitude, longitude, and formatted address
 * 
 * @example
 * const result = await geocodeAddress("Av Revolución-123-Guadalajara-Jalisco-México");
 * // Returns: { latitude: 20.6597, longitude: -103.3496, ... }
 */
export const geocodeAddress = async (addressString: string): Promise<GeocodingResult> => {
    try {
        // Parse the address string
        const { street, number, city, state, country } = parseAddressString(addressString);
        
        let results: NominatimResult[] = [];

        // Strategy 1: Try with structured address (most precise)
        try {
            const structuredResponse = await axios.get<NominatimResult[]>(
                'https://nominatim.openstreetmap.org/search',
                {
                    params: {
                        street: `${number} ${street}`,
                        city: city,
                        state: state,
                        country: country,
                        format: 'json',
                        limit: 5,
                        addressdetails: 1,
                    },
                    headers: {
                        'User-Agent': 'RewardsHub/1.0 (Business Location Service)',
                    },
                    timeout: 5000,
                }
            );
            if (structuredResponse.data && structuredResponse.data.length > 0) {
                results = structuredResponse.data;
            }
        } catch (err) {
            // Continue to next strategy
        }

        // Strategy 2: Try with full address in one query
        if (results.length === 0) {
            const query1 = `${number} ${street}, ${city}, ${state}, ${country}`;
            results = await tryGeocode(query1);
        }

        // Strategy 3: Try with number at the end
        if (results.length === 0) {
            const query2 = `${street} ${number}, ${city}, ${state}, ${country}`;
            results = await tryGeocode(query2);
        }

        // Strategy 4: Try without number (fallback)
        if (results.length === 0) {
            const query3 = `${street}, ${city}, ${state}, ${country}`;
            results = await tryGeocode(query3);
        }

        if (results.length === 0) {
            throw new Error('Address not found. Please verify the address format and try again.');
        }

        // Find the best result
        // Priority: exact house number match > building/amenity > street > other
        let bestResult = results[0];
        
        for (const result of results) {
            // Prefer results that have house number in address details
            if (result.address?.house_number) {
                bestResult = result;
                break;
            }
            // Prefer buildings or amenities over just streets
            if (result.class === 'building' || result.class === 'amenity') {
                bestResult = result;
            }
        }

        return {
            latitude: parseFloat(bestResult.lat),
            longitude: parseFloat(bestResult.lon),
            displayName: bestResult.display_name,
            formattedAddress: `${number} ${street}, ${city}, ${state}, ${country}`,
        };
    } catch (error: any) {
        if (error.message && error.message.includes('Address format must be')) {
            throw error;
        }
        if (error.message && error.message.includes('Address not found')) {
            throw error;
        }
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            throw new Error('Geocoding service timeout. Please try again.');
        }
        if (error.response?.status === 429) {
            throw new Error('Too many requests to geocoding service. Please wait a moment and try again.');
        }
        throw new Error('Failed to geocode address. Please check the address format.');
    }
};

/**
 * Validate address string format
 * @param addressString - Address string to validate
 * @returns true if valid, false otherwise
 */
export const validateAddressFormat = (addressString: string): boolean => {
    if (!addressString || typeof addressString !== 'string') {
        return false;
    }
    
    const parts = addressString.split('-');
    return parts.length >= 5 && parts.every(part => part.trim().length > 0);
};
