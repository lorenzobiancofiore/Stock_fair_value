export default async function handler(req, res) {
  res.json({ message: 'Test function works!', timestamp: new Date().toISOString() });
}
// Force redeploy Fri Oct  2 10:26:19 CEST 2026
