/**
 * Report controllers
 * 
 * Handles HTTP requests for report generation.
 */

import { Request, Response } from 'express';
import * as reportService from '../services/report.service';
import * as pdfService from '../services/pdf.service';

/**
 * Generate PDF report for a business
 * POST /business/reports/generate
 * 
 * Body: {
 *   startDate: string (ISO date),
 *   endDate: string (ISO date),
 *   shiftIds?: string[] (optional)
 * }
 * 
 * Returns: PDF file
 */
export async function generateReport(req: Request, res: Response) {
    try {
        const businessId = (req as any).user?.id || (req as any).business?.id;

        if (!businessId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const { startDate, endDate, shiftIds, types } = req.body;

        // Validate required fields
        if (!startDate || !endDate) {
            return res.status(400).json({
                message: 'Missing required fields: startDate, endDate',
            });
        }

        // Parse dates (support YYYY-MM-DD as local date)
        const parseInputDate = (value: string): Date => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                const [y, m, d] = value.split('-').map(Number);
                return new Date(y, m - 1, d);
            }
            return new Date(value);
        };

        const start = parseInputDate(startDate);
        const end = parseInputDate(endDate);

        // Validate dates
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                message: 'Invalid date format. Use ISO date format (YYYY-MM-DD)',
            });
        }

        if (start > end) {
            return res.status(400).json({
                message: 'startDate must be before or equal to endDate',
            });
        }

        // Check date range (max 90 days)
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 90) {
            return res.status(400).json({
                message: 'Date range cannot exceed 90 days',
            });
        }

        console.log(`[generateReport] Generating report for business ${businessId}`);
        console.log(`[generateReport] Date range: ${startDate} to ${endDate}`);
        console.log(`[generateReport] Shift filter:`, shiftIds || 'All shifts');

        // Set end date to end of day
        end.setHours(23, 59, 59, 999);

        // Generate report data
        const reportData = await reportService.generateReportData({
            businessId,
            startDate: start,
            endDate: end,
            shiftIds,
            types,
        });

        console.log(`[generateReport] Report data generated: ${reportData.summary.totalTransactions} transactions`);

        // Generate PDF
        const pdfBuffer = await pdfService.generateReportPDF(reportData);

        console.log(`[generateReport] PDF generated: ${pdfBuffer.length} bytes`);

        // Set response headers for PDF download
        const filename = `reporte_${startDate}_${endDate}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        // Send PDF
        return res.send(pdfBuffer);
    } catch (err: any) {
        console.error('[generateReport] Error:', err);
        console.error('[generateReport] Error stack:', err.stack);
        return res.status(500).json({
            message: 'Failed to generate report',
            error: err.message,
        });
    }
}

/**
 * Get report preview data (without generating PDF)
 * POST /business/reports/preview
 * 
 * Body: {
 *   startDate: string (ISO date),
 *   endDate: string (ISO date),
 *   shiftIds?: string[] (optional)
 * }
 * 
 * Returns: JSON with report data
 */
export async function getReportPreview(req: Request, res: Response) {
    try {
        const businessId = (req as any).user?.id || (req as any).business?.id;

        if (!businessId) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const { startDate, endDate, shiftIds, types } = req.body;

        // Validate required fields
        if (!startDate || !endDate) {
            return res.status(400).json({
                message: 'Missing required fields: startDate, endDate',
            });
        }

        // Parse dates (support YYYY-MM-DD as local date)
        const parseInputDate = (value: string): Date => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                const [y, m, d] = value.split('-').map(Number);
                return new Date(y, m - 1, d);
            }
            return new Date(value);
        };

        const start = parseInputDate(startDate);
        const end = parseInputDate(endDate);

        // Validate dates
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                message: 'Invalid date format. Use ISO date format (YYYY-MM-DD)',
            });
        }

        if (start > end) {
            return res.status(400).json({
                message: 'startDate must be before or equal to endDate',
            });
        }

        // Set end date to end of day
        end.setHours(23, 59, 59, 999);

        // Generate report data
        const reportData = await reportService.generateReportData({
            businessId,
            startDate: start,
            endDate: end,
            shiftIds,
            types,
        });

        // Return report data as JSON
        return res.json(reportData);
    } catch (err: any) {
        console.error('[getReportPreview] Error:', err);
        return res.status(500).json({
            message: 'Failed to generate report preview',
            error: err.message,
        });
    }
}
