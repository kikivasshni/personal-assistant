import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { dayKey, db, exportAll, kvSet, restoreAll } from './db';
import { notifyChange } from './live';

type Backup = { app: string; version: number; exported_at: string; data: Record<string, unknown> };

function backupJson(data: Record<string, unknown[]>) {
  return JSON.stringify({ app: 'kairos', version: 1, exported_at: new Date().toISOString(), data });
}

// Exports the whole database as JSON and opens the share sheet, so you can
// save it to Google Drive, Files, or send it to yourself.
export async function shareBackup(): Promise<void> {
  const data = await exportAll();
  const file = new File(Paths.document, `oracle-backup-${dayKey()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(backupJson(data));
  await kvSet('last_backup_at', String(Date.now()));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your Kairos backup' });
  }
}

export type PickedBackup = { backup: Backup; name: string; rows: number };

// Lets you choose a backup file (from Drive, Files, Downloads…) and checks
// it's really a Kairos backup. Returns null if you cancel.
export async function pickBackup(): Promise<PickedBackup | null> {
  // Drive often labels JSON as a generic file, so don't filter by type.
  const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  let parsed: unknown;
  try {
    parsed = JSON.parse(await new File(a.uri).text());
  } catch {
    throw new Error(`"${a.name}" isn't a Kairos backup. Pick the .json file you exported.`);
  }
  const b = parsed as Partial<Backup>;
  if (b?.app !== 'kairos' || !b.data || typeof b.data !== 'object') {
    throw new Error(`"${a.name}" isn't a Kairos backup. Pick the .json file you exported.`);
  }
  const rows = Object.values(b.data).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
  return { backup: b as Backup, name: a.name, rows };
}

const safetyFile = () => new File(Paths.document, 'oracle-before-restore.json');

/** When the last restore happened, if it can still be undone. */
export function lastRestoreAt(): Date | null {
  const f = safetyFile();
  if (!f.exists) return null;
  return f.modificationTime ? new Date(f.modificationTime) : new Date();
}

// Replaces everything on this phone with the backup. A copy of what was here
// is saved first, so a wrong pick can be undone with undoRestore().
export async function restoreBackup(b: Backup): Promise<number> {
  const safety = safetyFile();
  if (safety.exists) safety.delete();
  safety.create();
  safety.write(backupJson(await exportAll()));
  return applyBackup(b);
}

// Puts back what was on the phone before the last restore.
export async function undoRestore(): Promise<number> {
  const safety = safetyFile();
  if (!safety.exists) throw new Error('There is no restore to undo.');
  const b = JSON.parse(await safety.text()) as Backup;
  const n = await applyBackup(b);
  safety.delete();
  return n;
}

async function applyBackup(b: Backup): Promise<number> {
  const n = await restoreAll(b.data);
  // Scheduled reminders belong to the old install; let them be rebuilt.
  await kvSet('affirmation_ids', '[]');
  await kvSet('affirmations_until', '0');
  // Restored rows may reuse ids that pointed at other Notion pages. Drop the
  // links; the next sync re-matches records to Notion rows by content.
  await (await db()).runAsync('DELETE FROM notion_links');
  notifyChange('*');
  return n;
}
