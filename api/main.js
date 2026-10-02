import express from 'express';
const app = express();

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/analyze', async (req, res) => {
  res.status(202).json({ status: 'processing', message: 'Analysis started' });
});

app.post('/analyze/sync', async (req, res) => {
  res.json({ success: true, message: 'Analysis complete (mock)' });
});

export default async function handler(req, res) {
  return app(req, res);
}
// Force redeploy Fri Oct  2 11:15:20 CEST 2026
