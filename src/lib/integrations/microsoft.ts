import { authedFetch, MICROSOFT } from './oauth';

// Microsoft To Do through Microsoft Graph. Samsung Reminder can sync with
// Microsoft To Do (Reminder → Settings → Sync with Microsoft To Do), so tasks
// written here also appear there.
const GRAPH = 'https://graph.microsoft.com/v1.0';

type TodoList = { id: string; displayName: string; wellknownListName?: string };
export type TodoTask = {
  id: string;
  title: string;
  status: string;
  importance?: string;
  dueDateTime?: { dateTime: string; timeZone: string };
  reminderDateTime?: { dateTime: string; timeZone: string };
  isReminderOn?: boolean;
  createdDateTime?: string;
};

let defaultListId: string | null = null;

async function listId(): Promise<string> {
  if (defaultListId) return defaultListId;
  const r = (await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists`)) as { value: TodoList[] };
  const list = r.value.find((l) => l.wellknownListName === 'defaultList') ?? r.value[0];
  if (!list) throw new Error('No Microsoft To Do list found.');
  defaultListId = list.id;
  return list.id;
}

// To Do stores due dates as dates (midnight UTC). A time, if given, becomes
// the reminder, which is also what Samsung Reminder alerts on.
export async function addTodo(title: string, dueDay?: string | null, remindAtIso?: string | null): Promise<TodoTask> {
  const body: Record<string, unknown> = { title };
  if (dueDay) body.dueDateTime = { dateTime: `${dueDay.slice(0, 10)}T00:00:00`, timeZone: 'UTC' };
  if (remindAtIso) {
    body.isReminderOn = true;
    body.reminderDateTime = { dateTime: remindAtIso.slice(0, 19), timeZone: 'Asia/Singapore' };
  }
  return (await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists/${await listId()}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as TodoTask;
}

export async function listTodos(limit = 100): Promise<TodoTask[]> {
  const r = (await authedFetch(
    MICROSOFT,
    `${GRAPH}/me/todo/lists/${await listId()}/tasks?$filter=status ne 'completed'&$top=${limit}`,
  )) as { value: TodoTask[] };
  return r.value;
}

export async function setTodoDone(id: string, done: boolean) {
  await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists/${await listId()}/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: done ? 'completed' : 'notStarted' }),
  });
}

export async function setTodoDue(id: string, dueDay: string | null) {
  await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists/${await listId()}/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ dueDateTime: dueDay ? { dateTime: `${dueDay}T00:00:00`, timeZone: 'UTC' } : null }),
  });
}

export async function deleteTodo(id: string) {
  await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists/${await listId()}/tasks/${id}`, { method: 'DELETE' });
}
