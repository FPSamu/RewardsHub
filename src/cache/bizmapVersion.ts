/**
 * Versión de la caché del mapa (P4.3). Módulo aparte para que business.model
 * lo pueda importar sin dependencia circular con bizmapCache.ts.
 */
import { cacheIncr, isCacheEnabled } from './redis';

export const BIZMAP_VERSION_KEY = 'bizmap:version';

/** Invalida toda la caché del mapa (todas las instancias). Nunca lanza. */
export const bumpBizmapVersion = async (): Promise<void> => {
    if (!isCacheEnabled()) return;
    await cacheIncr(BIZMAP_VERSION_KEY);
};
