/**
 * Utility di normalizzazione e parsing dei ticker azionari.
 * Gestisce sia ticker US (AAPL) sia ticker esteri con suffisso exchange (ENGI.PA, MC.PA, SAP.DE).
 */

// Suffissi exchange (stile Yahoo Finance) → nome borsa leggibile
const EXCHANGE_SUFFIXES = {
  '.PA': 'Euronext Paris',
  '.AS': 'Euronext Amsterdam',
  '.BR': 'Euronext Bruxelles',
  '.LS': 'Euronext Lisbona',
  '.DE': 'XETRA Francoforte',
  '.F': 'Borsa di Francoforte',
  '.BE': 'Borsa di Berlino',
  '.MU': 'Borsa di Monaco',
  '.MI': 'Borsa Italiana',
  '.MC': 'Borsa di Madrid',
  '.L': 'London Stock Exchange',
  '.SW': 'SIX Swiss Exchange',
  '.VI': 'Borsa di Vienna',
  '.ST': 'Nasdaq Stoccolma',
  '.HE': 'Nasdaq Helsinki',
  '.CO': 'Nasdaq Copenhagen',
  '.OL': 'Oslo Bors',
  '.IR': 'Euronext Dublino',
  '.TO': 'Toronto Stock Exchange',
  '.V': 'TSX Venture',
  '.HK': 'Hong Kong Stock Exchange',
  '.T': 'Tokyo Stock Exchange',
  '.KS': 'Korea Exchange',
  '.AX': 'Australian Securities Exchange',
  '.NZ': 'NZX',
  '.SI': 'Singapore Exchange',
  '.SA': 'B3 Brasile',
  '.MX': 'Borsa Messicana',
};

/**
 * Normalizza un ticker per l'uso in path, cartelle e nomi file.
 * Es. "ENGI.PA" -> "engi-pa", "BRK.B" -> "brk-b"
 */
export function normalizeTicker(t) {
  return String(t || '').toLowerCase().replace(/\./g, '-');
}

/**
 * Separa un ticker dal suffisso di exchange.
 * Es. "ENGI.PA" -> { raw: "ENGI.PA", base: "ENGI", suffix: ".PA", exchange: "Euronext Paris" }
 */
export function parseTicker(ticker) {
  const up = String(ticker || '').toUpperCase().trim();
  // I suffissi a 2 caratteri sono i più comuni; controllali per primi
  const entries = Object.entries(EXCHANGE_SUFFIXES).sort((a, b) => b[0].length - a[0].length);
  for (const [suffix, exchange] of entries) {
    if (up.endsWith(suffix)) {
      return { raw: up, base: up.slice(0, -suffix.length), suffix, exchange };
    }
  }
  return { raw: up, base: up, suffix: '', exchange: '' };
}

/**
 * True se il ticker è quotato su un exchange non-US (ha suffisso noto).
 */
export function isForeignTicker(ticker) {
  return parseTicker(ticker).suffix !== '';
}

/**
 * Simbolo da usare nelle query di ricerca web.
 * Per ticker esteri usa il simbolo base (senza suffisso): meglio digerito
 * dai motori di ricerca rispetto a "ENGI.PA".
 */
export function searchSymbol(ticker) {
  const { base, raw, suffix } = parseTicker(ticker);
  return suffix ? base : raw;
}

/**
 * Suggerimento exchange da aggiungere alle query per disambiguare i ticker esteri.
 * Ritorna una stringa (es. " Euronext Paris") oppure ''.
 */
export function exchangeHint(ticker) {
  const { exchange } = parseTicker(ticker);
  return exchange ? ` ${exchange}` : '';
}

/**
 * Borse selezionabili dall'utente (codice → etichetta UI + suffisso Yahoo Finance).
 * I ticker US non hanno suffisso; quelli non-US usano la convenzione Yahoo (es. .MI, .PA).
 */
export const EXCHANGES = {
  'US-NY': { label: 'USA — NYSE', suffix: '' },
  'US-NASDAQ': { label: 'USA — NASDAQ', suffix: '' },
  'IT-MI': { label: 'Italia — Borsa Italiana', suffix: '.MI' },
  'FR-PA': { label: 'Francia — Euronext Paris', suffix: '.PA' },
  'DE-DE': { label: 'Germania — XETRA', suffix: '.DE' },
  'NL-AS': { label: 'Paesi Bassi — Euronext Amsterdam', suffix: '.AS' },
  'UK-L': { label: 'Regno Unito — London SE', suffix: '.L' },
  'ES-MC': { label: 'Spagna — Bolsa Madrid', suffix: '.MC' },
  'CH-SW': { label: 'Svizzera — SIX', suffix: '.SW' },
  'HK-HK': { label: 'Hong Kong — HKEX', suffix: '.HK' },
  'JP-T': { label: 'Giappone — Tokyo SE', suffix: '.T' },
  'AU-AX': { label: 'Australia — ASX', suffix: '.AX' },
  'CA-TO': { label: 'Canada — TSX', suffix: '.TO' },
  'BR-SA': { label: 'Brasile — B3', suffix: '.SA' },
};

export const DEFAULT_EXCHANGE = 'US-NY';

/**
 * Ritorna il suffisso Yahoo Finance associato a un codice borsa.
 * Se il codice non è noto, ritorna '' (comportamento US).
 */
export function getExchangeSuffix(code) {
  return EXCHANGES[code]?.suffix ?? '';
}

/**
 * Converte il ticker inserito dall'utente nel formato riconosciuto da Yahoo Finance
 * in base alla borsa selezionata.
 *
 * Regole:
 *  - US (US-NY / US-NASDAQ): nessun suffisso  →  AAPL
 *  - Altre borse: si aggiunge il suffisso Yahoo →  ENEL + IT-MI = ENEL.MI
 *  - Se il ticker contiene già un suffisso di exchange noto, viene rispettato.
 */
export function toYahooFinanceFormat(ticker, exchange = DEFAULT_EXCHANGE) {
  const up = String(ticker || '').toUpperCase().trim();
  if (!up) return up;

  // Se il ticker ha già un suffisso riconosciuto, non toccarlo (l'utente è esplicito)
  if (parseTicker(up).suffix) return up;

  const suffix = getExchangeSuffix(exchange);
  return suffix ? `${up}${suffix}` : up;
}
