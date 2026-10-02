import { getFairValue, getFairValueHtmlSimple, getFairValueHtmlPro, getAccentColor } from '../fairvalue/client.js';
import { searchFinancialDocs, validateFreshness, searchNews, searchAnalystTargets, resolveCompanyName } from '../search/tavily.js';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import path from 'path';
import { generateNarrativeReport } from '../llm/openrouter.js';
import { generateAndSave } from '../generator/writer.js';
import { addToManifest } from '../generator/manifest.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // sale a Stock_fair_value/

function regenerateManifest() {
  return new Promise((resolve) => {
    const child = spawn('node', ['generate-manifest.js'], { cwd: PROJECT_ROOT });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('close', (code) => {
      if (code === 0) console.log('✅ Manifest aggiornato');
      else console.warn(`⚠️  Manifest non aggiornato (exit ${code})`);
      resolve();
    });
  });
}

/**
 * Fase 0: Risoluzione nome azienda da ticker
 */
async function resolveCompany(ticker) {
  try {
    const companyName = await resolveCompanyName(ticker);
    return companyName || ticker;
  } catch (e) {
    console.warn('Could not resolve company name, using ticker:', ticker);
    return ticker;
  }
}

/**
 * Genera fallback narrative quando LLM non risponde
 */
function createFallbackNarrative(companyName, ticker, fairValue) {
  return {
    executiveSummary: `Analisi di ${companyName} (${ticker}). Report generato con dati fair value ma senza narrative LLM.`,
    marketSnapshot: {
      currentPrice: fairValue?.current_price?.toString() || 'N/D',
      priceChange1m: 'N/D',
      priceChange3m: 'N/D',
      analystConsensus: 'N/D',
      keyMetrics: { revenue: 'N/D', eps: 'N/D', fcf: 'N/D' }
    },
    financialAnalysis: {
      revenue: { fact: 'Dati non disponibili', neutral: '', bullish: '', valuationImplication: '' },
      margins: { fact: 'Dati non disponibili', neutral: '', bullish: '', valuationImplication: '' },
      cashFlow: { fact: 'Dati non disponibili', neutral: '', bullish: '', valuationImplication: '' },
      balanceSheet: { fact: 'Dati non disponibili', neutral: '', bullish: '', valuationImplication: '' }
    },
    earningsQuality: { nonRecurring: '', accountingRisks: '', fact: '', neutral: '', bullish: '', valuationImplication: '' },
    businessMix: { segments: [], concentration: '', fact: '', neutral: '', bullish: '', valuationImplication: '' },
    newsNarrative: [],
    catalystCalendar: [],
    scenarios: {
      bull: { priceTarget: 'N/D', narrative: 'Scenario rialzista non disponibile.', probability: 33 },
      base: { priceTarget: fairValue?.current_price?.toString() || 'N/D', narrative: 'Scenario base non disponibile.', probability: 34 },
      bear: { priceTarget: 'N/D', narrative: 'Scenario ribassista non disponibile.', probability: 33 }
    },
    valuationFramework: {
      method: fairValue?.recommended_method || 'N/D',
      primaryIV: fairValue?.primary_iv?.toString() || 'N/D',
      buyPrice: fairValue?.primary_buy_price?.toString() || 'N/D',
      sellPrice: fairValue?.primary_sell_price?.toString() || 'N/D',
      reconciliation: 'Riconciliazione non disponibile.'
    },
    keyRisks: [],
    finalVerdict: {
      rating: fairValue?.grade ? `${fairValue.grade}` : 'N/D',
      summary: `Analisi basata esclusivamente sul modello di Fair Value.`,
      whatWouldChangeMind: 'N/D'
    },
    simpleMode: {
      growing: { metrics: [], explanation: '' },
      whatCanHappen: {
        bull: { title: 'Bull', target: 'N/D', text: '' },
        base: { title: 'Base', target: fairValue?.current_price?.toString() || 'N/D', text: '' },
        bear: { title: 'Bear', target: 'N/D', text: '' }
      },
      valuation: { currentPrice: fairValue?.current_price?.toString() || 'N/D', bear: 'N/D', base: 'N/D', bull: 'N/D', explanation: '' },
      fairValueSummary: ''
    }
  };
}
/**
 * Esegue l'analisi completa per un ticker (Fasi 0-5)
 */
export async function runAnalysis(ticker) {
  const startTime = Date.now();
  const report = { ticker, steps: [], warnings: [] };
  
  console.log(`\n🚀 Starting analysis for ${ticker}...`);
  
  try {
    // FASE 0: Risolvi nome azienda (alias rapido)
    console.log(`📌 Fase 0: Risoluzione nome azienda...`);
    let companyName = ticker.toUpperCase();
    try { 
      companyName = await resolveCompany(ticker);
    } catch { }
    report.steps.push({ fase: 0, status: 'ok', companyName });
    console.log(`   → (pre-FV) Company: ${companyName?.substring(0, 60)}`);

    // FASE 1: Documenti finanziari di base
    console.log(`📌 Fase 1: Raccolta documenti finanziari...`);
    try {
      const financialDocs = await searchFinancialDocs(ticker.toUpperCase(), companyName);
      report.financialDocs = financialDocs;
      report.steps.push({ fase: 1, status: 'ok', count: financialDocs.length });
    } catch (e) {
      report.warnings.push(`Fase 1: ${e.message}`);
      report.steps.push({ fase: 1, status: 'warning', error: e.message });
    }

    // FASE 1B: Validazione freschezza + ricerca ultimo quarter pubblicato
    console.log(`📌 Fase 1B: Validazione freschezza dati...`);
    let latestReportedQuarter = null;
    try {
      const freshness = await validateFreshness(ticker.toUpperCase(), companyName);
      report.freshness = freshness;
      report.steps.push({ fase: '1B', status: 'ok', count: freshness.length });

      // Cerca il quarter più recente dai risultati di validazione
      for (const result of freshness) {
        if (result.answer) {
          // Pattern 1: "Q3 2026" o "Q3 FY2026"
          const m1 = result.answer.match(/[Qq](\d)[,.]?\s*(?:FY)?\s*(\d{4})/i);
          if (m1) {
            latestReportedQuarter = `Q${m1[1]} FY${m1[2]}`;
            break;
          }
          // Pattern 2: "for quarter ended [date]" o "last reported earnings [date]"
          const m2 = result.answer.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i);
          if (m2) {
            const monthMap = {january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
            const monthNum = monthMap[m2[1].toLowerCase()];
            const fy = monthNum >= 10 ? parseInt(m2[3]) + 1 : parseInt(m2[3]);
            const q = Math.ceil(((monthNum + 12 - 10) % 12 + 1) / 3);
            latestReportedQuarter = `Q${q} FY${fy}`;
            break;
          }
          // Pattern 3: "Q3 2026 earnings" (variante)
          const m3 = result.answer.match(/[Qq](\d)\s+(\d{4})\s+earnings/i);
          if (m3) {
            latestReportedQuarter = `Q${m3[1]} FY${m3[2]}`;
            break;
          }
        }
      }
      if (latestReportedQuarter) console.log(`   → Ultimo quarter riportato: ${latestReportedQuarter}`);
    } catch (e) {
      report.warnings.push(`Fase 1B: ${e.message}`);
      report.steps.push({ fase: '1B', status: 'warning', error: e.message });
    }

    // FASE 2: Notizie narrative
    console.log(`📌 Fase 2: Raccolta notizie narrative...`);
    try {
      const newsResults = await searchNews(ticker.toUpperCase(), companyName);
      report.newsResults = newsResults;
      report.steps.push({ fase: 2, status: 'ok', count: newsResults.length });
    } catch (e) {
      report.warnings.push(`Fase 2: ${e.message}`);
      report.steps.push({ fase: 2, status: 'warning', error: e.message });
    }

    // Target analisti
    let analystTargets = null;
    try {
      analystTargets = await searchAnalystTargets(ticker.toUpperCase());
      report.analystTargets = analystTargets;
    } catch (e) {
      report.warnings.push(`Analyst targets: ${e.message}`);
    }

    // FASE 2C: Fair Value API
    console.log(`📌 Fase 2C: Chiamata Fair Value API...`);
    let fairValue = null;
    let fairValueHtmlSimple = '';
    let fairValueHtmlPro = '';
    const accent = getAccentColor(ticker);

    try {
      fairValue = await getFairValue(ticker.toUpperCase());
      report.fairValue = fairValue;
      report.steps.push({ fase: '2C', status: 'ok', method: fairValue.recommended_method });

      // Usa il nome ufficiale dalla Fair Value API
      if (fairValue.company_name) {
        companyName = fairValue.company_name;
        report.companyName = companyName;
        console.log(`   → (FV) Company: ${companyName}`);
      }

      try {
        fairValueHtmlSimple = await getFairValueHtmlSimple(ticker.toUpperCase(), accent);
        fairValueHtmlPro = await getFairValueHtmlPro(ticker.toUpperCase(), accent);
      } catch (e) {
        report.warnings.push(`Fair Value HTML snippets: ${e.message}`);
        const fb = `<div class="card"><p style="color:var(--bear)">⚠️ Snippet HTML non disponibili: ${e.message}</p></div>`;
        fairValueHtmlSimple = fb;
        fairValueHtmlPro = fb;
      }
    } catch (e) {
      report.warnings.push(`Fase 2C: ${e.message}`);
      report.steps.push({ fase: '2C', status: 'error', error: e.message });
      const errHtml = `<div class="card" style="border-left:3px solid var(--bear)"><div class="lbl" style="color:var(--bear)">FAIR VALUE NON DISPONIBILE</div><p style="color:var(--text);margin-top:10px">Il modello di fair value non &egrave; riuscito a calcolare ${ticker}. Motivo: ${e.message}.</p></div>`;
      fairValueHtmlSimple = errHtml;
      fairValueHtmlPro = errHtml;
    }

    // FASE 3-4: LLM genera report narrativo
    console.log(`📌 Fase 3-4: Generazione report narrativo con LLM...`);
    let narrative = null;
    try {
      narrative = await generateNarrativeReport({
        ticker: ticker.toUpperCase(),
        companyName,
        fairValue: fairValue || {},
        searchResults: report.financialDocs || [],
        newsResults: report.newsResults || [],
        analystTargets: analystTargets || {},
      });
      report.narrative = narrative;
      report.steps.push({ fase: '3-4', status: 'ok' });
    } catch (e) {
      report.warnings.push(`Fase 3-4: ${e.message}`);
      report.steps.push({ fase: '3-4', status: 'error', error: e.message });
      narrative = createFallbackNarrative(companyName, ticker.toUpperCase(), fairValue);
    }

    // FASE 5: Genera e salva due file HTML
    console.log(`📌 Fase 5: Generazione file HTML...`);
    const files = await generateAndSave(
      ticker.toUpperCase(), companyName, narrative,
      fairValueHtmlSimple, fairValueHtmlPro, accent, fairValue, latestReportedQuarter
    );
    report.files = files;
    report.steps.push({ fase: 5, status: 'ok', simplePath: files.simpleUrl, proPath: files.proUrl });

    // Registra il report nel manifest (Blob su Vercel, disco in locale)
    try {
      const now = new Date();
      const analysisDate = now.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
      await addToManifest({
        name: companyName,
        ticker: ticker.toUpperCase(),
        folder: ticker.toLowerCase(),
        simplePath: files.simpleUrl,
        proPath: files.proUrl,
        quarter: latestReportedQuarter || null,
        analysisDate,
      });
    } catch (e) {
      report.warnings.push(`Manifest: ${e.message}`);
    }

    if (!process.env.VERCEL) await regenerateManifest(); // Aggiorna stocks.json (solo locale)

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n✅ Analisi completata in ${elapsed}s per ${ticker}`);
    console.log(`   Semplice: ${files.simpleUrl}`);
    console.log(`   Pro: ${files.proUrl}`);

    return {
      success: true, ticker: ticker.toUpperCase(), companyName,
      elapsed: `${elapsed}s`, ...files,
      warnings: report.warnings, steps: report.steps,
    };
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.error(`\n❌ Analisi fallita per ${ticker} dopo ${elapsed}s:`, error.message);
    return {
      success: false, ticker: ticker.toUpperCase(),
      error: error.message, elapsed: `${elapsed}s`,
      warnings: report.warnings, steps: report.steps,
    };
  }
}