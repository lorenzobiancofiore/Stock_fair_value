export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { ticker, mode } = req.query;
  if (!ticker || !mode || !['semplice', 'pro'].includes(mode)) {
    return res.status(400).send('Parametri mancanti: ?ticker=XXX&mode=semplice|pro');
  }

  const tickerLower = String(ticker).toLowerCase().replace(/\./g, '-');
  const blobPath = `${tickerLower}/${tickerLower}-${mode}.html`;

  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: blobPath });
    const found = blobs.find(b => b.pathname === blobPath);
    if (!found) return res.status(404).send('Report non trovato');

    const r = await fetch(found.url);
    if (!r.ok) return res.status(502).send('Errore nel recupero del report');
    const html = await r.text();

    // Serve INLINE (apre nel browser invece di scaricare)
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(html);
  } catch (error) {
    res.status(500).send('Errore: ' + error.message);
  }
}