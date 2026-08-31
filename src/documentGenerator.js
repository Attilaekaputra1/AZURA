/**
 * AZURA Document Generator Engine
 * 1. Aesthetic PDF Generator (HTML5 + CSS3 + Playwright Chromium)
 * 2. Formal Microsoft Word Generator (.docx via `docx` library)
 */

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { chromium } = require('playwright-chromium');
const {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  Packer,
  Header,
  Footer,
  PageNumber
} = require('docx');
const { OpenAI } = require('openai');
const config = require('./config');

let _openai = null;
function getOpenAIClient() {
  if (!_openai && config.OPENAI_API_KEY) {
    _openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return _openai;
}

/**
 * Detect if a user message is requesting document file generation (PDF / Word DOCX)
 * @param {string} prompt 
 * @returns {{ isDocRequest: boolean, format?: 'pdf' | 'docx', topic?: string }}
 */
function parseDocumentGenRequest(prompt) {
  if (!prompt || typeof prompt !== 'string') return { isDocRequest: false };

  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  // Exclusion guard: checking, reading, or uploading documents should not trigger generation
  if (/\b(?:baca\s+dokumen|cek\s+pdf|ekstrak\s+pdf|baca\s+word|baca\s+file|isi\s+file)\b/i.test(lower)) {
    return { isDocRequest: false };
  }

  const isPdf = /\b(?:pdf|format\s+pdf|file\s+pdf|dokumen\s+pdf|cetak\s+pdf|jadikan\s+pdf)\b/i.test(lower);
  const isWord = /\b(?:word|docx|format\s+word|file\s+word|dokumen\s+word|format\s+docx|file\s+docx)\b/i.test(lower);

  const isGenVerb = /\b(?:buatkan|buat|bikin|generate|susun|tulis|tuliskan|cetak|ekspor|export|simpan\s+ke|jadikan|jadikan\s+file)\b/i.test(lower);

  if ((isPdf || isWord) && (isGenVerb || lower.includes('dalam bentuk') || lower.includes('format'))) {
    const format = isWord ? 'docx' : 'pdf';
    let topic = clean
      .replace(/^(?:azura|ara|zura|ajur|ajura)[,\s]*/i, '')
      .replace(/\b(?:tolong|coba|dong|plis|please|ya|kan)\b/gi, '')
      .replace(/\b(?:buatkan|buat|bikin|generate|susun|tulis|tuliskan|cetak|ekspor|export|simpan\s+ke|jadikan)\b/gi, '')
      .replace(/\b(?:dalam\s+bentuk|format|file|dokumen)\s+(?:pdf|word|docx)\b/gi, '')
      .replace(/\b(?:ke\s+dalam|jadi)\s+(?:pdf|word|docx)\b/gi, '')
      .replace(/\b(?:pdf|word|docx)\b/gi, '')
      .trim();

    return {
      isDocRequest: true,
      format,
      topic: topic || 'Dokumen Resmi'
    };
  }

  return { isDocRequest: false };
}

/**
 * Generate comprehensive, structured document content using OpenAI LLM
 * @param {string} topic 
 * @param {string} format 'pdf' | 'docx'
 * @param {string} userName 
 * @returns {Promise<{ title: string, subtitle: string, sections: Array<{ heading: string, body: string, table?: Array<Array<string>>, list?: string[] }> }>}
 */
async function generateDocumentStructure(topic, format, userName = 'Pengguna') {
  const client = getOpenAIClient();
  const prompt = `Kamu adalah perancang dokumen profesional tingkat tinggi.
Buatkan isi dokumen formal, terstruktur, tajam, dan lengkap untuk topik berikut:
"${topic}"

Penulis / Pemohon: ${userName}
Format Output yang Dituju: ${format.toUpperCase()}

KEMBALIKAN HANYA JSON MURNI (tanpa markdown blok \`\`\`json) dengan skema berikut:
{
  "title": "Judul Dokumen Lengkap & Menarik",
  "subtitle": "Subjudul atau Deskripsi Singkat Dokumen",
  "category": "Proposal / Laporan / Surat / Notulensi / Resume / Dokumen Teknis",
  "sections": [
    {
      "heading": "Nama Bab / Subjudul",
      "body": "Paragraf penjelasan yang mendalam, formal, dan komprehensif.",
      "list": ["Poin 1", "Poin 2"] (Opsional jika ada daftar poin),
      "table": [ ["Kolom 1", "Kolom 2"], ["Data A", "Data B"] ] (Opsional jika ada tabel data)
    }
  ]
}`;

  const response = await client.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages: [
      { role: 'system', content: 'Kamu adalah AI Document Architect yang menghasilkan data dokumen terstruktur dalam format JSON valid.' },
      { role: 'user', content: prompt }
    ]
  });

  const rawJson = response.choices[0]?.message?.content?.trim() || '{}';
  const cleanJson = rawJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();

  try {
    return JSON.parse(cleanJson);
  } catch (err) {
    console.warn('[DocGen]: JSON parse error, falling back to simple structure:', err.message);
    return {
      title: topic.slice(0, 60),
      subtitle: `Dokumen Resmi disusun untuk ${userName}`,
      category: 'Dokumen Resmi',
      sections: [
        { heading: 'Ringkasan Eksekutif', body: rawJson }
      ]
    };
  }
}

/**
 * Render Aesthetic, Magazine/Enterprise Quality PDF using Playwright Chromium
 * @param {object} docData 
 * @param {string} userName 
 * @returns {Promise<Buffer>}
 */
async function renderAestheticPdf(docData, userName = 'Pengguna') {
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  // Build Sections HTML
  const sectionsHtml = (docData.sections || []).map((sec, idx) => {
    let listHtml = '';
    if (sec.list && Array.isArray(sec.list)) {
      listHtml = `<ul class="doc-list">${sec.list.map(item => `<li>${item}</li>`).join('')}</ul>`;
    }

    let tableHtml = '';
    if (sec.table && Array.isArray(sec.table) && sec.table.length > 0) {
      const headers = sec.table[0];
      const rows = sec.table.slice(1);
      tableHtml = `
        <table class="doc-table">
          <thead>
            <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      `;
    }

    return `
      <div class="section-block">
        <h2 class="section-title"><span class="sec-num">${idx + 1}.</span> ${sec.heading}</h2>
        <p class="section-body">${(sec.body || '').replace(/\n\n/g, '</p><p class="section-body">')}</p>
        ${listHtml}
        ${tableHtml}
      </div>
    `;
  }).join('');

  const htmlContent = `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

    @page {
      size: A4;
      margin: 20mm 18mm 22mm 18mm;
      @bottom-right {
        content: "Halaman " counter(page) " dari " counter(pages);
        font-family: 'Plus Jakarta Sans', sans-serif;
        font-size: 8pt;
        color: #8A99AD;
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #1E293B;
      background-color: #FFFFFF;
      font-size: 10.5pt;
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }

    /* Header Banner */
    .header-banner {
      border-bottom: 2.5px solid #2B82EA;
      padding-bottom: 16px;
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .category-badge {
      display: inline-block;
      background: linear-gradient(135deg, #2B82EA 0%, #6C5CE7 100%);
      color: #FFFFFF;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 8px;
    }

    .doc-title {
      font-size: 22pt;
      font-weight: 800;
      color: #0F172A;
      line-height: 1.25;
      margin-bottom: 6px;
    }

    .doc-subtitle {
      font-size: 11pt;
      color: #64748B;
      font-weight: 500;
    }

    .meta-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 26px;
      display: flex;
      justify-content: space-between;
      font-size: 9pt;
      color: #475569;
    }

    .meta-item strong {
      color: #0F172A;
    }

    /* Section Styles */
    .section-block {
      margin-bottom: 22px;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 13pt;
      font-weight: 700;
      color: #0F172A;
      border-bottom: 1.5px solid #E2E8F0;
      padding-bottom: 6px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
    }

    .sec-num {
      color: #2B82EA;
      margin-right: 6px;
    }

    .section-body {
      color: #334155;
      margin-bottom: 10px;
      text-align: justify;
    }

    /* Lists */
    .doc-list {
      margin-left: 20px;
      margin-bottom: 12px;
      color: #334155;
    }

    .doc-list li {
      margin-bottom: 6px;
      padding-left: 4px;
    }

    /* Tables */
    .doc-table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0 18px 0;
      font-size: 9.5pt;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      overflow: hidden;
    }

    .doc-table th {
      background-color: #F1F5F9;
      color: #0F172A;
      font-weight: 700;
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1.5px solid #CBD5E1;
    }

    .doc-table td {
      padding: 9px 12px;
      border-bottom: 1px solid #E2E8F0;
      color: #334155;
    }

    .doc-table tr:nth-child(even) {
      background-color: #F8FAFC;
    }

    /* Footer Branding */
    .doc-footer {
      margin-top: 36px;
      padding-top: 14px;
      border-top: 1px dashed #CBD5E1;
      display: flex;
      justify-content: space-between;
      font-size: 8pt;
      color: #94A3B8;
    }
  </style>
</head>
<body>
  <div class="header-banner">
    <div>
      <div class="category-badge">${docData.category || 'DOKUMEN RESMI'}</div>
      <h1 class="doc-title">${docData.title || 'Dokumen'}</h1>
      <p class="doc-subtitle">${docData.subtitle || ''}</p>
    </div>
  </div>

  <div class="meta-box">
    <div class="meta-item">👤 <strong>Disusun Untuk:</strong> ${userName}</div>
    <div class="meta-item">📅 <strong>Tanggal:</strong> ${dateStr}</div>
    <div class="meta-item">🛡️ <strong>Status:</strong> Resmi & Terverifikasi</div>
  </div>

  ${sectionsHtml}

  <div class="doc-footer">
    <div>✨ Dokumen Dibuat Otomatis oleh <strong>AZURA Intelligence</strong></div>
    <div>Dicetak Secara Digital • Standar Industri A4</div>
  </div>
</body>
</html>
  `;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '16mm', left: '16mm', right: '16mm' }
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

/**
 * Render Native Formal Microsoft Word Document (.docx)
 * @param {object} docData 
 * @param {string} userName 
 * @returns {Promise<Buffer>}
 */
async function renderWordDocument(docData, userName = 'Pengguna') {
  const now = new Date();
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const children = [];

  // Title
  children.push(
    new Paragraph({
      text: docData.title || 'DOKUMEN RESMI',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 }
    })
  );

  // Subtitle
  if (docData.subtitle) {
    children.push(
      new Paragraph({
        text: docData.subtitle,
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [
          new TextRun({ text: docData.subtitle, italics: true, color: '64748B' })
        ]
      })
    );
  }

  // Metadata Table Box
  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `Disusun Untuk: ${userName}`, bold: true })] })]
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `Tanggal: ${dateStr}`, bold: true })] })]
          })
        ]
      })
    ]
  });
  children.push(metaTable);
  children.push(new Paragraph({ text: '', spacing: { after: 240 } }));

  // Sections
  (docData.sections || []).forEach((sec, idx) => {
    children.push(
      new Paragraph({
        text: `${idx + 1}. ${sec.heading}`,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 }
      })
    );

    if (sec.body) {
      const paragraphs = sec.body.split('\n\n');
      paragraphs.forEach(p => {
        children.push(
          new Paragraph({
            text: p,
            spacing: { after: 120 }
          })
        );
      });
    }

    if (sec.list && Array.isArray(sec.list)) {
      sec.list.forEach(item => {
        children.push(
          new Paragraph({
            text: item,
            bullet: { level: 0 },
            spacing: { after: 60 }
          })
        );
      });
    }

    if (sec.table && Array.isArray(sec.table) && sec.table.length > 0) {
      const tableRows = sec.table.map((row, rIdx) => {
        return new TableRow({
          children: row.map(cell => new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: cell, bold: rIdx === 0 })] })]
          }))
        });
      });

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: tableRows
        })
      );
      children.push(new Paragraph({ text: '', spacing: { after: 180 } }));
    }
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } // 1 inch margins
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: `${docData.category || 'AZURA Document'} • Confidential`, italics: true, size: 18, color: '94A3B8' })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: 'Halaman ', size: 18, color: '94A3B8' }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '94A3B8' })
                ]
              })
            ]
          })
        },
        children
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

/**
 * Main Controller for Generating & Packaging Document for Discord
 * @param {string} prompt 
 * @param {string} userName 
 * @returns {Promise<{ isDocumentRequest: boolean, payload?: any, error?: string }>}
 */
async function processDocumentGeneration(prompt, userName = 'Pengguna') {
  const req = parseDocumentGenRequest(prompt);
  if (!req.isDocRequest) return { isDocumentRequest: false };

  console.log(`[DocGen]: 📑 Processing Document Generation (${req.format?.toUpperCase()}) for "${req.topic}" requested by @${userName}...`);

  try {
    const docStructure = await generateDocumentStructure(req.topic, req.format, userName);
    const cleanFilenameBase = (docStructure.title || req.topic)
      .replace(/[^a-zA-Z0-9_\-\s]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 40);

    let buffer;
    let filename;
    let typeLabel;

    if (req.format === 'docx') {
      buffer = await renderWordDocument(docStructure, userName);
      filename = `${cleanFilenameBase}.docx`;
      typeLabel = 'Microsoft Word (.docx)';
    } else {
      buffer = await renderAestheticPdf(docStructure, userName);
      filename = `${cleanFilenameBase}.pdf`;
      typeLabel = 'Dokumen PDF Estetik (A4 Print-Ready)';
    }

    const attachment = new AttachmentBuilder(buffer, { name: filename });
    const sizeKb = (buffer.length / 1024).toFixed(1);

    const embed = new EmbedBuilder()
      .setColor(req.format === 'docx' ? 0x2B579A : 0x2B82EA)
      .setTitle(`📑 Dokumen Berhasil Dibuat: ${docStructure.title}`)
      .setDescription(
        `Halo **${userName}**! Dokumen permintaanmu telah selesai disusun dan dirender secara profesional.\n\n` +
        `📋 **Tipe Dokumen:** \`${typeLabel}\`\n` +
        `📦 **Ukuran File:** \`${sizeKb} KB\`\n` +
        `📂 **Nama File:** \`${filename}\`\n\n` +
        `*💡 Kamu bisa langsung mengunduh dan membuka file lampiran di atas.*`
      )
      .setFooter({ text: 'AZURA Document Engine • High Quality Output' })
      .setTimestamp();

    return {
      isDocumentRequest: true,
      payload: {
        embeds: [embed],
        files: [attachment]
      }
    };
  } catch (err) {
    console.error('[DocGen Error]:', err.message);
    return {
      isDocumentRequest: true,
      payload: `❌ Maaf ${userName}, terjadi kendala saat merender dokumen: ${err.message}`
    };
  }
}

module.exports = {
  parseDocumentGenRequest,
  generateDocumentStructure,
  renderAestheticPdf,
  renderWordDocument,
  processDocumentGeneration
};
