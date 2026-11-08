import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { onSyncStatus, syncAll, syncStatus, SyncStatus } from '@/lib/sync';
import { colors, space, type } from '@/theme';

const LABELS: Record<string, string> = {
  food: 'food',
  workouts: 'training',
  moods: 'journal',
  facts: 'memory',
  commitments: 'commitments',
  desires: 'desires',
  songs: 'songs',
  practice: 'practice',
  cycle: 'cycle',
  ledger: 'ledger',
  profile: 'profile',
};

// Settings → Notion: when the two-way sync last ran and what moved.
export function NotionSyncStatus() {
  const [s, setS] = useState<SyncStatus | null>(syncStatus());
  const [busy, setBusy] = useState(false);
  useEffect(() => onSyncStatus(setS), []);

  const toNotion = s?.results.reduce((n, r) => n + r.pushed + r.created, 0) ?? 0;
  const fromNotion = s?.results.reduce((n, r) => n + r.pulled + r.imported, 0) ?? 0;
  const missing = s?.results.filter((r) => r.skipped).map((r) => LABELS[r.kind] ?? r.kind) ?? [];

  return (
    <View style={{ gap: space.xs }}>
      <Text style={type.label}>Two-way sync</Text>
      <Text style={type.small}>
        Food, training, mood journal, memory and profile, commitments, desires, songs, practice, cycle and spending stay in step with Notion. Edit either
        side; changes in Notion arrive within 5 minutes or when you open the app.
      </Text>
      {s ? (
        <Text style={[type.small, !s.ok && { color: colors.danger }]}>
          {s.ok ? 'Synced' : 'Synced with an error'} at {new Date(s.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {toNotion} to Notion ·{' '}
          {fromNotion} from Notion{s.error ? `\n${s.error}` : ''}
          {missing.length ? `\nNot found in Notion (share them with the integration): ${missing.join(', ')}` : ''}
        </Text>
      ) : (
        <Text style={type.small}>Not synced yet this session.</Text>
      )}
      <Button
        title="Sync now"
        variant="soft"
        icon="sync"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            setS(await syncAll());
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}
