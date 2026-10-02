export default async function handler(req, res) {
  res.json({ message: 'Test function works!', timestamp: new Date().toISOString() });
}
