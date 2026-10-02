export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { ticker } = req.body;
    if (!ticker) return res.status(400).json({ error: 'Ticker required' });
    return res.json({ success: true, ticker: ticker.toUpperCase(), message: 'Analysis complete (mock)' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}
