// Génération PDF côté serveur (pdf-lib, JavaScript pur : fonctionne en Node, Vercel et Docker).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const WIN_ANSI_EXTRA = new Set([0x2019, 0x2018, 0x201c, 0x201d, 0x2013, 0x2014, 0x2022, 0x2026, 0x20ac, 0x0152, 0x0153, 0x2122, 0x201a, 0x201e, 0x2020, 0x2021, 0x2030]);

/** Les polices standard PDF n'encodent que WinAnsi : on normalise les espaces fines et on remplace le reste par « ? ». */
export function pdfSafe(s: string): string {
  return Array.from(String(s).replace(/[\u202f\u2009\u00a0\u2007]/g, ' ').replace(/[\r\n\t]+/g, ' '))
    .map((ch) => { const c = ch.codePointAt(0)!; return (c >= 32 && c <= 126) || (c >= 161 && c <= 255) || WIN_ANSI_EXTRA.has(c) || c === 32 ? ch : '?'; })
    .join('');
}

export type Col = { label: string; width: number; align?: 'left' | 'right' };
const W = 841.89, H = 595.28, M = 36; // A4 paysage

export class PdfReport {
  private pages: PDFPage[] = [];
  private y = 0;
  private constructor(private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private title: string) {}

  static async create(title: string, subtitle: string) {
    const doc = await PDFDocument.create();
    doc.setTitle(pdfSafe(title)); doc.setProducer('JEEAM Finance'); doc.setCreator('JEEAM Finance');
    const r = new PdfReport(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), title);
    r.newPage();
    r.text(title, M, r.y - 14, 18, true, rgb(0.12, 0.25, 0.6)); r.y -= 30;
    r.text(subtitle, M, r.y - 8, 9, false, rgb(0.4, 0.4, 0.45)); r.y -= 24;
    return r;
  }

  private get page() { return this.pages[this.pages.length - 1]; }
  private newPage() { this.pages.push(this.doc.addPage([W, H])); this.y = H - M; }
  private ensure(h: number) { if (this.y - h < M + 18) this.newPage(); }
  private text(t: string, x: number, y: number, size = 9, bold = false, color = rgb(0.1, 0.1, 0.12)) {
    this.page.drawText(pdfSafe(t), { x, y, size, font: bold ? this.bold : this.font, color });
  }
  private fit(t: string, width: number, size: number, bold = false) {
    const f = bold ? this.bold : this.font;
    let s = pdfSafe(t);
    if (f.widthOfTextAtSize(s, size) <= width) return s;
    while (s.length > 1 && f.widthOfTextAtSize(s + '…', size) > width) s = s.slice(0, -1);
    return s + '…';
  }

  kpis(items: { label: string; value: string }[]) {
    this.ensure(52);
    const gap = 10, w = (W - 2 * M - gap * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const x = M + i * (w + gap);
      this.page.drawRectangle({ x, y: this.y - 44, width: w, height: 44, color: rgb(0.95, 0.96, 0.98), borderColor: rgb(0.85, 0.87, 0.92), borderWidth: 0.6 });
      this.text(it.label, x + 8, this.y - 15, 8, false, rgb(0.4, 0.4, 0.45));
      this.text(this.fit(it.value, w - 16, 13, true), x + 8, this.y - 34, 13, true);
    });
    this.y -= 60;
  }

  section(title: string) { this.ensure(40); this.text(title, M, this.y - 12, 11, true, rgb(0.12, 0.25, 0.6)); this.y -= 22; }

  table(cols: Col[], rows: string[][], size = 7.5) {
    const rowH = size + 7;
    const head = () => {
      this.ensure(rowH * 2);
      this.page.drawRectangle({ x: M, y: this.y - rowH, width: cols.reduce((s, c) => s + c.width, 0), height: rowH, color: rgb(0.88, 0.9, 0.96) });
      let x = M;
      for (const c of cols) { this.cell(c.label, x, this.y - rowH + 4, c, size, true); x += c.width; }
      this.y -= rowH;
    };
    head();
    rows.forEach((r, i) => {
      if (this.y - rowH < M + 18) { this.newPage(); head(); }
      if (i % 2) this.page.drawRectangle({ x: M, y: this.y - rowH, width: cols.reduce((s, c) => s + c.width, 0), height: rowH, color: rgb(0.975, 0.977, 0.985) });
      let x = M;
      cols.forEach((c, j) => { this.cell(r[j] ?? '', x, this.y - rowH + 4, c, size, false); x += c.width; });
      this.y -= rowH;
    });
    if (!rows.length) { this.text('Aucune donnée.', M + 4, this.y - rowH + 4, size, false, rgb(0.5, 0.5, 0.55)); this.y -= rowH; }
    this.y -= 12;
  }

  private cell(t: string, x: number, y: number, c: Col, size: number, bold: boolean) {
    const s = this.fit(t, c.width - 8, size, bold);
    const w = (bold ? this.bold : this.font).widthOfTextAtSize(s, size);
    this.text(s, c.align === 'right' ? x + c.width - 4 - w : x + 4, y, size, bold);
  }

  async finish(): Promise<Uint8Array> {
    const n = this.pages.length, stamp = new Date().toLocaleString('fr-FR');
    this.pages.forEach((p, i) => p.drawText(pdfSafe(`JEEAM Finance — ${this.title} — généré le ${stamp} — page ${i + 1}/${n}`), { x: M, y: 20, size: 7, font: this.font, color: rgb(0.5, 0.5, 0.55) }));
    return this.doc.save();
  }
}
