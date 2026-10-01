import { tavily } from '@tavily/core';
import { config } from '../config.js';
import { searchWeb, searchBatch } from './llmSearch.js';

const client = tavily({ apiKey: config.tavily.apiKey });

/**
 * Esegue una ricerca web con Tavily + fallback LLM
 */
async function search(query, options = {}) {
  const {
    maxResults = 10,
    searchDepth = 'advanced',
    includeAnswer = true,
  } = options;

  // Tentativo 1: Tavily
  if (config.tavily.apiKey) {
    try {
      const response = await client.search(query, {
        maxResults, searchDepth, includeAnswer,
      });
      if (response?.results?.length > 0) return response;
    } catch (tavilyError) {
      console.warn(`⚠️  Tavily fallito per "${query.substring(0,60)}...": ${tavilyError.message}`);
    }
  } else {
    console.warn('⚠️  Tavily API key non configurata');
  }

  // Fallback: LLM web search
  console.log(`   🔄 Fallback: cerco su web via LLM...`);
  try {
    const llmResult = await searchWeb(query, options);
    if (llmResult.results?.length > 0) return llmResult;
  } catch (llmError) {
    console.warn(`⚠️  Fallback LLM fallito: ${llmError.message}`);
  }

  // Se tutto fallisce, ritorna vuoto
  return { query, results: [], answer: '' };
}

/**
 * Fase 1: Documenti finanziari di base
 */
export async function searchFinancialDocs(ticker, companyName) {
  const queries = [
    `"${companyName}" latest earnings results 2024 2025`,
    `"${companyName}" investor presentation Q3 Q4 2024`,
    `"${companyName}" earnings call transcript 2024`,
    `"${companyName}" guidance outlook 2024 2025`,
    `"${ticker}" revenue earnings "quarterly" 2024`,
  ];

  const results = [];
  for (const query of queries) {
    try {
      const res = await search(query, { maxResults: 5 });
      results.push({ query, ...res });
      await new Promise(r => setTimeout(r, 200)); // Rate limit
    } catch (e) {
      results.push({ query, error: e.message });
    }
  }
  return results;
}

/**
 * Fase 1B: Validazione freschezza dati (5 ricerche obbligatorie)
 */
export async function validateFreshness(ticker, companyName) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().toLocaleString('default', { month: 'long' });
  
  const queries = [
    `"${ticker}" stock price today`,
    `"${companyName}" latest earnings results ${currentYear}`,
    `"${ticker}" analyst price target consensus ${currentYear}`,
    `"${companyName}" debt cash balance sheet ${currentYear}`,
    `"${companyName}" news ${currentMonth} ${currentYear}`,
  ];

  const results = [];
  for (const query of queries) {
    try {
      const res = await search(query, { maxResults: 5, searchDepth: 'basic' });
      results.push({ query, ...res });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      results.push({ query, error: e.message });
    }
  }
  return results;
}

/**
 * Fase 2: Notizie che cambiano la narrativa (ultimi 90-180 giorni)
 */
export async function searchNews(ticker, companyName) {
  const now = new Date();
  const year = now.getFullYear();
  const currentMonth = now.toLocaleString('default', { month: 'long' }).toLowerCase();
  const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const monthNum = months.indexOf(currentMonth) + 1;
  const prevMonth = monthNum > 1 ? months[monthNum - 2] : months[11];

  const queries = [
    `"${companyName}" "${ticker}" earnings results ${year} guidance`,
    `"${companyName}" latest quarterly results ${prevMonth} ${year}`,
    `"${companyName}" CEO executive change ${year}`,
    `"${companyName}" product launch event ${year}`,
    `"${companyName}" regulatory lawsuit settlement ${year}`,
    `"${companyName}" partnership contract ${prevMonth} ${year}`,
    `"${companyName}" analyst rating outlook ${year} analyst`,
    `"${ticker}" stock investor news ${currentMonth} ${year}`,
  ];

  const results = [];
  for (const query of queries) {
    try {
      const res = await search(query, { maxResults: 5, searchDepth: 'advanced' });
      results.push({ query, ...res });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      results.push({ query, error: e.message, results: [] });
    }
  }
  return results;
}

/**
 * Filtra risultati web con recency (elimina fonti vecchie non datate)
 */
export function filterRecentResults(results, maxDays = 180) {
  if (!results) return results;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);
  const cutoffStr = cutoff.toISOString().substring(0, 10);

  return results.map(group => {
    if (!group.results || group.results.length === 0) return group;
    const recent = group.results.filter(r => {
      if (r.publishedDate) return r.publishedDate >= cutoffStr;
      return true; // se non ha data, tiene
    });
    return { ...group, results: recent.slice(0, 5) };
  });
}

/**
 * Target price analisti
 */
export async function searchAnalystTargets(ticker) {
  const query = `"${ticker}" analyst price target consensus 2024`;
  try {
    return await search(query, { maxResults: 10 });
  } catch (e) {
    return { query, error: e.message };
  }
}

/**
 * Ricerca generica per risolvere nome azienda da ticker
 */
export async function resolveCompanyName(ticker) {
  const query = `"${ticker}" company name stock`;
  try {
    const res = await search(query, { maxResults: 5, searchDepth: 'basic' });
    if (res.answer) return res.answer;
    if (res.results?.[0]?.content) return res.results[0].content.substring(0, 200);
    return ticker;
  } catch {
    return ticker;
  }
}