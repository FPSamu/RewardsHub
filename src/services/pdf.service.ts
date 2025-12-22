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

// Color palette for professional design
const COLORS = {
    primary: '#1E40AF',      // Deep blue
    secondary: '#3B82F6',    // Lighter blue
    accent: '#10B981',       // Green for positive metrics
    text: '#1F2937',         // Dark gray for text
    textLight: '#6B7280',    // Light gray for secondary text
    border: '#E5E7EB',       // Light border
    background: '#F9FAFB',   // Very light gray background
    white: '#FFFFFF',
};

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
                        timeout: 5000,
                    });
                    logoBuffer = Buffer.from(response.data as ArrayBuffer);
                    console.log('[generateReportPDF] Logo downloaded successfully');
                } catch (err) {
                    console.error('[generateReportPDF] Error downloading logo:', err);
                }
            }

            // Create PDF document
            const doc = new PDFDocument({
                size: 'LETTER',
                margins: {
                    top: 50,
                    bottom: 60,
                    left: 50,
                    right: 50,
                },
                bufferPages: true, // Enable page buffering for footer
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

    // Header with logo and title
    addHeader(doc, metadata, logoBuffer);

    // Executive summary box
    addExecutiveSummary(doc, summary, metadata.reportPeriod);

    // Period summary tables
    addPeriodSummaryTables(doc, periodSummary);

    // Daily breakdown
    if (dailyData.length > 0) {
        addDailyBreakdown(doc, dailyData);
    }

    // Footer on all pages
    addFooter(doc, metadata.generatedAt);
}

/**
 * Add professional header with logo
 */
function addHeader(
    doc: PDFKit.PDFDocument,
    metadata: ReportData['metadata'],
    logoBuffer: Buffer | null
): void {
    const pageWidth = doc.page.width;
    const startY = doc.y;

    // Background header bar
    doc.rect(0, 0, pageWidth, 140)
        .fill(COLORS.primary);

    doc.y = startY + 20;

    // Add logo if available
    if (logoBuffer) {
        try {
            const logoSize = 60;
            const logoX = 50;

            doc.image(logoBuffer, logoX, doc.y, {
                fit: [logoSize, logoSize],
            });
        } catch (err) {
            console.error('[addHeader] Error adding logo:', err);
        }
    }

    // Business name and title (white text on blue background)
    const textX = logoBuffer ? 130 : 50;
    doc.fillColor(COLORS.white)
        .fontSize(22)
        .font('Helvetica-Bold')
        .text(metadata.businessName, textX, startY + 25, { width: 400 });

    doc.fontSize(14)
        .font('Helvetica')
        .fillColor('#E0E7FF')
        .text('Reporte de Auditoría de Transacciones', textX, doc.y + 5);

    // Date range in a box
    const startDate = formatDate(metadata.reportPeriod.startDate);
    const endDate = formatDate(metadata.reportPeriod.endDate);

    doc.fontSize(11)
        .fillColor(COLORS.white)
        .text(`Período: ${startDate} - ${endDate}`, textX, doc.y + 8);

    // Reset position after header
    doc.y = 160;
    doc.fillColor(COLORS.text);
}

/**
 * Add executive summary in a highlighted box
 */
function addExecutiveSummary(
    doc: PDFKit.PDFDocument,
    summary: ReportData['summary'],
    period: { startDate: Date; endDate: Date }
): void {
    const boxX = 50;
    const boxY = doc.y;
    const boxWidth = doc.page.width - 100;
    const boxHeight = 120;

    // Background box with subtle shadow effect
    doc.rect(boxX + 2, boxY + 2, boxWidth, boxHeight)
        .fill('#00000010');

    doc.rect(boxX, boxY, boxWidth, boxHeight)
        .fill(COLORS.background)
        .stroke(COLORS.border);

    doc.y = boxY + 15;

    // Title
    doc.fontSize(14)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primary)
        .text('RESUMEN EJECUTIVO', boxX + 20, doc.y);

    doc.moveDown(0.8);

    // Metrics in a grid layout
    const metrics = [
        { label: 'Total de Transacciones', value: summary.totalTransactions.toLocaleString() },
        { label: 'Puntos Otorgados', value: summary.totalPoints.toLocaleString() },
        { label: 'Sellos Otorgados', value: summary.totalStamps.toLocaleString() },
        { label: 'Días con Actividad', value: summary.totalDays.toString() },
    ];

    const metricsY = doc.y;
    const colWidth = (boxWidth - 40) / 2;

    metrics.forEach((metric, index) => {
        const col = index % 2;
        const row = Math.floor(index / 2);
        const x = boxX + 20 + (col * colWidth);
        const y = metricsY + (row * 35);

        doc.fontSize(9)
            .font('Helvetica')
            .fillColor(COLORS.textLight)
            .text(metric.label, x, y);

        doc.fontSize(18)
            .font('Helvetica-Bold')
            .fillColor(COLORS.primary)
            .text(metric.value, x, y + 12);
    });

    doc.y = boxY + boxHeight + 25;
    doc.fillColor(COLORS.text);
}

/**
 * Add period summary tables with professional styling
 */
function addPeriodSummaryTables(
    doc: PDFKit.PDFDocument,
    periodSummary: ReportData['periodSummary']
): void {
    // Check if we need a new page
    if (doc.y > 600) {
        doc.addPage();
    }

    // Section title
    addSectionTitle(doc, 'ANÁLISIS POR TURNO DE TRABAJO');

    // Table
    drawProfessionalTable(doc, {
        headers: ['Turno', 'Transacciones', 'Puntos', 'Sellos'],
        rows: periodSummary.totalsByShift.map(shift => [
            shift.shiftName,
            shift.transactions.toLocaleString(),
            shift.points.toLocaleString(),
            shift.stamps.toLocaleString(),
        ]),
        columnWidths: [200, 120, 120, 120],
    });

    doc.moveDown(2);

    // Systems summary
    if (doc.y > 600) {
        doc.addPage();
    }

    addSectionTitle(doc, 'ANÁLISIS POR SISTEMA DE RECOMPENSAS');

    drawProfessionalTable(doc, {
        headers: ['Sistema', 'Transacciones', 'Puntos', 'Sellos'],
        rows: periodSummary.totalsBySystem.map(system => [
            system.systemName,
            system.transactions.toLocaleString(),
            system.points.toLocaleString(),
            system.stamps.toLocaleString(),
        ]),
        columnWidths: [200, 120, 120, 120],
    });

    doc.moveDown(2);
}

/**
 * Add daily breakdown section
 */
function addDailyBreakdown(doc: PDFKit.PDFDocument, dailyData: DailyReport[]): void {
    // New page for daily details
    doc.addPage();

    addSectionTitle(doc, 'DETALLE DIARIO DE TRANSACCIONES');
    doc.moveDown(1);

    for (const day of dailyData) {
        // Check if we need a new page
        if (doc.y > 680) {
            doc.addPage();
        }

        // Day header with background
        const dayHeaderY = doc.y;
        const dayHeaderHeight = 35;

        doc.rect(50, dayHeaderY, doc.page.width - 100, dayHeaderHeight)
            .fill(COLORS.secondary)
            .stroke(COLORS.border);

        doc.fontSize(12)
            .font('Helvetica-Bold')
            .fillColor(COLORS.white)
            .text(
                `${formatDate(day.date)} - ${capitalizeFirst(day.dayOfWeek)}`,
                60,
                dayHeaderY + 10
            );

        // Day totals on the right
        doc.fontSize(10)
            .font('Helvetica')
            .text(
                `${day.dailyTotal.transactions} transacciones | ${day.dailyTotal.points} pts | ${day.dailyTotal.stamps} sellos`,
                doc.page.width - 350,
                dayHeaderY + 12,
                { width: 280, align: 'right' }
            );

        doc.y = dayHeaderY + dayHeaderHeight + 10;
        doc.fillColor(COLORS.text);

        // Shifts for this day
        for (const shift of day.shifts) {
            addShiftDetailBox(doc, shift);
        }

        doc.moveDown(1.5);
    }
}

/**
 * Add shift detail in a styled box
 */
function addShiftDetailBox(doc: PDFKit.PDFDocument, shift: ShiftSummary): void {
    if (doc.y > 700) {
        doc.addPage();
    }

    const boxX = 70;
    const boxWidth = doc.page.width - 140;
    const startY = doc.y;

    // Shift header with color indicator
    const headerHeight = 25;

    // Color indicator bar
    doc.rect(boxX, startY, 5, headerHeight)
        .fill(shift.shiftColor);

    // Shift name and time
    doc.fontSize(11)
        .font('Helvetica-Bold')
        .fillColor(COLORS.text)
        .text(`${shift.shiftName}`, boxX + 15, startY + 5);

    doc.fontSize(9)
        .font('Helvetica')
        .fillColor(COLORS.textLight)
        .text(shift.shiftTime, boxX + 15, startY + 18);

    // Shift metrics on the right
    doc.fontSize(9)
        .fillColor(COLORS.textLight)
        .text(
            `${shift.totalTransactions} trans. | ${shift.totalPoints} pts | ${shift.totalStamps} sellos`,
            doc.page.width - 250,
            startY + 8,
            { width: 180, align: 'right' }
        );

    doc.y = startY + headerHeight + 5;

    // System breakdown
    if (shift.systemBreakdown.length > 0) {
        shift.systemBreakdown.forEach(system => {
            doc.fontSize(8)
                .font('Helvetica')
                .fillColor(COLORS.textLight)
                .text(
                    `  • ${system.systemName}: ${system.transactions} transacciones ` +
                    `(${system.systemType === 'points' ? system.points + ' pts' : system.stamps + ' sellos'})`,
                    boxX + 15,
                    doc.y
                );
            doc.moveDown(0.3);
        });
    }

    // Bottom border
    doc.strokeColor(COLORS.border)
        .lineWidth(0.5)
        .moveTo(boxX, doc.y + 5)
        .lineTo(boxX + boxWidth, doc.y + 5)
        .stroke();

    doc.moveDown(0.8);
    doc.fillColor(COLORS.text);
}

/**
 * Add section title with underline
 */
function addSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    doc.fontSize(13)
        .font('Helvetica-Bold')
        .fillColor(COLORS.primary)
        .text(title, 50, doc.y);

    const titleWidth = doc.widthOfString(title);
    const lineY = doc.y + 2;

    doc.strokeColor(COLORS.primary)
        .lineWidth(2)
        .moveTo(50, lineY)
        .lineTo(50 + titleWidth, lineY)
        .stroke();

    doc.moveDown(1);
    doc.fillColor(COLORS.text);
}

/**
 * Draw a professional table with borders and shading
 */
function drawProfessionalTable(
    doc: PDFKit.PDFDocument,
    config: {
        headers: string[];
        rows: string[][];
        columnWidths: number[];
    }
): void {
    const startX = 50;
    const startY = doc.y;
    const rowHeight = 25;
    const headerHeight = 30;

    // Calculate total width
    const totalWidth = config.columnWidths.reduce((a, b) => a + b, 0);

    // Draw header background
    doc.rect(startX, startY, totalWidth, headerHeight)
        .fill(COLORS.primary);

    // Draw header text
    doc.fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(COLORS.white);

    let currentX = startX;
    config.headers.forEach((header, i) => {
        doc.text(
            header,
            currentX + 10,
            startY + 10,
            { width: config.columnWidths[i] - 20, align: 'left' }
        );
        currentX += config.columnWidths[i];
    });

    // Draw rows
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.text);
    let currentY = startY + headerHeight;

    config.rows.forEach((row, rowIndex) => {
        // Alternate row background
        if (rowIndex % 2 === 0) {
            doc.rect(startX, currentY, totalWidth, rowHeight)
                .fill(COLORS.background);
        }

        currentX = startX;
        row.forEach((cell, colIndex) => {
            const isNumeric = colIndex > 0; // First column is text, rest are numbers
            doc.fillColor(COLORS.text)
                .text(
                    cell,
                    currentX + 10,
                    currentY + 8,
                    {
                        width: config.columnWidths[colIndex] - 20,
                        align: isNumeric ? 'right' : 'left'
                    }
                );
            currentX += config.columnWidths[colIndex];
        });

        currentY += rowHeight;
    });

    // Draw table borders
    doc.strokeColor(COLORS.border).lineWidth(0.5);

    // Vertical lines
    currentX = startX;
    config.columnWidths.forEach((width, i) => {
        if (i > 0) {
            doc.moveTo(currentX, startY)
                .lineTo(currentX, currentY)
                .stroke();
        }
        currentX += width;
    });

    // Horizontal lines
    doc.rect(startX, startY, totalWidth, currentY - startY)
        .stroke();

    doc.y = currentY + 5;
}

/**
 * Add footer with generation info
 */
function addFooter(doc: PDFKit.PDFDocument, generatedAt: Date): void {
    const range = doc.bufferedPageRange();
    const pageCount = range.count;

    for (let pageNum = range.start; pageNum < range.start + pageCount; pageNum++) {
        try {
            doc.switchToPage(pageNum);

            const footerY = doc.page.height - 40;

            // Footer line
            doc.strokeColor(COLORS.border)
                .lineWidth(0.5)
                .moveTo(50, footerY - 10)
                .lineTo(doc.page.width - 50, footerY - 10)
                .stroke();

            // Footer text
            doc.fontSize(8)
                .font('Helvetica')
                .fillColor(COLORS.textLight)
                .text(
                    `Generado el ${formatDateTime(generatedAt)}`,
                    50,
                    footerY,
                    { width: 200, align: 'left' }
                );

            doc.text(
                `Página ${pageNum - range.start + 1} de ${pageCount}`,
                doc.page.width - 150,
                footerY,
                { width: 100, align: 'right' }
            );
        } catch (err) {
            console.error(`[addFooter] Error on page ${pageNum}:`, err);
        }
    }

    doc.fillColor(COLORS.text);
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
    return `${dateStr} a las ${hours}:${minutes}`;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
