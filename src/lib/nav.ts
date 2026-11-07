import { router } from 'expo-router';
import { Space, Thread, threadsFor } from '@/data/spaces';

export function openSpace(s: Space) {
  const threads = threadsFor(s.id);
  if (threads.length === 1 && !s.add) router.push(`/chat/${threads[0].id}`);
  else router.push(`/space/${s.id}`);
}

export function openThread(t: Thread) {
  router.push((t.route ?? `/chat/${t.id}`) as never);
}
