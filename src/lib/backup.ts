import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { dayKey, exportAll, kvSet } from './db';

// Exports the whole database as JSON and opens the share sheet, so you can
// save it to Google Drive, Files, or send it to yourself.
export async function shareBackup(): Promise<void> {
  const data = await exportAll();
  const file = new File(Paths.document, `oracle-backup-${dayKey()}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify({ app: 'the-oracle', version: 1, exported_at: new Date().toISOString(), data }));
  await kvSet('last_backup_at', String(Date.now()));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Save your Oracle backup' });
  }
}
