const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const stocks = [];

// Cartelle o file da ignorare
const IGNORE = ['.git', '.vercel', 'node_modules'];

// Scansiona tutte le cartelle presenti
const items = fs.readdirSync(rootDir, { withFileTypes: true });

items.forEach(item => {
  if (item.isDirectory() && !IGNORE.includes(item.name)) {
    const folderName = item.name;
    const folderPath = path.join(rootDir, folderName);
    const files = fs.readdirSync(folderPath);

    // Cerca i file html della versione semplice e pro
    const simpleFile = files.find(f => f.toLowerCase().endsWith('-semplice.html') || f === 'semplice.html');
    const proFile = files.find(f => f.toLowerCase().endsWith('-pro.html') || f === 'pro.html' || f === 'index.html');

    if (simpleFile || proFile) {
      // Pulisce il nome per creare un ticker e un nome leggibile
      const cleanName = folderName.replace(/_analysis/i, '');
      const ticker = cleanName.toUpperCase();

      stocks.push({
        name: cleanName,
        ticker: ticker,
        folder: folderName,
        simplePath: simpleFile ? `./${folderName}/${simpleFile}` : null,
        proPath: proFile ? `./${folderName}/${proFile}` : null
      });
    }
  }
});

// Genera il file stocks.json
fs.writeFileSync(path.join(rootDir, 'stocks.json'), JSON.stringify(stocks, null, 2));
console.log(`✅ Manifest generato con successo! Trovate ${stocks.length} analisi.`);