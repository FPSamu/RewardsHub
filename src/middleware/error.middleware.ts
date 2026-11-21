import { ErrorRequestHandler, RequestHandler } from 'express';

/** Cualquier ruta no montada: JSON en vez del HTML por defecto de Express. */
export const notFoundHandler: RequestHandler = (_req, res) => {
    res.status(404).json({ message: 'not found' });
};

/**
 * Último middleware de la app. Respeta err.status / err.statusCode (p. ej. 400
 * de express.json() con un body inválido, 413 por tamaño) y responde JSON.
 * En errores 5xx no se expone el mensaje interno al cliente.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);

    const raw = Number(err?.status ?? err?.statusCode);
    const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;

    if (status >= 500) {
        console.error('❌ [Error]', err);
        return res.status(status).json({ message: 'internal server error' });
    }
    return res.status(status).json({ message: err?.message || 'request error' });
};
