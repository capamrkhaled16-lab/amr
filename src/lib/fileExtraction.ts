/**
 * Browser-based file content extraction.
 * - Text files: read directly via FileReader
 * - Images: OCR via Tesseract.js (lazy-loaded), plus generate thumbnail preview
 * - PDF: extract text via pdfjs-dist (lazy-loaded). If text is empty (scanned PDF),
 *   render pages as images and OCR them.
 * - DOC/DOCX: extract text via simple binary text scan
 */

export type ExtractedFile = {
  name: string;
  type: string;
  size: number;
  text: string;
  previewUrl?: string;
  base64?: string;
  status: 'done' | 'error';
  error?: string;
};

const TEXT_EXTS = ['.txt', '.csv', '.md', '.json', '.xml', '.html', '.htm', '.rtf'];
const DOC_EXTS = ['.doc', '.docx'];

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return TEXT_EXTS.includes(getExt(file.name));
}

function isDocFile(file: File): boolean {
  if (file.type.includes('document') || file.type.includes('word')) return true;
  return DOC_EXTS.includes(getExt(file.name));
}

async function fileToBase64(file: File | Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms),
    ),
  ]);
}

// Validate that extracted text has meaningful content (Arabic or Latin letters)
function hasMeaningfulText(text: string): boolean {
  if (!text || text.trim().length < 5) return false;
  // Count Arabic and Latin letters
  const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = arabicChars + latinChars;
  // Need at least 20 meaningful letters to be usable
  return totalLetters >= 20;
}

async function ocrImage(file: File | Blob, lang: string): Promise<string> {
  const Tesseract = await import('tesseract.js');
  const { data } = await Tesseract.recognize(file, lang, {
    logger: () => {},
  });
  return data.text.trim();
}

async function ocrImageWithTimeout(file: File | Blob, lang: string, ms: number): Promise<string> {
  return withTimeout(ocrImage(file, lang), ms);
}

export async function extractFile(file: File): Promise<ExtractedFile> {
  const base = { name: file.name, type: file.type, size: file.size };

  // Image → OCR + thumbnail, plus base64 for vision AI fallback
  if (file.type.startsWith('image/')) {
    const previewUrl = URL.createObjectURL(file);
    const base64 = await fileToBase64(file);
    try {
      const text = await ocrImageWithTimeout(file, 'ara+eng', 30000);
      if (hasMeaningfulText(text)) {
        return { ...base, text, previewUrl, base64, status: 'done' };
      }
      // OCR returned empty/garbage — still have base64 for vision AI
      return { ...base, text: '', previewUrl, base64, status: 'done' };
    } catch {
      // OCR failed or timed out — return with base64 so vision AI can read it
      return { ...base, text: '', previewUrl, base64, status: 'done' };
    }
  }

  // PDF → text extraction, with image-OCR fallback for scanned PDFs
  if (file.type === 'application/pdf' || getExt(file.name) === '.pdf') {
    try {
      const pdfjs = await import('pdfjs-dist');
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = pdfjs as unknown as {
        getDocument: (opts: Record<string, unknown>) => {
          promise: Promise<{
            numPages: number;
            getPage: (n: number) => Promise<{
              getTextContent: () => Promise<{ items: { str: string }[] }>;
              render: (params: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => Promise<void>;
              getViewport: (params: { scale: number }) => unknown;
            }>;
          }>;
        };
      };
      const doc = await withTimeout(pdfjsLib.getDocument({ data: arrayBuffer }).promise, 15000);
      const pages: string[] = [];
      let allText = '';

      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const text = content.items.map((it: { str: string }) => it.str).join(' ');
        pages.push(text);
      }
      allText = pages.join('\n\n').trim();

      // If text extraction yielded meaningful content, use it
      if (hasMeaningfulText(allText)) {
        return { ...base, text: allText, status: 'done' };
      }

      // Fallback: render pages as images and OCR them (for scanned PDFs)
      // Limit to first 5 pages to avoid excessive processing
      const maxOcrPages = Math.min(doc.numPages, 5);
      const ocrTexts: string[] = [];
      for (let p = 1; p <= maxOcrPages; p++) {
        try {
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          canvas.width = (viewport as { width: number }).width;
          canvas.height = (viewport as { height: number }).height;
          await page.render({ canvasContext: ctx, viewport });
          const dataUrl = canvas.toDataURL('image/png');
          // Convert data URL to blob for OCR
          const resp = await fetch(dataUrl);
          const blob = await resp.blob();
          const ocrText = await ocrImageWithTimeout(blob, 'ara+eng', 30000);
          if (ocrText) ocrTexts.push(ocrText);
        } catch {
          // skip page on error
        }
      }
      const ocrCombined = ocrTexts.join('\n\n').trim();
      if (hasMeaningfulText(ocrCombined)) {
        return { ...base, text: ocrCombined, status: 'done' };
      }

      // Both methods failed — return empty text but include base64 of first page for vision AI
      try {
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = (viewport as { width: number }).width;
          canvas.height = (viewport as { height: number }).height;
          await page.render({ canvasContext: ctx, viewport });
          const dataUrl = canvas.toDataURL('image/png');
          const resp = await fetch(dataUrl);
          const blob = await resp.blob();
          const pdfBase64 = await fileToBase64(blob);
          return { ...base, text: '', base64: pdfBase64, status: 'done' };
        }
      } catch { /* ignore */ }
      return { ...base, text: '', status: 'done' };
    } catch {
      return { ...base, text: '', status: 'done' };
    }
  }

  // Plain text
  if (isTextFile(file)) {
    try {
      const text = await file.text();
      return { ...base, text: text.trim(), status: 'done' };
    } catch {
      return { ...base, text: '', status: 'done' };
    }
  }

  // .doc/.docx — extract readable text from the binary
  if (isDocFile(file)) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const text = extractDocxText(arrayBuffer);
      if (hasMeaningfulText(text)) {
        return { ...base, text, status: 'done' };
      }
      return { ...base, text: '', status: 'done' };
    } catch {
      return { ...base, text: '', status: 'done' };
    }
  }

  return { ...base, text: '', status: 'done' };
}

// Extract text from .docx (which is a ZIP containing XML)
// and .doc (binary format) by scanning for text patterns
function extractDocxText(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);

  // .docx files are ZIP archives containing word/document.xml
  // We can find XML text content by looking for <w:t> tags
  const decoder = new TextDecoder('utf-8');
  const raw = decoder.decode(bytes);

  // Extract text from <w:t> tags (docx)
  const docxMatches = raw.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  if (docxMatches && docxMatches.length > 0) {
    const text = docxMatches
      .map(m => m.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''))
      .join(' ');
    if (hasMeaningfulText(text)) return text;
  }

  // Fallback for .doc (binary): scan for readable text sequences
  // Look for sequences of Arabic and Latin characters
  const arabicLatinText = raw
    .replace(/[^\u0600-\u06FF\u0750-\u077Fa-zA-Z0-9\s\.\,\!\?\:\;\-\(\)\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (hasMeaningfulText(arabicLatinText)) return arabicLatinText;

  return '';
}

export async function extractFiles(files: File[]): Promise<ExtractedFile[]> {
  const results = await Promise.allSettled(files.map(f => extractFile(f)));
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      name: files[i].name,
      type: files[i].type,
      size: files[i].size,
      text: '',
      status: 'error' as const,
      error: 'فشل استخراج المحتوى',
    };
  });
}

export function collectImageBase64(extracted: ExtractedFile[]): string[] {
  return extracted
    .filter(f => f.base64)
    .map(f => f.base64!);
}

// Strip OCR artifacts, image filenames, and corrupted tokens from extracted text
function sanitizeExtractedText(text: string): string {
  let cleaned = text;
  // Remove image filenames and screenshot artifacts
  cleaned = cleaned.replace(/(?:Samsung_[A-Za-z0-9_]+|Screenshot_[A-Za-z0-9_]+|IMG_[A-Za-z0-9_]+|DSC_[A-Za-z0-9_]+|image\d*)/gi, '');
  // Remove file extensions
  cleaned = cleaned.replace(/\.(?:png|jpg|jpeg|gif|bmp|webp|pdf|docx?)\b/gi, '');
  // Remove blob/data URLs
  cleaned = cleaned.replace(/(?:blob:|data:)[^\s\u0600-\u06FF]*/gi, '');
  // Remove OCR garbage tokens
  cleaned = cleaned.replace(/\b(?:GRIER|GREIER|grier)\b/gi, '');
  // Remove dashed line artifacts
  cleaned = cleaned.replace(/-{3,}/g, '');
  // Remove BOM/BIDI/invisible marks
  cleaned = cleaned.replace(/[\u200b\u200c\u200d\u200e\u200f\ufeff\u00a0\u202a-\u202e\uFFFD\uFE0F]/g, '');
  // Remove stray Latin fragments inside Arabic text (keep URLs/emails out)
  cleaned = cleaned.replace(/(?<![\u0600-\u06FFa-zA-Z])[a-z]{1,4}(?![\u0600-\u06FFa-zA-Z])/g, '');
  // Remove empty quotes
  cleaned = cleaned.replace(/[""\u201c\u201d]\s*[""\u201c\u201d]/g, '');
  // Remove duplicate consecutive words (spam tokens like "الميكروسكوبية الميكروسكوبية")
  cleaned = cleaned.replace(/\b([\u0600-\u06FF]+)\s+\1\b/g, '$1');
  // Normalize whitespace
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  return cleaned.trim();
}

export function combineExtractedText(extracted: ExtractedFile[]): string {
  const parts: string[] = [];
  for (const f of extracted) {
    if (f.text && f.text.trim().length > 0) {
      // Sanitize artifacts before sending to AI — strip filenames, OCR garbage, spam tokens
      parts.push(sanitizeExtractedText(f.text));
    }
  }
  return parts.join('\n\n');
}
