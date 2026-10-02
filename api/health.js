export default async function handler(req, res) {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
}
