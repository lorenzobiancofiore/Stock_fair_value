import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const stocks = [];
const IGNORE = ['.git', '.vercel', 'node_modules'];

/**
 * Estrae l'ultimo quarter di riferimento dal report HTML
 */
function extractQuarter(html) {
  const match = html.match(/Q\d\s+FY\d{4}/i);
  if (match) return match[0].toUpperCase();
  
  const hdrMatch = html.match(/Equity Narrative Analysis[^>]*>\s*Q\d\s+FY\d{4}/i);
  if (hdrMatch) {
    const q = hdrMatch[0].match(/Q\d\s+FY\d{4}/i);
    if (q) return q[0].toUpperCase();
  }
  return null;
}

/**
 * Estrae la data dell'ultima analisi dal report HTML
 */
function extractAnalysisDate(html) {
  const patterns = [
    /al\s+(\d{1,2}\s+\w+\s+\d{4})/i,
    /(\d{1,2}\s+\w+\s+\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Formatta la data in italiano
 */
function formatDate(dateStr) {
  if (!dateStr) return 'N/D';
  
  try {
    let date;
    if (dateStr.includes('/')) {
      date = new Date(dateStr);
    } else if (dateStr.includes('-') && dateStr.length === 10) {
      date = new Date(dateStr);
    } else {
      const months = {
        gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
        luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11
      };
      const parts = dateStr.toLowerCase().split(' ');
      if (parts.length === 3 && months[parts[1]] !== undefined) {
        date = new Date(parseInt(parts[2]), months[parts[1]], parseInt(parts[0]));
      }
    }
    
    if (date && !isNaN(date.getTime())) {
      return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  } catch (_) {}
  return dateStr;
}

const items = fs.readdirSync(rootDir, { withFileTypes: true });

items.forEach(item => {
  if (item.isDirectory() && !IGNORE.includes(item.name)) {
    try {
      const files = fs.readdirSync(path.join(rootDir, item.name));
      const simpleFile = files.find(f => f.toLowerCase().endsWith('-semplice.html'));
      const proFile = files.find(f => f.toLowerCase().endsWith('-pro.html'));
      
      if (simpleFile || proFile) {
        let quarter = null;
        let analysisDate = null;
        
        if (proFile) {
          const proPath = path.join(rootDir, item.name, proFile);
          const html = fs.readFileSync(proPath, 'utf-8');
          quarter = extractQuarter(html);
          const rawDate = extractAnalysisDate(html);
          analysisDate = formatDate(rawDate);
        }
        
        if (!analysisDate && simpleFile) {
          const simplePath = path.join(rootDir, item.name, simpleFile);
          const stats = fs.statSync(simplePath);
          analysisDate = stats.mtime.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
        }
        
        stocks.push({
          name: item.name,
          ticker: item.name.toUpperCase(),
          folder: item.name,
          simplePath: simpleFile ? `./${item.name}/${simpleFile}` : null,
          proPath: proFile ? `./${item.name}/${proFile}` : null,
          quarter: quarter,
          analysisDate: analysisDate
        });
      }
    } catch (_) {}
  }
});

// Ordina alfabeticamente per nome azienda
stocks.sort((a, b) => a.name.localeCompare(b.name, 'it'));

fs.writeFileSync(path.join(rootDir, 'stocks.json'), JSON.stringify(stocks, null, 2));
console.log(`✅ Manifest generato con successo! Trovate ${stocks.length} analisi.`);