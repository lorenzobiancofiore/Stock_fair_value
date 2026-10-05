import { toTradingViewSymbol } from '../utils/ticker.js';

function fmtNum(v, decimals) {
  const d = (decimals == null) ? 2 : decimals;
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return v == null ? 'N/D' : String(v);
  return n.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return 'N/D';
  const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
  return pct.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%';
}
function currencySymbol(fv) {
  const c = (fv && fv.currency ? fv.currency : '').toUpperCase();
  const map = { USD: '$' };
  return map[c] || (c ? c + ' ' : '');
}

function computeExecKpis(fv) {
  if (!fv) return [];
  const cur = currencySymbol(fv);
  const k = [];
  if (fv.current_price != null) k.push({ label: 'Prezzo attuale', value: cur + fmtNum(fv.current_price), sub: 'Quotazione di mercato', highlight: false });
  if (fv.primary_iv != null) k.push({ label: 'Fair Value', value: cur + fmtNum(fv.primary_iv), sub: (fv.recommended_method || 'Valore intrinseco'), highlight: true });
  if (fv.margin_of_safety != null) k.push({ label: 'Margine di sicurezza', value: fmtPct(fv.margin_of_safety), sub: 'Sconto vs fair value', highlight: Number(fv.margin_of_safety) > 0 });
  if (fv.roic != null) k.push({ label: 'ROIC', value: fmtPct(fv.roic), sub: 'Ritorno sul capitale investito', highlight: false });
  if (fv.forward_pe != null) k.push({ label: 'P/E Forward', value: fmtNum(fv.forward_pe, 1), sub: 'Prezzo / Utili attesi', highlight: false });
  if (fv.dividend_yield != null) k.push({ label: 'Dividend Yield', value: fmtPct(fv.dividend_yield), sub: 'Rendimento da dividendo', highlight: false });
  return k;
}
function computeVerdict(fv) {
  if (!fv) return '';
  const parts = [];
  if (fv.grade) parts.push('Qualità ' + fv.grade);
  const up = fv.primary_upside;
  if (up != null) {
    const pct = Math.abs(up) <= 1.5 ? up * 100 : up;
    if (pct > 10) parts.push('sottovalutato (' + Math.round(pct) + '% di margine)');
    else if (pct < -10) parts.push('sopravvalutato (' + Math.round(Math.abs(pct)) + '% sopra il fair value)');
    else parts.push('in linea con il fair value');
  }
  return parts.join(' - ');
}
export function buildExecData(ticker, fv, narrative, mode) {
  const simple = (narrative && narrative.simple) || {};
  const pro = (narrative && narrative.pro) || {};
  const isPro = mode === 'pro';
  const label = isPro ? pro.thesisLabel : (simple.execSummary && simple.execSummary.label);
  const summary = isPro ? pro.executiveSummary : (simple.execSummary && simple.execSummary.text);
  return {
    tvSymbol: toTradingViewSymbol(ticker),
    chartMode: mode,
    execKpis: computeExecKpis(fv),
    execLabel: label || pro.thesisLabel || 'Qualità a sconto',
    execSummary: summary || pro.executiveSummary || simple.valuationIntro || '',
    verdict: isPro ? (pro.verdictLine || computeVerdict(fv)) : (simple.verdict || pro.verdictLine || computeVerdict(fv)),
  };
}
