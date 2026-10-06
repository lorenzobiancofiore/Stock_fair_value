import fs from 'fs/promises';
import path from 'path';
import Handlebars from 'handlebars';
import { normalizeTicker } from '../utils/ticker.js';
import { buildExecData } from './exec.js';

let vercelBlob = null;
try {
  vercelBlob = await import('@vercel/blob');
} catch (e) {
  // @vercel/blob non disponibile (ambiente locale)
}

const cssPartial = await fs.readFile(new URL('../templates/shared.css.hbs', import.meta.url), 'utf-8');
const headerPartial = await fs.readFile(new URL('../templates/shared.header.hbs', import.meta.url), 'utf-8');
Handlebars.registerPartial('shared.css', cssPartial);
Handlebars.registerPartial('shared.header', headerPartial);
const chartPartial = await fs.readFile(new URL('../templates/shared.chart.hbs', import.meta.url), 'utf-8');
Handlebars.registerPartial('shared.chart', chartPartial);
const fairvaluePartial = await fs.readFile(new URL('../templates/fairvalue.hbs', import.meta.url), 'utf-8');
Handlebars.registerPartial('fairvalue', fairvaluePartial);

// ===== Fair Value: formattazione e confronto metodi =====
function fvMoney(v, cur) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/D';
  const sym = cur === 'USD' ? '$' : (cur || '');
  return `${sym}${Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fvPctSigned(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'N/D';
  const p = Number(v) * 100;
  return `${p >= 0 ? '+' : ''}${p.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
}

/**
 * Motivazione della scelta del metodo primario (DCF growth vs Buffett Owner Earnings)
 */
function fvReason(fv) {
  if (!fv) return '';
  const method = fv.recommended_method || 'N/D';
  const capex = fv.capex_ratio != null ? `${(fv.capex_ratio * 100).toLocaleString('it-IT', { maximumFractionDigits: 0 })}%` : 'N/D';
  const growth = fv.growth_rate != null ? `${(fv.growth_rate * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%` : 'N/D';
  if (/dcf/i.test(method)) {
    return `Modello a due stadi selezionato perché l'azienda ha intensità di capitale elevata (CapEx/OCF ${capex}, sopra la soglia del 40%) e crescita stimata ${growth}: cattura sia la fase di crescita rapida sia la transizione a maturità.`;
  }
  if (/buffett|owner/i.test(method)) {
    return `Modello Owner Earnings di Buffett selezionato perché l'azienda ha intensità di capitale contenuta (CapEx/OCF ${capex}) e flussi di cassa stabili e prevedibili, tipici di un business maturo.`;
  }
  return `Metodo selezionato automaticamente dal modello in base al profilo dell'azienda.`;
}

/**
 * Prepara i dati per il partial di confronto metodi Fair Value
 */
function computeFvDisplay(fv) {
  if (!fv) return null;
  const cur = fv.currency || '';
  const mk = (iv, buy, sell, up) => ({
    iv: fvMoney(iv, cur), buy: fvMoney(buy, cur), sell: fvMoney(sell, cur),
    upside: fvPctSigned(up),
    upsideUp: Number(up) >= 0,
  });
  return {
    currency: cur,
    recommended: fv.recommended_method || 'N/D',
    reason: fvReason(fv),
    isGrowth: !!fv.is_growth_stock,
    buffett: mk(fv.buffett_iv, fv.buffett_buy_price, fv.buffett_sell_price, fv.buffett_upside),
    dcf: mk(fv.growth_dcf_iv, fv.growth_dcf_buy_price, fv.growth_dcf_sell_price, fv.growth_dcf_upside),
    primary: mk(fv.primary_iv, fv.primary_buy_price, fv.primary_sell_price, fv.primary_upside),
    currentPrice: fvMoney(fv.current_price, cur),
  };
}

function sanitizeName(name, fv) {
  if (!name) return fv?.company_name || 'N/D';
  if (name.includes('stock') || name.includes('trading') || name.includes('market cap') || name.length > 80) return fv?.company_name || name.substring(0, 50);
  return name;
}

function computeScalePositions(scale) {
  if (!scale?.bear || !scale?.bull) return { ...scale, basePos: 50, currentPos: 50, bearHigh: '', baseLow: '', baseHigh: '', bullLow: '', bullHigh: '' };
  const b = parseFloat(String(scale.bear).replace(/[$€£]/g,'')) || 0;
  const m = parseFloat(String(scale.base).replace(/[$€£]/g,'')) || 0;
  const l = parseFloat(String(scale.bull).replace(/[$€£]/g,'')) || 0;
  const c = parseFloat(String(scale.current).replace(/[$€£]/g,'')) || 0;
  const range = l - b;
  const basePos = range > 0 ? ((m - b) / range * 100) : 50;
  const currentPos = range > 0 ? ((c - b) / range * 100) : 50;
  const sp = (l - m) * 0.3;
  return { ...scale, basePos, currentPos, bearHigh: Math.round((b + (m - b) * 0.3) * 100) / 100, baseLow: Math.round((m - sp) * 100) / 100, baseHigh: Math.round((m + sp) * 100) / 100, bullLow: Math.round((l - (l - m) * 0.3) * 100) / 100, bullHigh: Math.round((l + (l - m) * 0.3) * 100) / 100 };
}

function computeBadges(fv) {
  const upside = fv?.primary_upside;
  const grade = fv?.grade;
  const b = { positive: '', negative: '', mixed: '' };
  if (upside !== undefined && upside < -0.3) b.negative = 'Sopravvalutato';
  else if (upside !== undefined && upside > 0.1) b.positive = 'Sottovalutato';
  else if (upside !== undefined) b.mixed = 'Fair Price';
  if (grade === 'A' || grade === 'B') b.positive = ((b.positive || '') + ' Grade ' + grade).trim();
  else if (grade === 'D' || grade === 'F') b.negative = ((b.negative || '') + ' Grade ' + grade).trim();
  else if (grade) b.mixed = ((b.mixed || '') + ' Grade ' + grade).trim();
  return b;
}

/**
 * Ultimo quarter effettivamente riportato (da search web)
 * Se data non disponibile, usa fallback calendar-based
 * Accetta: "Q3 FY2026" (già quarter) o "July 30, 2026" (data)
 */
function computeQuarter(now, latestReportedQuarter) {
  if (latestReportedQuarter) {
    // Se è già un quarter valido (formato Q\d FY\d{4}), usalo direttamente
    if (/^Q\d\s+FY\d{4}$/i.test(latestReportedQuarter)) {
      const q = parseInt(latestReportedQuarter.match(/\d+/)[0]);
      const fy = parseInt(latestReportedQuarter.match(/\d{4}/)[0]);
      return `Q${q} FY${fy}`;
    }
    // Altrimenti prova a parsare come data
    const d = new Date(latestReportedQuarter);
    if (!Number.isNaN(d.getTime())) {
      const month = d.getMonth() + 1;
      const fy = month >= 10 ? d.getFullYear() + 1 : d.getFullYear();
      const q = Math.ceil(((month + 12 - 10) % 12 + 1) / 3);
      return `Q${q} FY${fy}`;
    }
  }
  // Fallback: da data corrente
  const month = now.getMonth() + 1;
  const fy = month >= 10 ? now.getFullYear() + 1 : now.getFullYear();
  const q = Math.ceil(((month + 12 - 10) % 12 + 1) / 3);
  return `Q${q} FY${fy}`;
}

function isBlobEnabled() {
  return Boolean(vercelBlob?.put && process.env.BLOB_READ_WRITE_TOKEN);
}

function otherModeUrl(ticker, mode) {
  if (isBlobEnabled()) {
    return `/api/report?ticker=${ticker.toUpperCase()}&mode=${mode}`;
  }
  const tl = normalizeTicker(ticker);
  return `${tl}-${mode}.html`;
}

function prepareSimpleData(ticker, companyName, narrative, fvHtmlSimple, accent, fv, latestReportedQuarter) {
  const tl = normalizeTicker(ticker);
  const now = new Date();
  const today = now.toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' });
  const q = computeQuarter(now, latestReportedQuarter);
  const badges = narrative?.badges || computeBadges(fv);
  const scale = computeScalePositions(narrative?.simple?.scale || {});
  return {
    ticker: ticker.toUpperCase(), companyName, exchange: 'Borsa', quarter: q, date: today,
    badgePositive: badges.positive || '', badgeNegative: badges.negative || '', badgeMixed: badges.mixed || '',
    currentModeIcon: '📄', currentModeLabel: 'Semplice', otherFile: otherModeUrl(ticker, 'pro'),
    otherModeIcon: '📊', otherModeLabel: 'Pro', accent, accentHover: accent,
    growing: narrative?.simple?.growth || narrative?.simple?.growing || {}, scenarios: narrative?.simple?.scenarios || {},
    valuationIntro: narrative?.simple?.valuationIntro || '',
    scale, legends: narrative?.simple?.legends || {},
    qa: narrative?.simple?.qa || null, fairValueHtmlSimple: fvHtmlSimple,
    fvDisplay: computeFvDisplay(fv),
  };
}

function prepareProData(ticker, companyName, narrative, fvHtmlPro, accent, fv, latestReportedQuarter) {
  const tl = normalizeTicker(ticker);
  const now = new Date();
  const today = now.toLocaleDateString('it-IT', { year: 'numeric', month: 'long', day: 'numeric' });
  const q = computeQuarter(now, latestReportedQuarter);
  const badges = narrative?.badges || computeBadges(fv);
  const pro = narrative?.pro || {};
  return {
    ticker: ticker.toUpperCase(), companyName, exchange: 'Borsa', quarter: q, date: today,
    badgePositive: badges.positive || '', badgeNegative: badges.negative || '', badgeMixed: badges.mixed || '',
    currentModeIcon: '📊', currentModeLabel: 'Pro', otherFile: otherModeUrl(ticker, 'semplice'),
    otherModeIcon: '📄', otherModeLabel: 'Semplice', accent, accentHover: accent,
    ...pro, fairValueHtmlPro: fvHtmlPro,
    fvDisplay: computeFvDisplay(fv),
  };
}

/**
 * Salva i report: su Vercel Blob se disponibile, altrimenti su filesystem locale
 */
async function saveReports(ticker, simpleHtml, proHtml) {
  const tickerLower = ticker.toLowerCase().replace(/\./g, '-');
  const simplePath = `${tickerLower}/${tickerLower}-semplice.html`;
  const proPath = `${tickerLower}/${tickerLower}-pro.html`;

  // Vercel Blob (produzione)
  if (isBlobEnabled()) {
    const [simpleResult, proResult] = await Promise.all([
      vercelBlob.put(simplePath, simpleHtml, { access: 'public', contentType: 'text/html; charset=utf-8', allowOverwrite: true }),
      vercelBlob.put(proPath, proHtml, { access: 'public', contentType: 'text/html; charset=utf-8', allowOverwrite: true })
    ]);
    return {
      // URL pubblici serviti inline tramite proxy /api/report
      simpleUrl: `/api/report?ticker=${ticker.toUpperCase()}&mode=semplice`,
      proUrl: `/api/report?ticker=${ticker.toUpperCase()}&mode=pro`,
      simpleBlobUrl: simpleResult.url,
      proBlobUrl: proResult.url,
      simplePathname: simplePath,
      proPathname: proPath
    };
  }

  // Filesystem locale (sviluppo)
  const outputDir = path.resolve(process.env.OUTPUT_DIR || '.', tickerLower);
  await fs.mkdir(outputDir, { recursive: true });
  const simpleLocal = path.join(outputDir, `${tickerLower}-semplice.html`);
  const proLocal = path.join(outputDir, `${tickerLower}-pro.html`);
  await fs.writeFile(simpleLocal, simpleHtml, 'utf-8');
  await fs.writeFile(proLocal, proHtml, 'utf-8');
  console.log(`✅ Written locally: ${simpleLocal}`);
  console.log(`✅ Written locally: ${proLocal}`);
  return {
    simpleUrl: `/${tickerLower}/${tickerLower}-semplice.html`,
    proUrl: `/${tickerLower}/${tickerLower}-pro.html`,
    simplePathname: simpleLocal,
    proPathname: proLocal
  };
}

export async function generateAndSave(ticker, companyName, narrative, fvHtmlSimple, fvHtmlPro, accent, fv, latestReportedQuarter) {
  const tickerLower = normalizeTicker(ticker);
  const cleanName = sanitizeName(companyName, fv);
  
  const simpleSrc = await fs.readFile(new URL('../templates/simple.hbs', import.meta.url), 'utf-8');
  const proSrc = await fs.readFile(new URL('../templates/pro.hbs', import.meta.url), 'utf-8');
  const simpleTmpl = Handlebars.compile(simpleSrc);
  const proTmpl = Handlebars.compile(proSrc);
  
  const simpleData = prepareSimpleData(ticker, cleanName, narrative, fvHtmlSimple, accent, fv, latestReportedQuarter);
  const proData = prepareProData(ticker, cleanName, narrative, fvHtmlPro, accent, fv, latestReportedQuarter);
  Object.assign(simpleData, buildExecData(ticker, fv, narrative, 'simple'));
  Object.assign(proData, buildExecData(ticker, fv, narrative, 'pro'));
  
  const simpleHtml = simpleTmpl(simpleData);
  const proHtml = proTmpl(proData);
  
  // Salva (Blob su Vercel, disco in locale)
  const blobResult = await saveReports(ticker, simpleHtml, proHtml);

  console.log(`✅ Report salvati: ${blobResult.simpleUrl}`);
  console.log(`✅ Report salvati: ${blobResult.proUrl}`);
  
  return {
    simpleUrl: blobResult.simpleUrl,
    proUrl: blobResult.proUrl,
    simpleBlobUrl: blobResult.simpleBlobUrl || blobResult.simpleUrl,
    proBlobUrl: blobResult.proBlobUrl || blobResult.proUrl,
    simplePathname: blobResult.simplePathname,
    proPathname: blobResult.proPathname
  };
}