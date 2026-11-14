import fs from 'fs/promises';
import path from 'path';

let vercelBlob = null;
try {
  vercelBlob = await import('@vercel/blob');
} catch (e) {
  // @vercel/blob non disponibile (ambiente locale)
}

const MANIFEST_BLOB = 'reports-manifest.json';

function useBlob() {
  return Boolean(vercelBlob?.put && vercelBlob?.list && process.env.BLOB_READ_WRITE_TOKEN);
}

function manifestLocalPath() {
  return path.resolve(process.env.OUTPUT_DIR || '.', 'generated-reports.json');
}

/**
 * Legge il manifest dei report generati (da Blob o da disco locale)
 * Filtra i report le cui cartelle non esistono più nel blob storage
 */
export async function getGeneratedManifest() {
  if (useBlob()) {
    try {
      // 1. Leggi il manifest
      const { blobs: manifestBlobs } = await vercelBlob.list({ prefix: MANIFEST_BLOB });
      const found = manifestBlobs.find(b => b.pathname === MANIFEST_BLOB);
      if (!found) return [];
      
      const res = await fetch(found.url);
      if (!res.ok) return [];
      const manifest = await res.json();

      // 2. Elenca tutti i blob per verificare quali cartelle esistono
      const { blobs: allBlobs } = await vercelBlob.list({});
      const existingFolders = new Set();
      for (const blob of allBlobs) {
        // Estrae il nome della cartella (prima parte del path)
        const parts = blob.pathname.split('/');
        if (parts.length > 1) {
          existingFolders.add(parts[0]);
        }
      }

      // 3. Filtra il manifest: mantiene solo i report la cui cartella esiste
      return manifest.filter(report => {
        const folder = report.folder;
        return folder && existingFolders.has(folder);
      });
    } catch (e) {
      console.warn('manifest read error:', e.message);
    }
    return [];
  }

  try {
    const raw = await fs.readFile(manifestLocalPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/**
 * Aggiunge/aggiorna un report nel manifest
 */
export async function addToManifest(entry) {
  const manifest = await getGeneratedManifest();
  const idx = manifest.findIndex(m => m.ticker === entry.ticker);
  if (idx >= 0) manifest[idx] = { ...manifest[idx], ...entry };
  else manifest.push(entry);

  const json = JSON.stringify(manifest, null, 2);

  if (useBlob()) {
    await vercelBlob.put(MANIFEST_BLOB, json, {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
    });
  } else {
    await fs.writeFile(manifestLocalPath(), json, 'utf-8');
  }

  return manifest;
}