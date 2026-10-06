import { config } from '../config.js';

const BASE_URL = config.openRouter.baseUrl;
const API_KEY = config.openRouter.apiKey;
const PRIMARY_MODEL = config.openRouter.model;
const RESEARCH_MODEL = config.openRouter.researchModel;
const WRITER_MODEL = config.openRouter.writerModel;
const FALLBACK_MODELS = config.openRouter.fallbackModels;
const MAX_RETRIES = 2;

// Modelli "reasoning" (consumano token extra) a cui conviene abbassare l'effort
function isReasoningModel(m) {
  return /deepseek|nemotron|r1|reason/i.test(m);
}

async function chat(messages, options = {}) {
  const { model, temperature = 0.3, maxTokens = 6000, responseFormat, retryOnLength = true, tools, allowFallback = true } = options;
  const modelList = allowFallback
    ? [model || PRIMARY_MODEL, ...FALLBACK_MODELS]
    : [model || PRIMARY_MODEL];

  let lastError = null;

  for (const m of modelList) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const body = { model: m, messages, temperature, max_tokens: maxTokens };
        if (responseFormat) body.response_format = responseFormat;
        if (tools && tools.length) body.tools = tools;
        // Riduci il reasoning solo per modelli che lo supportano (DeepSeek, Nemotron, R1)
        if (isReasoningModel(m)) body.reasoning = { effort: 'low' };

        const response = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/equity-research-hub',
            'X-Title': 'Equity Research Hub',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = (await response.text()).substring(0, 200);
          lastError = new Error(`OpenRouter ${m} ${response.status}: ${text}`);
          console.warn(`⚠️  LLM model ${m} failed (${response.status}), trying next...`);
          break;
        }

        const data = await response.json();
        const choice = data.choices?.[0];
        const content = choice?.message?.content || '';
        const finishReason = choice?.finish_reason;
        const usage = data.usage;

        // Log diagnostico per debugging
        if (usage) {
          console.log(`📊 LLM ${m}: finish_reason=${finishReason}, prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, reasoning=${usage.completion_tokens_details?.reasoning_tokens || 0}`);
        }

        // Se l'output è stato troncato per lunghezza e retry è abilitato
        if (finishReason === 'length' && retryOnLength) {
          console.warn(`⚠️  LLM ${m} output troncato (finish_reason=length), retry con schema ridotto...`);
          // Retry con stessa conversazione ma chiedendo output più conciso
          const retryMessages = [
            ...messages,
            { role: 'assistant', content: content },
            { role: 'user', content: 'Output troncato. Continua e completa il JSON in modo valido, sii più conciso.' }
          ];
          const retryResponse = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${API_KEY}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://github.com/equity-research-hub',
              'X-Title': 'Equity Research Hub',
            },
            body: JSON.stringify({
              model: m,
              messages: retryMessages,
              temperature,
              max_tokens: maxTokens,
              ...(responseFormat ? { response_format: responseFormat } : {}),
              ...(tools && tools.length ? { tools } : {}),
              ...(isReasoningModel(m) ? { reasoning: { effort: 'low' } } : {}),
            }),
          });
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            const retryContent = retryData.choices?.[0]?.message?.content || '';
            return content + retryContent; // concatena i due pezzi
          }
        }

        return content;
      } catch (e) {
        lastError = e;
        console.warn(`⚠️  LLM attempt ${attempt + 1}/${MAX_RETRIES + 1} on ${m}: ${e.message}`);
        if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('All LLM models exhausted');
}

/**
 * Ripara JSON troncato (da finish_reason=length)
 */
function repairTruncatedJson(text) {
  if (!text) return null;
  // Trova primo { e ultimo }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let json = text.substring(start, end + 1);

  // Conta parentesi e chiudi quelle aperte
  let openBraces = 0, openBrackets = 0;
  let inString = false, escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }
  // Chiudi parentesi/bracket aperti
  json += ']'.repeat(openBrackets) + '}'.repeat(openBraces);
  return json;
}

/**
 * Compatta i risultati delle ricerche web
 */
function compactSearchResults(results, maxPerQuery = 3) {
  if (!results || !Array.isArray(results)) return [];
  return results.map(r => {
    const items = (r.results || []).slice(0, maxPerQuery).map(item => ({
      title: item.title?.substring(0, 150),
      content: item.content?.substring(0, 500),
      url: item.url?.substring(0, 100),
    }));
    return { query: r.query?.substring(0, 100), answer: r.answer?.substring(0, 300), items };
  });
}
/**
 * Estrae i campi fair value rilevanti per il prompt LLM
 */
function compactFv(fairValue) {
  return {
    company_name: fairValue?.company_name,
    current_price: fairValue?.current_price,
    primary_iv: fairValue?.primary_iv,
    primary_buy_price: fairValue?.primary_buy_price,
    primary_sell_price: fairValue?.primary_sell_price,
    recommended_method: fairValue?.recommended_method,
    grade: fairValue?.grade,
    grade_summary: fairValue?.grade_summary,
    sector: fairValue?.sector,
    industry: fairValue?.industry,
    revenue: fairValue?.revenue,
    net_income: fairValue?.net_income,
    operating_cash_flow: fairValue?.operating_cash_flow,
    roic: fairValue?.roic,
    debt_sustainability: fairValue?.debt_sustainability,
    capex_ratio: fairValue?.capex_ratio,
    forward_pe: fairValue?.forward_pe,
    growth_rate: fairValue?.growth_rate,
  };
}

/**
 * FASE 1 — Dossier di ricerca approfondita (modello economico + web search).
 * Ritorna un testo/markdown dettagliato che alimenta la FASE 2 di scrittura.
 */
export async function generateResearchDossier(data) {
  const { ticker, companyName, fairValue, searchResults, newsResults, analystTargets } = data;

  const compactSearch = compactSearchResults(searchResults, 4);
  const compactNews = compactSearchResults(newsResults, 4);
  const compactAnalyst = analystTargets?.results ? compactSearchResults([analystTargets], 6) : [];
  const fv = compactFv(fairValue);

  const prompt = `Sei un analista equity senior. Esegui una ricerca approfondita su ${companyName} (${ticker}).

DATI FAIR VALUE:
${JSON.stringify(fv, null, 2)}

RICERCHE PRELIMINARI:
${JSON.stringify({ search: compactSearch, news: compactNews, analyst: compactAnalyst }, null, 2)}

Integra con la ricerca web. Produci un DOSSIER DETTAGLIATO in italiano (testo/markdown, NON JSON) con queste sezioni:
1. SNAPSHOT: prezzo, capitalizzazione, settore, business model (5-8 frasi)
2. NUMERI CHIAVE: ricavi, margini, utile netto, FCF, debito, ROIC, P/E (valori + date)
3. CRESCITA & GUIDANCE: tassi di crescita, guidance aziendale, segmenti
4. NOTIZIE RILEVANTI: almeno 6 notizie recenti con data e impatto
5. TARGET ANALISTI: consenso, target price, range, rating
6. CATALYST: prossimi eventi (earnings, dividendo, prodotti)
7. RISCHI: almeno 4 rischi concreti
8. SCENARI: bull/base/bear con driver e prezzi indicativi
9. QUALITA & CONTABILITA: earnings quality, voci non ricorrenti

Cita fonti e date. Massimo dettaglio possibile.`;

  const messages = [
    { role: 'system', content: 'Sei un ricercatore finanziario. Produci un dossier dettagliato e citato.' },
    { role: 'user', content: prompt },
  ];

  // Sonar ha la ricerca web NATIVA; altri modelli usano il server tool di OpenRouter
  const nativeSearch = /sonar/i.test(RESEARCH_MODEL);
  try {
    const dossier = await chat(messages, {
      model: RESEARCH_MODEL,
      temperature: 0.3,
      maxTokens: 8000,
      tools: nativeSearch ? undefined : [{ type: 'openrouter:web_search', parameters: { max_results: 6 } }],
      allowFallback: false,
    });
    console.log(`📚 Dossier di ricerca: ${dossier?.length || 0} caratteri`);
    return dossier || '';
  } catch (e) {
    console.warn(`⚠️  Dossier di ricerca fallito: ${e.message}`);
    return '';
  }
}

/**
 * Genera il report narrativo completo con schema allineato ai nuovi template
 */
export async function generateNarrativeReport(data) {
  const { ticker, companyName, fairValue, searchResults, newsResults, analystTargets } = data;

  // FASE 1 — ricerca approfondita (dossier dettagliato)
  const dossier = await generateResearchDossier(data);

  const compactSearch = compactSearchResults(searchResults);
  const compactNews = compactSearchResults(newsResults);
  const compactAnalyst = analystTargets?.results ? compactSearchResults([analystTargets]) : [];

  const fv = compactFv(fairValue);

  const prompt = `Sei un analista equity senior. Scrivi un report DETTAGLIATO in italiano per ${companyName} (${ticker}).

DATI FAIR VALUE:
${JSON.stringify(fv, null, 2)}

${dossier ? `DOSSIER DI RICERCA (usa questi fatti, numeri e citazioni):\n${dossier}\n` : ''}RICERCHE (compattate):
${JSON.stringify({ search: compactSearch, news: compactNews, analyst: compactAnalyst }, null, 2)}

Restituisci SOLO JSON valido con questa struttura:

badges: {positive, negative, mixed} - brevi label colorate
simple.execSummary: {label, text} - sintesi qualitativa "Qualità a sconto": label breve + 4-6 frasi dettagliate
simple.growth: {period, metrics[].{label,value,sub}, plainExplanation, guidance[].{label,value,sub}} - almeno 4 metrics
simple.scenarios: {intro, bull/base/bear.{label,headline,price,text}} - text 3-4 frasi ciascuno
simple.valuationIntro: 2-3 frasi
simple.scale: {bear, base, bull, current} - prezzi come stringhe
simple.legends: {bear, base, bull} - testi legenda
simple.qa: {question, answer}
pro.executiveSummary: testo lungo narrativo (ALMENO 8-12 frasi, ricco di numeri)
pro.thesisLabel: stringa
pro.kpis[].{label,value,sub,highlight} - almeno 6
pro.verdictLine: 2-3 frasi
pro.marketCards[].{label,value,sub,up,extra} - almeno 6
pro.finTable: {headers[], rows[[]], factBlocks[].{color,label,text}} - almeno 6 righe
pro.qoe: {warningTitle, warningText, factBlocks[]}
pro.mixCards[].{label,value,sub,color,extra} - almeno 3
pro.news[].{tag,tagColor,title,text} - ALMENO 6 notizie, text 2-3 frasi
pro.catalysts[].{period,event,impact} - almeno 3
pro.scenarios: {bull/base/bear.{range,assumptions,valuation}} - assumptions 3-5 frasi
pro.valTable: {headers[], rows[[]], factBlocks[]}
pro.risks[].{severity,title,text,borderColor,bgColor,textColor} - ALMENO 4 rischi
pro.finalThesis: {label,text,works[],worries[],verdict,pills[].{label,bg,border}} - works/worries almeno 4 ciascuno

REGOLE DI DETTAGLIO (IMPORTANTE): scrivi testi LUNGHI e ricchi, non sintetici. Rispetta i minimi indicati per ogni array. Analitico, concreto, mai vago. Separa Fatto/Neutra/Bullish/Valutazione. Non inventare dati. Usa virgole decimali.`;

  const messages = [
    { role: 'system', content: 'Restituisci SOLO JSON valido. Nessun testo extra.' },
    { role: 'user', content: prompt },
  ];

  // FASE 2 — scrittura (modello "stile Claude")
  const response = await chat(messages, {
    model: WRITER_MODEL,
    temperature: 0.3, maxTokens: 32000,
    responseFormat: { type: 'json_object' },
    retryOnLength: true,
  });

  try {
    return JSON.parse(response);
  } catch (e) {
    // Attempt recovery: ripara JSON troncato
    const repaired = repairTruncatedJson(response);
    if (repaired) {
      try {
        return JSON.parse(repaired);
      } catch {}
    }
    // Attempt recovery: find first { and last }
    const start = response.indexOf('{');
    const end = response.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const json = response.substring(start, end + 1);
      try {
        return JSON.parse(json);
      } catch {}
    }
    console.error('LLM parse error, raw:', response?.substring(0, 800));
    throw new Error('LLM returned invalid JSON');
  }
}