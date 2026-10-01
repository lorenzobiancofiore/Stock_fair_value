import { config } from '../config.js';

const BASE_URL = config.fairValue.baseUrl;
const API_KEY = config.fairValue.apiKey;

function buildUrl(endpoint, params) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  if (API_KEY) {
    url.searchParams.set('key', API_KEY);
  }
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fair Value API ${response.status}: ${text}`);
  }
  
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'Accept': 'text/html' },
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fair Value API ${response.status}: ${text}`);
  }
  
  return response.text();
}

/**
 * Chiama l'API Fair Value per ottenere i dati JSON completi
 */
export async function getFairValue(ticker, options = {}) {
  const url = buildUrl('/fairvalue', {
    ticker,
    format: 'json',
    growth: options.growth,
    save: options.save,
    target_margin: options.targetMargin,
  });
  
  return fetchJson(url);
}

/**
 * Ottiene lo snippet HTML per modalità Semplice
 */
export async function getFairValueHtmlSimple(ticker, accent = '#7c3aed') {
  const url = buildUrl('/fairvalue', {
    ticker,
    format: 'html-simple',
    accent: String(accent),  // non encode — l'API accetta #7c3aed
  });
  
  return fetchText(url);
}

/**
 * Ottiene lo snippet HTML per modalità Pro
 */
export async function getFairValueHtmlPro(ticker, accent = '#7c3aed') {
  const url = buildUrl('/fairvalue', {
    ticker,
    format: 'html-pro',
    accent: String(accent),  // non encode — l'API accetta #7c3aed
  });
  
  return fetchText(url);
}

/**
 * Estrae il colore accent dal ticker (fallback)
 */
export function getAccentColor(ticker) {
  const colors = {
    'AMAT': '#e8112d',
    'AVGO': '#ff6b00',
    'NFLX': '#e50914',
    'NVDA': '#76b900',
    'CRWD': '#e01e5a',
    'PLTR': '#00b4d8',
    'ORCL': '#f80000',
    'PANW': '#00b8a9',
    'BZU': '#003366',
    'MC': '#e8112d',
    'VST': '#0066cc',
    'WBD': '#007bff',
  };
  
  return colors[ticker.toUpperCase()] || '#7c3aed';
}