export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ticker, exchange } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Ticker required' });

  try {
    // Import the workflow
    const { runAnalysis } = await import('../src/agent/workflow.js');
    const { DEFAULT_EXCHANGE } = await import('../src/utils/ticker.js');
    const result = await runAnalysis(ticker.trim().toUpperCase(), exchange || DEFAULT_EXCHANGE);
    
    if (result.success) {
      res.json({
        success: true,
        ticker: result.ticker,
        companyName: result.companyName,
        exchange: result.exchange,
        elapsed: result.elapsed,
        simplePath: result.simpleUrl,
        proPath: result.proUrl,
        folder: result.folder,
        warnings: result.warnings,
      });
    } else {
      res.status(500).json({
        success: false,
        ticker: result.ticker,
        error: result.error,
        elapsed: result.elapsed,
        warnings: result.warnings,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      ticker: ticker.toUpperCase(),
      error: error.message,
    });
  }
}
