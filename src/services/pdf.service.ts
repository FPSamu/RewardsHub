/**
 * PDF service
 *
 * Generates business transaction reports as PDF using PDFKit.
 * Structure:
 *   1. Header (logo + business name + period)
 *   2. KPI summary cards
 *   3. Insights row (best day, busiest shift, unassigned warning)
 *   4. Totals by shift (if shifts configured)
 *   5. Totals by branch (if > 1 branch)
 *   6. Redemptions (only if totalRedemptions > 0)
 *   7. Daily detail table (compact)
 */

import { ReportData, DailyReport, ShiftSummary } from './report.service';
import axios from 'axios';

const PDFDocument = require('pdfkit');

// ─── Colour palette ────────────────────────────────────────────────────────────
const C = {
    primary:    '#1E40AF',
    secondary:  '#3B82F6',
    accent:     '#10B981',
    warning:    '#F59E0B',
    danger:     '#EF4444',
    text:       '#1F2937',
    textLight:  '#6B7280',
    border:     '#E5E7EB',
    bg:         '#F9FAFB',
    white:      '#FFFFFF',
};

const PAGE_W    = 612;  // US Letter
const MARGIN    = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const PAGE_H    = 792;
const FOOTER_H  = 40;
const SAFE_BOTTOM = PAGE_H - FOOTER_H - 20;

// ─── Public entry point ────────────────────────────────────────────────────────
export async function generateReportPDF(reportData: ReportData): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
        try {
            let logoBuffer: Buffer | null = null;
            if (reportData.metadata.logoUrl) {
                try {
                    const res = await axios.get(reportData.metadata.logoUrl, {
                        responseType: 'arraybuffer',
                        timeout: 5000,
                    });
                    logoBuffer = Buffer.from(res.data as ArrayBuffer);
                } catch {
                    // logo fetch failed — continue without it
                }
            }

            const doc = new PDFDocument({
                size: 'LETTER',
                margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN },
                bufferPages: true,
            });

            const chunks: Buffer[] = [];
            doc.on('data', (c: Buffer) => chunks.push(c));
            doc.on('end',  () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            buildDocument(doc, reportData, logoBuffer);

            // doc.end() internally calls flushPages() — do NOT call it manually
            // or pages get finalized twice (producing duplicates).
            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

// ─── Document builder ─────────────────────────────────────────────────────────
function buildDocument(
    doc: PDFKit.PDFDocument,
    data: ReportData,
    logo: Buffer | null,
): void {
    const { metadata, summary, dailyData, periodSummary, branchSummary, redemptionSummary } = data;

    const hasPoints    = summary.totalPoints  !== 0;
    const hasStamps    = summary.totalStamps  !== 0;
    const hasRevenue   = summary.totalRevenue > 0;
    const hasShifts    = periodSummary.totalsByShift.some(s => s.shiftName !== 'Sin turno asignado');
    const multiBranch  = branchSummary.length > 1;
    const hasRedemptions = redemptionSummary.totalRedemptions > 0;

    // 1. Header
    addHeader(doc, metadata, logo);

    // 2. KPI cards
    addKPICards(doc, summary, hasPoints, hasStamps, hasRevenue);

    // 3. Insights row
    addInsights(doc, data, hasShifts);

    // 4. Shift breakdown (only if actual shifts configured)
    if (hasShifts) {
        needSpace(doc, 160);
        addSectionTitle(doc, 'RESUMEN POR TURNO');
        const shiftCols = buildShiftColumns(hasPoints, hasStamps);
        drawTable(doc, {
            headers: shiftCols.headers,
            rows: periodSummary.totalsByShift.map(s => shiftCols.row(s)),
            widths: shiftCols.widths,
        });
        doc.moveDown(1.5);
    }

    // 5. Multi-branch breakdown
    if (multiBranch) {
        needSpace(doc, 120);
        addSectionTitle(doc, 'RESUMEN POR SUCURSAL');
        drawTable(doc, {
            headers: buildBranchHeaders(hasPoints, hasStamps),
            rows: branchSummary.map(b => buildBranchRow(b, hasPoints, hasStamps)),
            widths: buildBranchWidths(hasPoints, hasStamps),
        });
        doc.moveDown(1.5);
    }

    // 6. Redemptions (conditional — no blank page if empty)
    if (hasRedemptions) {
        needSpace(doc, 180);
        addRedemptionSection(doc, redemptionSummary);
    }

    // 7. Daily detail
    if (dailyData.length > 0) {
        needSpace(doc, 120);
        addDailySection(doc, dailyData, hasPoints, hasStamps);
    }

    // Footer on every page
    addFooter(doc, metadata.generatedAt);
}

// ─── 1. Header ────────────────────────────────────────────────────────────────
function addHeader(
    doc: PDFKit.PDFDocument,
    meta: ReportData['metadata'],
    logo: Buffer | null,
): void {
    const headerH = 120;
    doc.rect(0, 0, PAGE_W, headerH).fill(C.primary);

    let textX = MARGIN;

    if (logo) {
        try {
            doc.image(logo, MARGIN, 25, { fit: [55, 55] });
            textX = MARGIN + 70;
        } catch { /* ignore */ }
    }

    doc.fillColor(C.white)
        .fontSize(20).font('Helvetica-Bold')
        .text(meta.businessName, textX, 28, { width: PAGE_W - textX - MARGIN });

    doc.fontSize(12).font('Helvetica').fillColor('#BFDBFE')
        .text('Reporte de Transacciones', textX, doc.y + 4);

    const sd = fmtDate(meta.reportPeriod.startDate);
    const ed = fmtDate(meta.reportPeriod.endDate);
    doc.fontSize(10).fillColor(C.white)
        .text(`Período: ${sd} — ${ed}`, textX, doc.y + 6);

    doc.y = headerH + 20;
    doc.fillColor(C.text);
}

// ─── 2. KPI cards ─────────────────────────────────────────────────────────────
function addKPICards(
    doc: PDFKit.PDFDocument,
    summary: ReportData['summary'],
    hasPoints: boolean,
    hasStamps: boolean,
    hasRevenue: boolean,
): void {
    const cards: Array<{ label: string; value: string; color: string }> = [];

    cards.push({ label: 'Transacciones',     value: fmt(summary.totalTransactions), color: C.primary });
    if (hasRevenue)  cards.push({ label: 'Monto en ventas', value: fmtCurrency(summary.totalRevenue), color: C.accent });
    if (hasPoints)   cards.push({ label: 'Puntos otorgados', value: fmt(summary.totalPoints), color: C.secondary });
    if (hasStamps)   cards.push({ label: 'Sellos otorgados', value: fmt(summary.totalStamps), color: C.secondary });
    cards.push({ label: 'Días con actividad', value: summary.totalDays.toString(), color: C.textLight });
    cards.push({ label: 'Canjes realizados',  value: fmt(summary.unassignedTransactions === summary.totalTransactions ? 0 : summary.totalTransactions), color: C.textLight });

    // Up to 3 per row
    const cols   = Math.min(cards.length, 3);
    const gap    = 10;
    const cardW  = (CONTENT_W - gap * (cols - 1)) / cols;
    const cardH  = 72;
    const startY = doc.y;

    cards.forEach((card, i) => {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x   = MARGIN + col * (cardW + gap);
        const y   = startY + row * (cardH + gap);

        // Card background
        doc.rect(x, y, cardW, cardH).fill(C.bg).stroke(C.border);

        // Accent bar on top
        doc.rect(x, y, cardW, 4).fill(card.color);

        // Label
        doc.fontSize(8).font('Helvetica').fillColor(C.textLight)
            .text(card.label.toUpperCase(), x + 10, y + 14, { width: cardW - 20 });

        // Value
        doc.fontSize(22).font('Helvetica-Bold').fillColor(card.color)
            .text(card.value, x + 10, y + 28, { width: cardW - 20 });
    });

    const rows = Math.ceil(cards.length / cols);
    doc.y = startY + rows * (cardH + gap) + 10;
    doc.fillColor(C.text);
}

// ─── 3. Insights row ──────────────────────────────────────────────────────────
function addInsights(
    doc: PDFKit.PDFDocument,
    data: ReportData,
    hasShifts: boolean,
): void {
    const insights: Array<{ icon: string; text: string; color: string }> = [];

    // Best day
    if (data.dailyData.length > 0) {
        const best = data.dailyData.reduce((a, b) =>
            b.dailyTotal.transactions > a.dailyTotal.transactions ? b : a
        );
        insights.push({
            icon: '★',
            text: `Mejor día: ${fmtDate(best.date)} con ${best.dailyTotal.transactions} transacciones`,
            color: C.accent,
        });
    }

    // Busiest shift
    if (hasShifts && data.periodSummary.totalsByShift.length > 0) {
        const best = data.periodSummary.totalsByShift
            .filter(s => s.shiftName !== 'Sin turno asignado')
            .reduce((a, b) => b.transactions > a.transactions ? b : a);
        insights.push({
            icon: '◷',
            text: `Turno más activo: ${best.shiftName} (${best.transactions} transacciones)`,
            color: C.secondary,
        });
    }

    // Unassigned warning
    if (data.summary.unassignedTransactions > 0) {
        insights.push({
            icon: '⚠',
            text: `${data.summary.unassignedTransactions} transacciones sin turno asignado`,
            color: C.warning,
        });
    }

    if (insights.length === 0) return;

    const y = doc.y;
    const rowH = 28;
    const totalH = insights.length * rowH + 16;

    doc.rect(MARGIN, y, CONTENT_W, totalH).fill(C.bg).stroke(C.border);

    insights.forEach((ins, i) => {
        const iy = y + 8 + i * rowH;
        doc.fontSize(11).font('Helvetica-Bold').fillColor(ins.color)
            .text(ins.icon, MARGIN + 10, iy + 5);
        doc.fontSize(9).font('Helvetica').fillColor(C.text)
            .text(ins.text, MARGIN + 28, iy + 6, { width: CONTENT_W - 38 });
    });

    doc.y = y + totalH + 16;
    doc.fillColor(C.text);
}

// ─── 6. Redemptions ───────────────────────────────────────────────────────────
function addRedemptionSection(
    doc: PDFKit.PDFDocument,
    summary: ReportData['redemptionSummary'],
): void {
    addSectionTitle(doc, 'CANJES DE RECOMPENSAS');

    // Mini KPI row
    const metrics = [
        { label: 'Total canjes',      value: fmt(summary.totalRedemptions) },
        { label: 'Puntos canjeados',  value: fmt(summary.totalPointsRedeemed) },
        { label: 'Sellos canjeados',  value: fmt(summary.totalStampsRedeemed) },
    ];
    const mW = CONTENT_W / 3;
    const mY = doc.y;
    const mH = 56;

    doc.rect(MARGIN, mY, CONTENT_W, mH).fill(C.bg).stroke(C.border);

    metrics.forEach((m, i) => {
        const x = MARGIN + i * mW + 12;
        doc.fontSize(8).font('Helvetica').fillColor(C.textLight)
            .text(m.label.toUpperCase(), x, mY + 10, { width: mW - 20 });
        doc.fontSize(18).font('Helvetica-Bold').fillColor(C.accent)
            .text(m.value, x, mY + 22, { width: mW - 20 });
    });

    doc.y = mY + mH + 12;
    doc.fillColor(C.text);

    if (summary.redemptions.length === 0) return;

    drawTable(doc, {
        headers: ['Fecha', 'Hora', 'Cliente', 'Recompensa', 'Pts', 'Sellos', 'Sucursal'],
        rows: summary.redemptions.map(r => [
            r.date,
            r.time,
            r.clientName,
            r.rewardName,
            r.pointsRedeemed > 0 ? fmt(r.pointsRedeemed) : '-',
            r.stampsRedeemed > 0 ? fmt(r.stampsRedeemed) : '-',
            r.branchName,
        ]),
        widths: [65, 45, 100, 120, 45, 45, 92],
    });

    doc.moveDown(1.5);
}

// ─── 7. Daily detail ──────────────────────────────────────────────────────────
function addDailySection(
    doc: PDFKit.PDFDocument,
    dailyData: DailyReport[],
    hasPoints: boolean,
    hasStamps: boolean,
): void {
    addSectionTitle(doc, 'DETALLE DIARIO');

    for (const day of dailyData) {
        needSpace(doc, 80);

        // Day header bar
        const barY = doc.y;
        doc.rect(MARGIN, barY, CONTENT_W, 26).fill(C.secondary);

        doc.fontSize(11).font('Helvetica-Bold').fillColor(C.white)
            .text(
                `${fmtDate(day.date)}  —  ${capitalise(day.dayOfWeek)}`,
                MARGIN + 10, barY + 7,
            );

        // Day totals (right side of bar)
        const totalsText = buildTotalsText(day.dailyTotal, hasPoints, hasStamps);
        doc.fontSize(9).font('Helvetica').fillColor('#BFDBFE')
            .text(totalsText, MARGIN, barY + 9, { width: CONTENT_W - 10, align: 'right' });

        doc.y = barY + 26 + 6;
        doc.fillColor(C.text);

        // Per-shift rows as a compact table
        const shiftCols = buildShiftColumns(hasPoints, hasStamps);
        drawTable(doc, {
            headers: shiftCols.headers,
            rows: day.shifts.map(s => shiftCols.row({
                shiftName:         s.shiftName,
                transactions:      s.totalTransactions,
                totalTransactions: s.totalTransactions,
                totalPoints:       s.totalPoints,
                totalStamps:       s.totalStamps,
            })),
            widths: shiftCols.widths,
            compact: true,
        });

        doc.moveDown(1);
    }
}

// ─── Table renderer ───────────────────────────────────────────────────────────
function drawTable(
    doc: PDFKit.PDFDocument,
    config: {
        headers: string[];
        rows: string[][];
        widths: number[];
        compact?: boolean;
    },
): void {
    const { headers, rows, widths, compact = false } = config;
    const rowH    = compact ? 20 : 25;
    const headerH = compact ? 22 : 28;
    const startX  = MARGIN;
    const totalW  = widths.reduce((a, b) => a + b, 0);

    const drawHeader = (y: number) => {
        doc.rect(startX, y, totalW, headerH).fill(C.primary);
        doc.fontSize(compact ? 8 : 9).font('Helvetica-Bold').fillColor(C.white);
        let x = startX;
        headers.forEach((h, i) => {
            doc.text(h, x + 6, y + (compact ? 7 : 10), { width: widths[i] - 12, align: i > 0 ? 'right' : 'left' });
            x += widths[i];
        });
    };

    const drawBorder = (y1: number, y2: number) => {
        doc.rect(startX, y1, totalW, y2 - y1).stroke(C.border).lineWidth(0.5);
        let x = startX;
        widths.forEach((w, i) => {
            if (i > 0) {
                doc.strokeColor(C.border).lineWidth(0.5)
                    .moveTo(x, y1).lineTo(x, y2).stroke();
            }
            x += w;
        });
    };

    let segY = doc.y;
    drawHeader(segY);
    let curY = segY + headerH;

    doc.fontSize(compact ? 8 : 9).font('Helvetica').fillColor(C.text);

    rows.forEach((row, idx) => {
        // Page break mid-table
        if (curY + rowH > SAFE_BOTTOM) {
            drawBorder(segY, curY);
            doc.addPage();
            segY = doc.y;
            drawHeader(segY);
            curY = segY + headerH;
        }

        // Alternating row bg
        if (idx % 2 === 0) {
            doc.rect(startX, curY, totalW, rowH).fill(C.bg);
        }

        let x = startX;
        row.forEach((cell, ci) => {
            doc.fillColor(C.text)
                .text(cell, x + 6, curY + (compact ? 5 : 8), {
                    width: widths[ci] - 12,
                    align: ci > 0 ? 'right' : 'left',
                    lineBreak: false,
                });
            x += widths[ci];
        });

        curY += rowH;
    });

    drawBorder(segY, curY);
    doc.y = curY + 6;
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function addFooter(doc: PDFKit.PDFDocument, generatedAt: Date): void {
    const range = doc.bufferedPageRange();
    const lastPage = range.start + range.count - 1;

    for (let p = range.start; p <= lastPage; p++) {
        try {
            doc.switchToPage(p);
            const fy = PAGE_H - FOOTER_H + 5;

            doc.strokeColor(C.border).lineWidth(0.5)
                .moveTo(MARGIN, fy - 5).lineTo(PAGE_W - MARGIN, fy - 5).stroke();

            doc.fontSize(8).font('Helvetica').fillColor(C.textLight)
                .text(`Generado el ${fmtDateTime(generatedAt)}`, MARGIN, fy, { width: 220, align: 'left' });

            doc.text(
                `Página ${p - range.start + 1} de ${range.count}`,
                PAGE_W - MARGIN - 100, fy,
                { width: 100, align: 'right' },
            );
        } catch { /* skip */ }
    }

    // Leave cursor on the last page so PDFKit doesn't create a phantom blank page
    doc.switchToPage(lastPage);
}

// ─── Section title ────────────────────────────────────────────────────────────
function addSectionTitle(doc: PDFKit.PDFDocument, title: string): void {
    doc.fontSize(12).font('Helvetica-Bold').fillColor(C.primary)
        .text(title, MARGIN, doc.y);

    const w = doc.widthOfString(title);
    const ly = doc.y + 1;
    doc.strokeColor(C.primary).lineWidth(2)
        .moveTo(MARGIN, ly).lineTo(MARGIN + w, ly).stroke();

    doc.moveDown(0.8);
    doc.fillColor(C.text);
}

// ─── needSpace: add page if not enough vertical room ──────────────────────────
function needSpace(doc: PDFKit.PDFDocument, height: number): void {
    if (doc.y + height > SAFE_BOTTOM) {
        doc.addPage();
    }
}

// ─── Column config helpers ────────────────────────────────────────────────────
function buildShiftColumns(hasPoints: boolean, hasStamps: boolean) {
    const headers = ['Turno', 'Transacciones'];
    const widths  = [200, 110];

    if (hasPoints)  { headers.push('Puntos');  widths.push(100); }
    if (hasStamps)  { headers.push('Sellos');  widths.push(100); }

    // Pad to CONTENT_W
    const used = widths.reduce((a, b) => a + b, 0);
    if (used < CONTENT_W) widths[0] += CONTENT_W - used;

    // Accepts both periodSummary rows (points/stamps) and ShiftSummary (totalPoints/totalStamps)
    const row = (s: { shiftName: string; transactions: number; points?: number; stamps?: number; totalPoints?: number; totalStamps?: number; totalTransactions?: number }) => {
        const txns   = s.totalTransactions ?? s.transactions;
        const pts    = s.totalPoints  ?? s.points  ?? 0;
        const stmps  = s.totalStamps  ?? s.stamps  ?? 0;
        const cells  = [s.shiftName, fmt(txns)];
        if (hasPoints) cells.push(fmt(pts));
        if (hasStamps) cells.push(fmt(stmps));
        return cells;
    };

    return { headers, widths, row };
}

function buildBranchHeaders(hasPoints: boolean, hasStamps: boolean): string[] {
    const h = ['Sucursal', 'Transacciones'];
    if (hasPoints) h.push('Puntos');
    if (hasStamps) h.push('Sellos');
    return h;
}

function buildBranchWidths(hasPoints: boolean, hasStamps: boolean): number[] {
    const w = [220, 110];
    if (hasPoints) w.push(100);
    if (hasStamps) w.push(100);
    const used = w.reduce((a, b) => a + b, 0);
    if (used < CONTENT_W) w[0] += CONTENT_W - used;
    return w;
}

function buildBranchRow(
    b: ReportData['branchSummary'][0],
    hasPoints: boolean,
    hasStamps: boolean,
): string[] {
    const cells = [b.branchName, fmt(b.totals.transactions)];
    if (hasPoints) cells.push(fmt(b.totals.points));
    if (hasStamps) cells.push(fmt(b.totals.stamps));
    return cells;
}

function buildTotalsText(
    totals: { transactions: number; points: number; stamps: number },
    hasPoints: boolean,
    hasStamps: boolean,
): string {
    const parts = [`${totals.transactions} trans.`];
    if (hasPoints && totals.points !== 0) parts.push(`${fmt(totals.points)} pts`);
    if (hasStamps && totals.stamps !== 0) parts.push(`${fmt(totals.stamps)} sellos`);
    return parts.join('  |  ');
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function fmt(n: number): string {
    return n.toLocaleString('es-MX');
}

function fmtCurrency(n: number): string {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);
}

function fmtDate(date: Date): string {
    const d = new Date(date);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function fmtDateTime(date: Date): string {
    return `${fmtDate(date)} a las ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(n: number): string {
    return n.toString().padStart(2, '0');
}

function capitalise(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
