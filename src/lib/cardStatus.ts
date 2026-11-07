import type { Thread } from '@/data/spaces';
import { kvGet } from './db';
import { listDesires } from './desires';
import { pendingQuestions, spendSummary } from './finance';
import { mealsToday, totals } from './food';
import { cycleInfo, recentWorkouts, snapshot } from './health';
import { listSongs, practiceStats } from './hobbies';

const ago = (n: number | null) => (n == null ? 'not started yet' : n === 0 ? 'practised today' : n === 1 ? 'practised yesterday' : `${n} days since practice`);

// A short live line under each card ("Day 14 · Follicular", "23 days to exam").
export async function cardStatus(t: Thread): Promise<string | null> {
  try {
    if (t.id === 'finance.spending' || t.panel === 'advisor') {
      const s = await spendSummary();
      return s.latest ? `$${Math.round(s.month).toLocaleString()} this month · $${Math.round(s.week).toLocaleString()} this week` : 'No statements yet';
    }
    if (t.id === 'finance.statement') {
      const q = await pendingQuestions();
      return q.length ? `${q.length} question${q.length > 1 ? 's' : ''} waiting for you` : 'All caught up';
    }
    switch (t.panel) {
      case 'food': {
        const m = totals(await mealsToday());
        return m.kcal ? `${m.kcal} kcal · ${m.protein} g protein today` : 'Nothing logged today';
      }
      case 'move': {
        const [s, w] = await Promise.all([snapshot().catch(() => null), recentWorkouts(7)]);
        const parts = [s ? `${s.today.steps.toLocaleString()} steps` : null, `${w.length} workout${w.length === 1 ? '' : 's'} this week`];
        return parts.filter(Boolean).join(' · ');
      }
      case 'cycle': {
        const c = await cycleInfo();
        return c.cycleDay ? `Day ${c.cycleDay} · ${c.phase}` : 'Log your last period to start';
      }
      case 'study': {
        const [exam, p] = await Promise.all([kvGet(`exam:${t.id}`), practiceStats(t.id)]);
        const days = exam ? Math.ceil((Date.parse(exam) - Date.now()) / 86_400_000) : null;
        return [days != null && days >= 0 ? `${days} days to exam` : null, p.streak ? `${p.streak}-day streak` : p.lastAt ? null : 'no sessions yet']
          .filter(Boolean)
          .join(' · ');
      }
      case 'guitar': {
        const [songs, p] = await Promise.all([listSongs(), practiceStats(t.id)]);
        const learning = songs.filter((s) => s.status === 'learning').length;
        return `${learning} learning · ${ago(p.daysSince)}`;
      }
      case 'practice':
        return ago((await practiceStats(t.id)).daysSince);
      case 'desires': {
        const d = await listDesires();
        return d.length ? `${d.filter((x) => x.status === 'pending').length} assuming · ${d.filter((x) => x.status === 'manifested').length} manifested` : 'Name your first desire';
      }
    }
  } catch {
    // a missing integration just means no status line
  }
  return null;
}
