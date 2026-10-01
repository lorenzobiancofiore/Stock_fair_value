import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { config } from './src/config.js';
import { runAnalysis } from './src/agent/workflow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname);
const app = express();

// Rigenera manifest all'avvio per assicurare stocks.json aggiornato
function regenerateManifest() {
  return new Promise((resolve) => {
    const child = spawn('node', ['generate-manifest.js'], { cwd: PROJECT_ROOT });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    child.on('close', (code) => {
      if (code === 0) console.log('✅ Manifest aggiornato all\'avvio');
      else console.warn(`⚠️  Manifest non aggiornato (exit ${code}): ${output}`);
      resolve();
    });
  });
}

// Rigenera manifest prima di avviare il server
await regenerateManifest();

// Middleware
app.use(express.json());
app.use(express.static(__dirname)); // Serve landing.html + stocks.json + generated files

// CORS per sviluppo locale
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// API: Nuova analisi
app.post('/api/analyze', async (req, res) => {
  const { ticker } = req.body;

  if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
    return res.status(400).json({ error: 'Ticker obbligatorio' });
  }

  const cleanTicker = ticker.trim().toUpperCase();
  
  // Run analysis asynchronously - respond immediately with status
  // In a production system we'd use a job queue, but for simplicity we run inline
  // with a timeout on the HTTP response
  
  res.status(202).json({
    status: 'processing',
    ticker: cleanTicker,
    message: `Analisi di ${cleanTicker} avviata. Attendere il completamento...`,
  });

  // Execute analysis (fire and forget essentially, but we could implement polling)
  try {
    const result = await runAnalysis(cleanTicker);
    console.log('\n🏁 Analysis result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n💥 Analysis failed:', error.message);
  }
});

// API: Analisi sincrona (con polling)
app.post('/api/analyze/sync', async (req, res) => {
  const { ticker } = req.body;

  if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
    return res.status(400).json({ error: 'Ticker obbligatorio' });
  }

  const cleanTicker = ticker.trim().toUpperCase();
  
  // Set a timeout of 5 minutes
  req.setTimeout(300000);
  
  try {
    const result = await runAnalysis(cleanTicker);
    
    if (result.success) {
      res.json({
        success: true,
        ticker: result.ticker,
        companyName: result.companyName,
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
      ticker: cleanTicker,
      error: error.message,
    });
  }
});

// API: Stato salute
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    openRouterKey: config.openRouter.apiKey ? '✅ configured' : '❌ missing',
    tavilyKey: config.tavily.apiKey ? '✅ configured' : '❌ missing',
    fairValueUrl: config.fairValue.baseUrl,
    model: config.openRouter.model,
    timestamp: new Date().toISOString(),
  });
});

// Fallback a landing.html per route non trovate
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'landing.html'));
});

// Avvio server
app.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   Equity Research Hub - Server           ║
║   ────────────────────────────            ║
║   Port: ${config.port}                         ║
║   OpenRouter: ${config.openRouter.apiKey ? '✅' : '❌'}                          ║
║   Tavily: ${config.tavily.apiKey ? '✅' : '❌'}                              ║
║   Model: ${config.openRouter.model.slice(0, 30)}...  ║
║                                          ║
║   http://localhost:${config.port}                 ║
╚══════════════════════════════════════════╝
  `);
});