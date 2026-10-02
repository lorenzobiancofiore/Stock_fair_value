import express from 'express';
import { config } from '../src/config.js';
const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default async function handler(req, res) {
  return app(req, res);
}
