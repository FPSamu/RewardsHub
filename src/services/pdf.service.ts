/**
 * PDF service
 * 
 * This module handles PDF generation for business reports.
 * Uses PDFKit to create professional-looking reports with tables and summaries.
 */

import { ReportData, DailyReport, ShiftSummary } from './report.service';
import axios from 'axios';

// Import PDFKit using require (works better with TypeScript)
const PDFDocument = require('pdfkit');

/**
 * Generate a PDF report from report data
 * 
 * @param reportData - Complete report data structure
 * @returns PDF document as Buffer
 */
export async function generateReportPDF(reportData: ReportData): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
        try {
            // Download logo if available
            let logoBuffer: Buffer | null = null;
            if (reportData.metadata.logoUrl) {
                try {
                    const response = await axios.get(reportData.metadata.logoUrl, {
                        responseType: 'arraybuffer',
                        timeout: 5000, // 5 second timeout
                    });
                    logoBuffer = Buffer.from(response.data as ArrayBuffer);
                    console.log('[generateReportPDF] Logo downloaded successfully');
                } catch (err) {
                    console.error('[generateReportPDF] Error downloading logo:', err);
                    // Continue without logo
                }
            }

            // Create PDF document
            const doc = new PDFDocument({
                size: 'LETTER',
                margins: {
                    top: 50,
                    bottom: 50,
                    left: 50,
                    right: 50,
                },
            });

            // Collect PDF data in chunks
            const chunks: Buffer[] = [];
            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Generate PDF content
            generatePDFContent(doc, reportData, logoBuffer);

            // Finalize PDF
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Generate the content of the PDF
 */
function generatePDFContent(
    doc: PDFKit.PDFDocument,
    reportData: ReportData,
    logoBuffer: Buffer | null
): void {
    const { metadata, summary, dailyData, periodSummary } = reportData;

    // Header
    addHeader(doc, metadata, logoBuffer);

    // Summary section
    addSummarySection(doc, summary, metadata.reportPeriod);

    // Period summary (totals by shift and system)
    addPeriodSummary(doc, periodSummary);

    // Daily data (detailed breakdown)
    addDailyData(doc, dailyData);

    // Footer
    addFooter(doc, metadata.generatedAt);
}

/**
 * Add header with business name and report title
 */
function addHeader(
    doc: PDFKit.PDFDocument,
    metadata: ReportData['metadata'],
    logoBuffer: Buffer | null
): void {
    // Add logo if available
    if (logoBuffer) {
        try {
            const logoWidth = 80;
            const logoHeight = 80;
            const logoX = (doc.page.width - logoWidth) / 2; // Center horizontally

            doc.image(logoBuffer, logoX, doc.y, {
                fit: [logoWidth, logoHeight],
                align: 'center',
            });

            doc.moveDown(5); // Space after logo
        } catch (err) {
            console.error('[addHeader] Error adding logo to PDF:', err);
            // Continue without logo
        }
    }

    // Business name
    doc.fontSize(20)
        .font('Helvetica-Bold')
        .text(metadata.businessName, { align: 'center' });

    doc.moveDown(0.5);

    // Report title
    doc.fontSize(16)
        .font('Helvetica')
        .text('Reporte de Transacciones por Turnos', { align: 'center' });

    doc.moveDown(0.3);

    // Date range
    const startDate = formatDate(metadata.reportPeriod.startDate);
    const endDate = formatDate(metadata.reportPeriod.endDate);
    doc.fontSize(12)
        .font('Helvetica')
        .fillColor('#666666')
        .text(`Período: ${startDate} - ${endDate}`, { align: 'center' });

    doc.fillColor('#000000');
    doc.moveDown(1.5);

    // Horizontal line
    doc.strokeColor('#CCCCCC')
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(562, doc.y)
        .stroke();

    doc.moveDown(1);
}

/**
 * Add summary section with key metrics
 */
function addSummarySection(
    doc: PDFKit.PDFDocument,
    summary: ReportData['summary'],
    period: { startDate: Date; endDate: Date }
): void {
    doc.fontSize(14)
        .font('Helvetica-Bold')
        .text('Resumen General', { underline: true });

    doc.moveDown(0.5);

    const summaryData = [
        { label: 'Total de Transacciones:', value: summary.totalTransactions.toString() },
        { label: 'Total de Puntos Otorgados:', value: summary.totalPoints.toString() },
        { label: 'Total de Sellos Otorgados:', value: summary.totalStamps.toString() },
        { label: 'Días con Actividad:', value: summary.totalDays.toString() },
    ];

    doc.fontSize(11).font('Helvetica');

    for (const item of summaryData) {
        doc.text(item.label, 50, doc.y, { continued: true, width: 200 })
            .font('Helvetica-Bold')
            .text(item.value, { align: 'right' });
        doc.font('Helvetica');
        doc.moveDown(0.3);
    }

    doc.moveDown(1);
}

/**
 * Add period summary (totals by shift and system)
 */
function addPeriodSummary(doc: PDFKit.PDFDocument, periodSummary: ReportData['periodSummary']): void {
    // Check if we need a new page
    if (doc.y > 650) {
        doc.addPage();
    }

    doc.fontSize(14)
        .font('Helvetica-Bold')
        .text('Resumen por Turno', { underline: true });

    doc.moveDown(0.5);

    // Table header
    const tableTop = doc.y;
    const colWidths = { shift: 150, transactions: 100, points: 100, stamps: 100 };
    const startX = 50;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Turno', startX, tableTop, { width: colWidths.shift });
    doc.text('Transacciones', startX + colWidths.shift, tableTop, { width: colWidths.transactions, align: 'center' });
    doc.text('Puntos', startX + colWidths.shift + colWidths.transactions, tableTop, { width: colWidths.points, align: 'center' });
    doc.text('Sellos', startX + colWidths.shift + colWidths.transactions + colWidths.points, tableTop, { width: colWidths.stamps, align: 'center' });

    doc.moveDown(0.5);

    // Draw line under header
    doc.strokeColor('#CCCCCC')
        .lineWidth(0.5)
        .moveTo(startX, doc.y)
        .lineTo(startX + colWidths.shift + colWidths.transactions + colWidths.points + colWidths.stamps, doc.y)
        .stroke();

    doc.moveDown(0.3);

    // Table rows
    doc.font('Helvetica').fontSize(10);

    for (const shift of periodSummary.totalsByShift) {
        const rowY = doc.y;

        doc.text(shift.shiftName, startX, rowY, { width: colWidths.shift });
        doc.text(shift.transactions.toString(), startX + colWidths.shift, rowY, { width: colWidths.transactions, align: 'center' });
        doc.text(shift.points.toString(), startX + colWidths.shift + colWidths.transactions, rowY, { width: colWidths.points, align: 'center' });
        doc.text(shift.stamps.toString(), startX + colWidths.shift + colWidths.transactions + colWidths.points, rowY, { width: colWidths.stamps, align: 'center' });

        doc.moveDown(0.5);
    }

    doc.moveDown(1);

    // Systems summary
    if (doc.y > 650) {
        doc.addPage();
    }

    doc.fontSize(14)
        .font('Helvetica-Bold')
        .text('Resumen por Sistema de Recompensas', { underline: true });

    doc.moveDown(0.5);

    // Table header
    const systemTableTop = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Sistema', startX, systemTableTop, { width: colWidths.shift });
    doc.text('Transacciones', startX + colWidths.shift, systemTableTop, { width: colWidths.transactions, align: 'center' });
    doc.text('Puntos', startX + colWidths.shift + colWidths.transactions, systemTableTop, { width: colWidths.points, align: 'center' });
    doc.text('Sellos', startX + colWidths.shift + colWidths.transactions + colWidths.points, systemTableTop, { width: colWidths.stamps, align: 'center' });

    doc.moveDown(0.5);

    // Draw line
    doc.strokeColor('#CCCCCC')
        .lineWidth(0.5)
        .moveTo(startX, doc.y)
        .lineTo(startX + colWidths.shift + colWidths.transactions + colWidths.points + colWidths.stamps, doc.y)
        .stroke();

    doc.moveDown(0.3);

    // Table rows
    doc.font('Helvetica').fontSize(10);

    for (const system of periodSummary.totalsBySystem) {
        const rowY = doc.y;

        doc.text(system.systemName, startX, rowY, { width: colWidths.shift });
        doc.text(system.transactions.toString(), startX + colWidths.shift, rowY, { width: colWidths.transactions, align: 'center' });
        doc.text(system.points.toString(), startX + colWidths.shift + colWidths.transactions, rowY, { width: colWidths.points, align: 'center' });
        doc.text(system.stamps.toString(), startX + colWidths.shift + colWidths.transactions + colWidths.points, rowY, { width: colWidths.stamps, align: 'center' });

        doc.moveDown(0.5);
    }

    doc.moveDown(1.5);
}

/**
 * Add daily data with breakdown by shift
 */
function addDailyData(doc: PDFKit.PDFDocument, dailyData: DailyReport[]): void {
    // New page for daily details
    doc.addPage();

    doc.fontSize(16)
        .font('Helvetica-Bold')
        .text('Detalle por Día y Turno', { underline: true });

    doc.moveDown(1);

    for (const day of dailyData) {
        // Check if we need a new page
        if (doc.y > 700) {
            doc.addPage();
        }

        // Day header
        doc.fontSize(13)
            .font('Helvetica-Bold')
            .fillColor('#2563EB')
            .text(`${formatDate(day.date)} - ${capitalizeFirst(day.dayOfWeek)}`);

        doc.fillColor('#000000');
        doc.moveDown(0.3);

        // Day summary
        doc.fontSize(10)
            .font('Helvetica')
            .text(
                `Total del día: ${day.dailyTotal.transactions} transacciones | ` +
                `${day.dailyTotal.points} puntos | ${day.dailyTotal.stamps} sellos`
            );

        doc.moveDown(0.5);

        // Shifts for this day
        for (const shift of day.shifts) {
            addShiftDetail(doc, shift);
        }

        doc.moveDown(1);

        // Separator line
        doc.strokeColor('#EEEEEE')
            .lineWidth(1)
            .moveTo(50, doc.y)
            .lineTo(562, doc.y)
            .stroke();

        doc.moveDown(1);
    }
}

/**
 * Add shift detail section
 */
function addShiftDetail(doc: PDFKit.PDFDocument, shift: ShiftSummary): void {
    // Check if we need a new page
    if (doc.y > 680) {
        doc.addPage();
    }

    // Shift header with color indicator
    const shiftY = doc.y;

    // Color box
    doc.fillColor(shift.shiftColor)
        .rect(50, shiftY, 10, 10)
        .fill();

    doc.fillColor('#000000');

    // Shift name and time
    doc.fontSize(11)
        .font('Helvetica-Bold')
        .text(`${shift.shiftName} (${shift.shiftTime})`, 65, shiftY);

    doc.moveDown(0.5);

    // Shift summary
    doc.fontSize(9)
        .font('Helvetica')
        .text(
            `${shift.totalTransactions} transacciones | ` +
            `${shift.totalPoints} puntos | ${shift.totalStamps} sellos`,
            65
        );

    doc.moveDown(0.5);

    // System breakdown for this shift
    if (shift.systemBreakdown.length > 0) {
        doc.fontSize(9).font('Helvetica-Oblique').fillColor('#666666');
        for (const system of shift.systemBreakdown) {
            const systemText = `  • ${system.systemName}: ${system.transactions} transacciones`;
            const details = system.systemType === 'points'
                ? ` (${system.points} puntos)`
                : ` (${system.stamps} sellos)`;
            doc.text(systemText + details, 65);
        }
        doc.fillColor('#000000');
    }

    doc.moveDown(0.8);
}

/**
 * Add footer with generation date
 * Note: This should be called BEFORE finalizing the document
 */
function addFooter(doc: PDFKit.PDFDocument, generatedAt: Date): void {
    // Get current page count
    const range = doc.bufferedPageRange();
    const pageCount = range.count;

    // Add footer to each page
    for (let pageNum = range.start; pageNum < range.start + pageCount; pageNum++) {
        try {
            doc.switchToPage(pageNum);

            // Footer text
            doc.fontSize(8)
                .font('Helvetica')
                .fillColor('#999999')
                .text(
                    `Generado el ${formatDateTime(generatedAt)} | Página ${pageNum - range.start + 1} de ${pageCount}`,
                    50,
                    doc.page.height - 50,
                    { align: 'center', width: doc.page.width - 100 }
                );
        } catch (err) {
            console.error(`[addFooter] Error adding footer to page ${pageNum}:`, err);
        }
    }

    doc.fillColor('#000000');
}

/**
 * Format date as DD/MM/YYYY
 */
function formatDate(date: Date): string {
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Format date and time
 */
function formatDateTime(date: Date): string {
    const d = new Date(date);
    const dateStr = formatDate(d);
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${dateStr} ${hours}:${minutes}`;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
