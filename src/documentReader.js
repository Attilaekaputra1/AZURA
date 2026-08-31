/**
 * AZURA Universal Document Parser & Extraction Engine
 * Supports: PDF (.pdf), Word (.docx), Excel (.xlsx, .xls), CSV (.csv), Markdown (.md), Code files & Text logs.
 */

const https = require('https');
const http = require('http');

const MAX_DOC_CHARS = 30000; // 30k characters max per document for LLM context balance

/**
 * Download a remote document into a Memory Buffer
 * @param {string} url 
 * @returns {Promise<Buffer>}
 */
function fetchDocumentBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchDocumentBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} saat mengunduh dokumen.`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (err) => reject(err));
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(25000, () => {
      req.destroy();
      reject(new Error('Timeout mengunduh dokumen (25s).'));
    });
  });
}

/**
 * Check if an attachment or URL is a supported document format
 * @param {string} filename 
 * @param {string} [contentType] 
 * @returns {boolean}
 */
function isDocumentMedia(filename = '', contentType = '') {
  const lower = filename.toLowerCase();
  if (contentType && (
    contentType.includes('pdf') ||
    contentType.includes('word') ||
    contentType.includes('officedocument') ||
    contentType.includes('excel') ||
    contentType.includes('spreadsheet') ||
    contentType.startsWith('text/')
  )) return true;

  return /\.(pdf|docx|doc|xlsx|xls|csv|txt|json|md|log|js|ts|py|html|css|xml|yaml|yml|sql|c|cpp|cs|java|php|sh|bat)(\?|$)/i.test(lower);
}

/**
 * Parse and extract clean structured text from any supported document buffer
 * @param {Buffer} buffer 
 * @param {string} filename 
 * @returns {Promise<{ success: boolean, type: string, title?: string, pageCount?: number, content: string, error?: string }>}
 */
async function parseDocumentBuffer(buffer, filename = 'document.txt') {
  const lower = filename.toLowerCase();

  // ── 1. PDF Document Parser (.pdf) ──
  if (lower.endsWith('.pdf')) {
    try {
      const pdfParse = require('pdf-parse');
      let cleanText = '';
      let numPages = 1;
      let title = filename;

      if (typeof pdfParse === 'function') {
        const pdfData = await pdfParse(buffer);
        cleanText = pdfData.text || '';
        numPages = pdfData.numpages || 1;
        title = pdfData.info?.Title || filename;
      } else if (pdfParse.PDFParse) {
        const parser = new pdfParse.PDFParse({ data: buffer });
        const res = await parser.extractText();
        cleanText = res.text || '';
        numPages = res.numpages || 1;
      }

      cleanText = cleanText.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const truncated = cleanText.length > MAX_DOC_CHARS
        ? cleanText.slice(0, MAX_DOC_CHARS) + `\n\n... [Sisa ${cleanText.length - MAX_DOC_CHARS} karakter dokumen dipotong untuk optimasi token]`
        : cleanText;

      return {
        success: true,
        type: 'PDF Document',
        title,
        pageCount: numPages,
        content: truncated || '(Dokumen PDF kosong / hanya berisi gambar pindaian tanpa teks)'
      };
    } catch (pdfErr) {
      console.warn('[DocReader]: PDF Parsing failed:', pdfErr.message);
      return { success: false, type: 'PDF', content: '', error: `Gagal membaca PDF: ${pdfErr.message}` };
    }
  }

  // ── 2. Microsoft Word Document Parser (.docx) ──
  if (lower.endsWith('.docx')) {
    try {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      const rawText = (result.value || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

      const truncated = rawText.length > MAX_DOC_CHARS
        ? rawText.slice(0, MAX_DOC_CHARS) + `\n\n... [Sisa ${rawText.length - MAX_DOC_CHARS} karakter dipotong]`
        : rawText;

      return {
        success: true,
        type: 'Microsoft Word Document (.docx)',
        title: filename,
        content: truncated || '(Dokumen Word kosong)'
      };
    } catch (docErr) {
      console.warn('[DocReader]: Word DOCX Parsing failed:', docErr.message);
      return { success: false, type: 'Word DOCX', content: '', error: `Gagal membaca file Word: ${docErr.message}` };
    }
  }

  // ── 3. Microsoft Excel & Spreadsheet Parser (.xlsx, .xls, .csv) ──
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    try {
      const xlsx = require('xlsx');
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const sheetNames = workbook.SheetNames || [];
      const extractedSheets = [];

      for (const sheetName of sheetNames.slice(0, 5)) { // Max first 5 sheets
        const worksheet = workbook.Sheets[sheetName];
        const csvData = xlsx.utils.sheet_to_csv(worksheet);
        if (csvData && csvData.trim().length > 0) {
          extractedSheets.push(`📊 **Sheet: [${sheetName}]**\n\`\`\`csv\n${csvData.slice(0, 8000)}\n\`\`\``);
        }
      }

      const combinedSheets = extractedSheets.join('\n\n');
      return {
        success: true,
        type: 'Spreadsheet Excel / CSV',
        title: filename,
        content: combinedSheets || '(File Spreadsheet kosong)'
      };
    } catch (xlsErr) {
      console.warn('[DocReader]: Excel/Spreadsheet Parsing failed:', xlsErr.message);
      return { success: false, type: 'Excel', content: '', error: `Gagal membaca spreadsheet: ${xlsErr.message}` };
    }
  }

  // ── 4. Plain Text, Markdown, Logs, JSON, & Code Files ──
  try {
    const textData = buffer.toString('utf-8');
    const truncated = textData.length > MAX_DOC_CHARS
      ? textData.slice(0, MAX_DOC_CHARS) + `\n\n... [Dipostong untuk optimasi]`
      : textData;

    return {
      success: true,
      type: 'Text / Code Document',
      title: filename,
      content: truncated
    };
  } catch (txtErr) {
    return { success: false, type: 'Text', content: '', error: txtErr.message };
  }
}

/**
 * Download and extract text from an attachment URL
 * @param {string} url 
 * @param {string} filename 
 * @returns {Promise<{ success: boolean, promptSnippet: string }>}
 */
async function extractDocumentAttachment(url, filename = 'document.txt') {
  try {
    console.log(`[DocReader]: 📄 Fetching and parsing document "${filename}"...`);
    const buffer = await fetchDocumentBuffer(url);
    const sizeKb = (buffer.length / 1024).toFixed(1);
    const parsed = await parseDocumentBuffer(buffer, filename);

    if (parsed.success) {
      const pageInfo = parsed.pageCount ? ` | Total Halaman: \`${parsed.pageCount} Halaman\`` : '';
      const snippet =
        `\n\n[DOKUMEN RESMI TERVERIFIKASI: "${filename}"]\n` +
        `📋 **Tipe Dokumen:** \`${parsed.type}\` | Ukuran: \`${sizeKb} KB\`${pageInfo}\n\n` +
        `📝 **Isi / Teks Lengkap Dokumen:**\n` +
        `\`\`\`\n` +
        `${parsed.content}\n` +
        `\`\`\`\n` +
        `PEDOMAN ANALISIS DOKUMEN AZURA:\n` +
        `1. Kamu telah membaca isi dokumen "${filename}" di atas secara menyeluruh.\n` +
        `2. Berikan analisis, rangkuman, jawaban pertanyaan, atau kritik/saran terkait isi dokumen tersebut secara cerdas, tajam, dan komprehensif!`;

      return { success: true, promptSnippet: snippet };
    } else {
      return {
        success: false,
        promptSnippet: `\n\n[Lampiran Dokumen "${filename}"]: Gagal mengekstrak teks (${parsed.error})`
      };
    }
  } catch (err) {
    console.warn(`[DocReader Error]: Failed to extract document "${filename}":`, err.message);
    return {
      success: false,
      promptSnippet: `\n\n[Lampiran Dokumen "${filename}"]: Tidak dapat diunduh (${err.message})`
    };
  }
}

module.exports = {
  isDocumentMedia,
  parseDocumentBuffer,
  extractDocumentAttachment,
  fetchDocumentBuffer
};
