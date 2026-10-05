import { getFairValue, getFairValueHtmlSimple, getFairValueHtmlPro, getAccentColor } from '../fairvalue/client.js';
import { searchFinancialDocs, validateFreshness, searchNews, searchAnalystTargets, resolveCompanyName } from '../search/tavily.js';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import path from 'path';
import { generateNarrativeReport } from '../llm/openrouter.js';
import { generateAndSave } from '../generator/writer.js';
import { addToManifest } from '../generator/manifest.js';
import { normalizeTicker, toYahooFinanceFormat, DEFAULT_EXCHANGE } from '../utils/ticker.js';

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
 * Matcha esattamente lo schema dei template (simple + pro)
 */
function createFallbackNarrative(companyName, ticker, fairValue) {
  const cur = fairValue?.currency === 'USD' ? '$' : (fairValue?.currency || '');
  const cp = fairValue?.current_price ? `${cur}${fairValue.current_price}` : 'N/D';
  const iv = fairValue?.primary_iv ? `${cur}${fairValue.primary_iv}` : 'N/D';
  const ms = fairValue?.margin_of_safety != null ? `${(fairValue.margin_of_safety * 100).toFixed(0)}%` : 'N/D';
  const grade = fairValue?.grade || 'N/D';

  return {
    badges: {
      positive: grade === 'A' || grade === 'B' ? 'Qualità' : '',
      negative: grade === 'D' || grade === 'F' ? 'Attenzione' : '',
      mixed: 'Fair Value'
    },
    simple: {
      execSummary: {
        label: 'Qualità a sconto',
        text: `Analisi di ${companyName} (${ticker}). Prezzo ${cp}, Fair Value ${iv}, margine ${ms}. Grade ${grade}.`
      },
      growth: {
        period: 'N/D',
        metrics: [],
        plainExplanation: 'Dati non disponibili senza LLM.',
        guidance: []
      },
      scenarios: {
        intro: 'Scenari basati solo sul Fair Value.',
        bull: { label: 'Bull', headline: 'Ottimistico', price: 'N/D', text: 'Scenario rialzista non disponibile.' },
        base: { label: 'Base', headline: 'Fair Value', price: iv, text: 'Scenario base: Fair Value.' },
        bear: { label: 'Bear', headline: 'Pessimistico', price: 'N/D', text: 'Scenario ribassista non disponibile.' }
      },
      valuationIntro: `Valutazione basata su ${fairValue?.recommended_method || 'metodo proprietario'}.`,
      scale: { bear: 'N/D', base: iv, bull: 'N/D', current: cp },
      legends: { bear: 'Scenario pessimistico', base: 'Fair Value', bull: 'Scenario ottimistico' },
      qa: { question: 'Qual è il margine di sicurezza?', answer: ms }
    },
    pro: {
      executiveSummary: `Analisi di ${companyName} (${ticker}). Report generato con dati fair value ma senza narrative LLM.`,
      thesisLabel: 'Sintesi qualitativa',
      kpis: [
        { label: 'Prezzo attuale', value: cp, sub: 'Quotazione di mercato', highlight: false },
        { label: 'Fair Value', value: iv, sub: fairValue?.recommended_method || 'Valore intrinseco', highlight: true },
        { label: 'Margine di sicurezza', value: ms, sub: 'Sconto vs fair value', highlight: ms !== 'N/D' && parseFloat(ms) > 0 },
        { label: 'ROIC', value: fairValue?.roic ? `${(fairValue.roic * 100).toFixed(1)}%` : 'N/D', sub: 'Ritorno sul capitale investito', highlight: false },
        { label: 'P/E Forward', value: fairValue?.forward_pe ? fairValue.forward_pe.toFixed(1) : 'N/D', sub: 'Prezzo / Utili attesi', highlight: false },
        { label: 'Dividend Yield', value: fairValue?.dividend_yield ? `${(fairValue.dividend_yield * 100).toFixed(1)}%` : 'N/D', sub: 'Rendimento da dividendo', highlight: false }
      ],
      verdictLine: `Grade ${grade} - ${ms !== 'N/D' ? parseFloat(ms) > 0 ? 'sottovalutato' : 'sopravvalutato' : 'in linea'}`,
      marketCards: [
        { label: 'Prezzo attuale', value: cp, sub: 'Market price', up: true, extra: '' },
        { label: 'Fair Value', value: iv, sub: 'Intrinsic value', up: false, extra: '' },
        { label: 'Margine sicurezza', value: ms, sub: 'Discount to FV', up: true, extra: '' },
        { label: 'Grade', value: grade, sub: 'Quality score', up: true, extra: '' }
      ],
      finTable: { headers: ['Metrica', 'Valore'], rows: [], factBlocks: [] },
      qoe: { warningTitle: 'N/D', warningText: 'Dati non disponibili', factBlocks: [] },
      mixCards: [],
      news: [],
      catalysts: [],
      scenarios: {
        bull: { range: 'N/D', assumptions: 'N/D', valuation: 'N/D' },
        base: { range: 'N/D', assumptions: 'Fair Value', valuation: iv },
        bear: { range: 'N/D', assumptions: 'N/D', valuation: 'N/D' }
      },
      valTable: { headers: ['Metodo', 'Valore'], rows: [], factBlocks: [] },
      risks: [],
      finalThesis: {
        label: 'Verdetto finale',
        text: `Analisi basata su Fair Value (${fairValue?.recommended_method || 'N/D'}). Grade ${grade}.`,
        works: [],
        worries: [],
        verdict: 'Dati LLM non disponibili.',
        pills: [{ label: `Grade ${grade}`, bg: '#1e2230', border: '#7c3aed' }]
      }
    }
  };
}
/**
 * Esegue l'analisi completa per un ticker (Fasi 0-5)
 * @param {string} ticker - ticker inserito dall'utente (es. "AAPL", "ENEL")
 * @param {string} exchange - codice borsa (es. "US-NY", "IT-MI"); default US-NY
 */
export async function runAnalysis(ticker, exchange = DEFAULT_EXCHANGE) {
  const startTime = Date.now();
  const report = { ticker, exchange, steps: [], warnings: [] };

  // Converte nel formato Yahoo Finance riconosciuto da fairvalue-api
  const yfTicker = toYahooFinanceFormat(ticker, exchange);

  console.log(`\n🚀 Starting analysis for ${ticker} (${exchange}) → Yahoo: ${yfTicker}...`);
  
  try {
    // FASE 0: Risolvi nome azienda (alias rapido)
    console.log(`📌 Fase 0: Risoluzione nome azienda...`);
    let companyName = yfTicker;
    try { 
      companyName = await resolveCompany(yfTicker);
    } catch { }
    report.steps.push({ fase: 0, status: 'ok', companyName });
    console.log(`   → (pre-FV) Company: ${companyName?.substring(0, 60)}`);

    // FASE 1: Documenti finanziari di base
    console.log(`📌 Fase 1: Raccolta documenti finanziari...`);
    try {
      const financialDocs = await searchFinancialDocs(yfTicker, companyName);
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
      const freshness = await validateFreshness(yfTicker, companyName);
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
      const newsResults = await searchNews(yfTicker, companyName);
      report.newsResults = newsResults;
      report.steps.push({ fase: 2, status: 'ok', count: newsResults.length });
    } catch (e) {
      report.warnings.push(`Fase 2: ${e.message}`);
      report.steps.push({ fase: 2, status: 'warning', error: e.message });
    }

    // Target analisti
    let analystTargets = null;
    try {
      analystTargets = await searchAnalystTargets(yfTicker);
      report.analystTargets = analystTargets;
    } catch (e) {
      report.warnings.push(`Analyst targets: ${e.message}`);
    }

    // FASE 2C: Fair Value API
    console.log(`📌 Fase 2C: Chiamata Fair Value API...`);
    let fairValue = null;
    let fairValueHtmlSimple = '';
    let fairValueHtmlPro = '';
    const accent = getAccentColor(yfTicker);

    try {
      fairValue = await getFairValue(yfTicker);
      report.fairValue = fairValue;
      report.steps.push({ fase: '2C', status: 'ok', method: fairValue.recommended_method });

      // Usa il nome ufficiale dalla Fair Value API
      if (fairValue.company_name) {
        companyName = fairValue.company_name;
        report.companyName = companyName;
        console.log(`   → (FV) Company: ${companyName}`);
      }

      try {
        fairValueHtmlSimple = await getFairValueHtmlSimple(yfTicker, accent);
        fairValueHtmlPro = await getFairValueHtmlPro(yfTicker, accent);
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
        ticker: yfTicker,
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
      narrative = createFallbackNarrative(companyName, yfTicker, fairValue);
    }

    // FASE 5: Genera e salva due file HTML
    console.log(`📌 Fase 5: Generazione file HTML...`);
    let files;
    try {
      files = await generateAndSave(
        yfTicker, companyName, narrative,
        fairValueHtmlSimple, fairValueHtmlPro, accent, fairValue, latestReportedQuarter
      );
      report.files = files;
      report.steps.push({ fase: 5, status: 'ok', simplePath: files.simpleUrl, proPath: files.proUrl });
    } catch (e) {
      report.warnings.push(`Fase 5: ${e.message}`);
      report.steps.push({ fase: 5, status: 'error', error: e.message });
      throw e; // senza file generati non c'è report: propaga al catch esterno
    }

    // Registra il report nel manifest (Blob su Vercel, disco in locale)
    try {
      const now = new Date();
      const analysisDate = now.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
      await addToManifest({
        name: companyName,
        ticker: yfTicker,
        folder: normalizeTicker(yfTicker),
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
      success: true, ticker: yfTicker, companyName, exchange,
      folder: normalizeTicker(yfTicker), elapsed: `${elapsed}s`, ...files,
      warnings: report.warnings, steps: report.steps,
    };
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.error(`\n❌ Analisi fallita per ${ticker} dopo ${elapsed}s:`, error.message);
    return {
      success: false, ticker: yfTicker,
      error: error.message, elapsed: `${elapsed}s`,
      warnings: report.warnings, steps: report.steps,
    };
  }
}