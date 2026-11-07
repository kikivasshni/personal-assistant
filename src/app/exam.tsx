import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Card, Field, Pill, Screen } from '@/components/ui';
import { resolve } from '@/data/spaces';
import { addDays, dayKey, kvGet, kvSet } from '@/lib/db';
import { space, type } from '@/theme';

// Set the exam date for a study card. Drives the countdown and study plans.
export default function Exam() {
  const { thread } = useLocalSearchParams<{ thread: string }>();
  const t = resolve(thread);
  const [date, setDate] = useState('');

  useEffect(() => {
    kvGet(`exam:${t.id}`).then((d) => setDate(d ?? ''));
  }, [t.id]);

  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
  const quick = [14, 30, 45, 60, 90].map((n) => ({ label: `${n} days`, day: dayKey(addDays(new Date(), n)) }));

  return (
    <Screen>
      <Card>
        <Text style={type.title}>{t.title} exam</Text>
        <Field label="Exam date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-12-01" keyboardType="numbers-and-punctuation" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {quick.map((q) => (
            <Pill key={q.label} label={q.label} active={date === q.day} onPress={() => setDate(q.day)} />
          ))}
        </View>
        <Button
          title="Save"
          disabled={!valid && !!date}
          onPress={async () => {
            await kvSet(`exam:${t.id}`, date);
            router.back();
          }}
        />
        <Button
          title="Save and plan my study to exam day"
          variant="soft"
          disabled={!valid}
          onPress={async () => {
            await kvSet(`exam:${t.id}`, date);
            router.replace(`/chat/${t.id}?prompt=${encodeURIComponent(`My exam is on ${date}. Build me a day-by-day study plan to then, and add this week's sessions as tasks.`)}`);
          }}
        />
      </Card>
    </Screen>
  );
}
