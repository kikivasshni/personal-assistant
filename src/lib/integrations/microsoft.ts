import { authedFetch, MICROSOFT } from './oauth';

// Microsoft To Do through Microsoft Graph.
const GRAPH = 'https://graph.microsoft.com/v1.0';

type TodoList = { id: string; displayName: string; wellknownListName?: string };
export type TodoTask = { id: string; title: string; status: string; dueDateTime?: { dateTime: string; timeZone: string } };

let defaultListId: string | null = null;

async function listId(): Promise<string> {
  if (defaultListId) return defaultListId;
  const r = (await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists`)) as { value: TodoList[] };
  const list = r.value.find((l) => l.wellknownListName === 'defaultList') ?? r.value[0];
  if (!list) throw new Error('No Microsoft To Do list found.');
  defaultListId = list.id;
  return list.id;
}

export async function addTodo(title: string, dueIso?: string): Promise<TodoTask> {
  const body: Record<string, unknown> = { title };
  if (dueIso) body.dueDateTime = { dateTime: dueIso.slice(0, 19), timeZone: 'Asia/Singapore' };
  return (await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists/${await listId()}/tasks`, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as TodoTask;
}

export async function listTodos(limit = 25): Promise<TodoTask[]> {
  const r = (await authedFetch(
    MICROSOFT,
    `${GRAPH}/me/todo/lists/${await listId()}/tasks?$filter=status ne 'completed'&$top=${limit}`,
  )) as { value: TodoTask[] };
  return r.value;
}

export async function completeTodo(id: string) {
  await authedFetch(MICROSOFT, `${GRAPH}/me/todo/lists/${await listId()}/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  });
}
