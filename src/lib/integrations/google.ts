import { authedFetch, GOOGLE } from './oauth';

// Google Calendar. Notion Calendar reads the same Google Calendar,
// so events added here appear there too.
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export type CalEvent = {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
};

export async function addEvent(title: string, startIso: string, endIso: string, description?: string): Promise<CalEvent> {
  return (await authedFetch(GOOGLE, CAL, {
    method: 'POST',
    body: JSON.stringify({
      summary: title,
      description,
      start: { dateTime: startIso, timeZone: 'Asia/Singapore' },
      end: { dateTime: endIso, timeZone: 'Asia/Singapore' },
    }),
  })) as CalEvent;
}

export async function listEvents(days = 1, from = new Date()): Promise<CalEvent[]> {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + days * 86_400_000);
  const q = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  });
  const r = (await authedFetch(GOOGLE, `${CAL}?${q}`)) as { items?: CalEvent[] };
  return r.items ?? [];
}

export function eventTime(e: CalEvent): string {
  const s = e.start?.dateTime;
  if (!s) return 'All day';
  return new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
