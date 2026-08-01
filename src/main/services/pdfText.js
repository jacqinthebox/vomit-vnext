// @ts-check
'use strict';

const fs = require('fs');

let pdfjsPromise = null;

async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

function normalizeExtractedPdfText(text) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdfText(filePath) {
  const { getDocument } = await getPdfjs();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (typeof item.str === 'string' ? item.str : ''))
        .filter(Boolean)
        .join(' ');
      pages.push(`--- Page ${pageNumber} ---\n${normalizeExtractedPdfText(pageText)}`);
    }

    const text = normalizeExtractedPdfText(pages.join('\n\n'));
    return text || '(PDF contains no extractable text)';
  } finally {
    if (typeof pdf.destroy === 'function') {
      await pdf.destroy();
    } else if (typeof pdf.cleanup === 'function') {
      await pdf.cleanup();
    }
    if (typeof loadingTask.destroy === 'function') {
      await loadingTask.destroy();
    }
  }
}

module.exports = { extractPdfText };
