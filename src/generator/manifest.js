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
 */
export async function getGeneratedManifest() {
  if (useBlob()) {
    try {
      const { blobs } = await vercelBlob.list({ prefix: MANIFEST_BLOB });
      const found = blobs.find(b => b.pathname === MANIFEST_BLOB);
      if (found) {
        const res = await fetch(found.url);
        if (res.ok) return await res.json();
      }
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