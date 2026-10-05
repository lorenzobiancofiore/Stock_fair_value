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
