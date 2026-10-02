import fs from 'fs/promises';
import path from 'path';

/**
 * Normalizza gli URL dei report: qualsiasi URL Blob diretto viene convertito
 * nell'endpoint proxy /api/report (che serve inline invece di scaricare).
 */
function normalizeUrls(report) {
  const ticker = (report.ticker || '').toUpperCase();
  const convert = (p, mode) => {
    if (!p) return p;
    const s = String(p);
    // URL Blob diretto → proxy inline
    if (s.includes('blob.vercel-storage.com')) {
      return `/api/report?ticker=${ticker}&mode=${mode}`;
    }
    return p;
  };
  return {
    ...report,
    simplePath: convert(report.simplePath, 'semplice'),
    proPath: convert(report.proPath, 'pro'),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // 1. Report statici (stocks.json nella cartella public/)
    let staticReports = [];
    try {
      const stocksPath = path.join(process.cwd(), 'public', 'stocks.json');
      const raw = await fs.readFile(stocksPath, 'utf-8');
      staticReports = JSON.parse(raw);
    } catch (e) {
      console.warn('stocks.json non trovato:', e.message);
    }

    // 2. Report generati dinamicamente (manifest su Vercel Blob)
    let generatedReports = [];
    try {
      const { getGeneratedManifest } = await import('../src/generator/manifest.js');
      generatedReports = await getGeneratedManifest();
    } catch (e) {
      console.warn('manifest non disponibile:', e.message);
    }

    // 3. Merge (i generati hanno priorità sul medesimo ticker)
    const byTicker = new Map();
    for (const r of staticReports) byTicker.set((r.ticker || '').toUpperCase(), r);
    for (const r of generatedReports) {
      const key = (r.ticker || '').toUpperCase();
      byTicker.set(key, { ...byTicker.get(key), ...r });
    }

    // 4. Normalizza URL (Blob → proxy inline)
    const merged = Array.from(byTicker.values())
      .map(normalizeUrls)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'it'));

    res.json(merged);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}