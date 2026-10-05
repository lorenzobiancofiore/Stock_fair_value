import { config } from '../config.js';

const BASE_URL = config.openRouter.baseUrl;
const API_KEY = config.openRouter.apiKey;

/**
 * Cerca sul web via LLM con il server tool di OpenRouter (openrouter:web_search)
 * Model-agnostic: usa Google Gemini 2.5 Flash + fallback gratuiti
 * Il server tool è eseguito lato OpenRouter, nessuna implementazione client richiesta
 */
async function fetchLLM(query) {
  const models = [
    'google/gemini-2.5-flash',
    // Fallback gratuiti se il modello primario non è disponibile
    'google/gemini-2.0-flash-exp:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'microsoft/phi-4:free',
  ];

  for (const model of models) {
    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/equity-research-hub',
          'X-Title': 'Equity Research Hub',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Sei un analista finanziario. Rispondi in modo conciso e fattuale con dati numerici precisi. Cita le fonti.' },
            { role: 'user', content: query }
          ],
          tools: [
            { type: 'openrouter:web_search', parameters: { max_results: 5 } }
          ],
          max_tokens: 1500,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const text = (await response.text()).substring(0, 200);
        console.warn(`⚠️  LLM search ${model} failed (${response.status}): ${text}`);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      return content;
    } catch (e) {
      console.warn(`⚠️  LLM search ${model} error: ${e.message}`);
      continue;
    }
  }

  throw new Error('All LLM search models exhausted');
}

/**
 * Chiamata LLM con web search che restituisce formato simile a Tavily
 * (compatibile con compactSearchResults)
 */
export async function searchWeb(query, options = {}) {
  const { maxResults = 5 } = options;
  
  let content;
  try {
    content = await fetchLLM(query);
  } catch (e) {
    // Se fallisce anche l'LLM, restituisci un risultato vuoto
    console.warn(`⚠️  LLM search entirely failed for "${query}"`);
    return { query, results: [], answer: '' };
  }

  // Trasforma in formato simile a Tavily per compatibilità
  const result = {
    title: query,
    url: '',
    content: content,
  };

  return {
    query,
    answer: content.substring(0, 500),
    results: [result],
  };
}

/**
 * Versione batch per multi-query (es. Fase 1, 1B, 2)
 * L'LLM risponde a TUTTE le query in un unico prompt
 */
export async function searchBatch(queries, topic = '') {
  const batchQuery = `Cerco informazioni finanziarie aggiornate su ${topic}.\n\nDomande specifiche:\n${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\nPer favore rispondi a ciascuna domanda con dati numerici precisi, fonti e date.`;

  try {
    const content = await fetchLLM(batchQuery);
    
    // Restituisci array di risultati (uno per query)
    return queries.map((query, i) => ({
      query,
      answer: content.length > 200 ? content.substring(0, 500 * (i + 1)) : content,
      results: [{ title: query, url: '', content: content.substring(0, 800) }],
    }));
  } catch (e) {
    // Fallback: chiama singolarmente
    const results = [];
    for (const q of queries.slice(0, 5)) { // max 5 per volta
      try {
        results.push(await searchWeb(q));
      } catch {
        results.push({ query: q, results: [], answer: '' });
      }
    }
    return results;
  }
}