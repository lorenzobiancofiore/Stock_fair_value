import { config } from '../config.js';

const BASE_URL = config.openRouter.baseUrl;
const API_KEY = config.openRouter.apiKey;
const PRIMARY_MODEL = config.openRouter.model;
const FALLBACK_MODELS = config.openRouter.fallbackModels;
const MAX_RETRIES = 2;

async function chat(messages, options = {}) {
  const { model, temperature = 0.3, maxTokens = 6000, responseFormat } = options;
  const modelList = [model || PRIMARY_MODEL, ...FALLBACK_MODELS];

  let lastError = null;

  for (const m of modelList) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const body = { model: m, messages, temperature, max_tokens: maxTokens };
        if (responseFormat) body.response_format = responseFormat;

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
        return data.choices[0]?.message?.content || '';
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
 * Genera il report narrativo completo con schema allineato ai nuovi template
 */
export async function generateNarrativeReport(data) {
  const { ticker, companyName, fairValue, searchResults, newsResults, analystTargets } = data;

  const compactSearch = compactSearchResults(searchResults);
  const compactNews = compactSearchResults(newsResults);
  const compactAnalyst = analystTargets?.results ? compactSearchResults([analystTargets]) : [];

  const fv = {
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

  const prompt = `Sei un analista equity senior. Scrivi un report in italiano per ${companyName} (${ticker}).

DATI FAIR VALUE:
${JSON.stringify(fv, null, 2)}

RICERCHE (compattate):
${JSON.stringify({ search: compactSearch, news: compactNews, analyst: compactAnalyst }, null, 2)}

Restituisci SOLO JSON valido con questa struttura:

badges: {positive, negative, mixed} - brevi label colorate
simple.growth: {period, metrics[].{label,value,sub}, plainExplanation, guidance[].{label,value,sub}}
simple.scenarios: {intro, bull/base/bear.{label,headline,price,text}}
simple.valuationIntro: frase testo
simple.scale: {bear, base, bull, current} - prezzi come stringhe
simple.legends: {bear, base, bull} - testi legenda
simple.qa: {question, answer} - optional
pro.executiveSummary: testo lungo narrativo
pro.thesisLabel: stringa
pro.kpis[].{label,value,sub,highlight}
pro.verdictLine: stringa
pro.marketCards[].{label,value,sub,up,extra}
pro.finTable: {headers[], rows[[]], factBlocks[].{color,label,text}}
pro.qoe: {warningTitle, warningText, factBlocks[]}
pro.mixCards[].{label,value,sub,color,extra}
pro.news[].{tag,tagColor,title,text}
pro.catalysts[].{period,event,impact}
pro.scenarios: {bull/base/bear.{range,assumptions,valuation}}
pro.valTable: {headers[], rows[[]], factBlocks[]}
pro.risks[].{severity,title,text,borderColor,bgColor,textColor}
pro.finalThesis: {label,text,works[],worries[],verdict,pills[].{label,bg,border}}

REGOLE: Analitico, concreto, mai vago. Separa Fatto/Neutra/Bullish/Valutazione. Modalit&agrave; semplice per non esperti. Non inventare dati. Usa virgole decimali.`;

  const messages = [
    { role: 'system', content: 'Restituisci SOLO JSON valido. Nessun testo extra.' },
    { role: 'user', content: prompt },
  ];

  const response = await chat(messages, {
    temperature: 0.2, maxTokens: 10000,
    responseFormat: { type: 'json_object' },
  });

  try {
    return JSON.parse(response);
  } catch (e) {
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