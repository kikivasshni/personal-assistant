import { addDays, db, dayKey, kvGet, kvSet, Txn } from './db';
import { generateJson, generateText, userWithFile } from './gemini';
import { ensurePage, replacePage, workspaceMap } from './integrations/notion';
import { budgets, pushToLedger } from './integrations/secondBrain';

export const CATEGORIES = [
  'Food & drinks',
  'Groceries',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Bills & utilities',
  'Health & fitness',
  'Education',
  'Entertainment',
  'Travel',
  'Family',
  'Transfers',
  'Investing',
  'Income',
  'Other',
] as const;

type Parsed = {
  statement: string;
  transactions: { date: string; merchant: string; amount: number; category: string; confident: boolean; question?: string }[];
};

// Reads a DBS e-statement PDF. Known merchants use your saved rules; anything
// Gemini isn't sure about is flagged for you to review.
export async function importStatement(base64: string): Promise<{ statement: string; count: number; review: number }> {
  const d = await db();
  const rules = await d.getAllAsync<{ merchant: string; category: string }>('SELECT * FROM merchant_rules');
  const parsed = await generateJson<Parsed>(
    [
      userWithFile(
        `This is a DBS/POSB bank or credit card e-statement from Singapore. Extract every transaction.
Amounts: positive for money spent/out, negative for money received/in (salary, refunds, incoming transfers). SGD.
Categorise each into exactly one of: ${CATEGORIES.join(', ')}.
Known merchant rules (always follow): ${rules.map((r) => `${r.merchant} => ${r.category}`).join('; ') || 'none yet'}.
Set confident=false and write a short, friendly question when you can't tell what it was for (PayNow/PayLah to a person, generic names, marketplaces like Shopee/Lazada, NETS/QR payments, unclear abbreviations).
Clean merchant names (e.g. "GRAB* A-1234" => "Grab").
Return JSON: {"statement": "e.g. DBS Oct 2026", "transactions": [{"date": "YYYY-MM-DD", "merchant": "", "amount": 0, "category": "", "confident": true, "question": ""}]}`,
        'application/pdf',
        base64,
      ),
    ],
    { heavy: true, temperature: 0 },
  );
  const ruleMap = new Map(rules.map((r) => [r.merchant.toLowerCase(), r.category]));
  let review = 0;
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM transactions WHERE statement = ?', parsed.statement);
    for (const t of parsed.transactions ?? []) {
      const ruled = ruleMap.get(t.merchant.toLowerCase());
      const needs = !ruled && !t.confident;
      if (needs) review++;
      await d.runAsync(
        'INSERT INTO transactions(statement, date, merchant, amount, category, needs_review, question) VALUES(?, ?, ?, ?, ?, ?, ?)',
        parsed.statement,
        t.date,
        t.merchant,
        Number(t.amount) || 0,
        ruled ?? t.category ?? 'Other',
        needs ? 1 : 0,
        t.question ?? null,
      );
    }
  });
  return { statement: parsed.statement, count: parsed.transactions?.length ?? 0, review };
}

export async function statements(): Promise<string[]> {
  const r = await (await db()).getAllAsync<{ statement: string }>(
    'SELECT statement FROM transactions GROUP BY statement ORDER BY MAX(date) DESC',
  );
  return r.map((x) => x.statement);
}

export async function transactions(statement: string): Promise<Txn[]> {
  return (await db()).getAllAsync<Txn>('SELECT * FROM transactions WHERE statement = ? ORDER BY date DESC', statement);
}

export async function categorise(t: Txn, category: string, remember: boolean) {
  const d = await db();
  await d.runAsync('UPDATE transactions SET category = ?, needs_review = 0 WHERE id = ?', category, t.id);
  if (remember) {
    await d.runAsync(
      'INSERT INTO merchant_rules(merchant, category) VALUES(?, ?) ON CONFLICT(merchant) DO UPDATE SET category = excluded.category',
      t.merchant,
      category,
    );
    await d.runAsync('UPDATE transactions SET category = ?, needs_review = 0 WHERE merchant = ?', category, t.merchant);
  }
}

export function byCategory(txns: Txn[]) {
  const map = new Map<string, number>();
  for (const t of txns) if (t.amount > 0) map.set(t.category ?? 'Other', (map.get(t.category ?? 'Other') ?? 0) + t.amount);
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

export async function spendingReport(statement: string): Promise<string> {
  const txns = await transactions(statement);
  const cats = byCategory(txns);
  const spent = cats.reduce((a, c) => a + c.total, 0);
  const income = -txns.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0);
  return generateText(
    `You are kirthi's finance coach. Write a short monthly spending report (max 160 words, plain sentences, no headings) for ${statement}.
Total spent SGD ${spent.toFixed(2)}, money in SGD ${income.toFixed(2)}.
By category: ${cats.map((c) => `${c.category} ${c.total.toFixed(2)}`).join(', ')}.
Top merchants: ${txns
      .filter((t) => t.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8)
      .map((t) => `${t.merchant} ${t.amount}`)
      .join(', ')}.
Point out one pattern, one easy saving, and tie it to their goal of improving their family's situation.`,
    { heavy: true },
  );
}

// ---------- clarifying questions ----------

export async function pendingQuestions(): Promise<Txn[]> {
  return (await db()).getAllAsync<Txn>('SELECT * FROM transactions WHERE needs_review = 1 ORDER BY date DESC');
}

type ProbeResult = { category: string; label: string; remember: boolean; follow_up: string };

// Interprets a free-text answer ("dinner with Priya, she paid me back half").
// If the answer isn't enough, it asks a follow-up and the item stays open.
export async function answerQuestion(t: Txn, answer: string): Promise<{ done: boolean; followUp?: string; category?: string }> {
  const r = await generateJson<ProbeResult>(
    `A bank transaction needs categorising. Merchant: "${t.merchant}", SGD ${t.amount} (${t.amount < 0 ? 'money in' : 'money out'}), date ${t.date}.
The question asked was: "${t.question ?? 'What was this?'}". kirthi answered: "${answer}".
Pick exactly one category from: ${CATEGORIES.join(', ')}.
label: a short note on what it was (e.g. "Dinner with Priya").
remember: true only if every future payment to this same merchant will be the same kind of thing (e.g. a named shop, or a person they always pay for the same reason).
follow_up: only if the answer is too vague to categorise, one short question; otherwise "".
Return JSON: {"category": "", "label": "", "remember": false, "follow_up": ""}`,
    { temperature: 0 },
  );
  if (r.follow_up?.trim()) {
    await (await db()).runAsync('UPDATE transactions SET question = ? WHERE id = ?', r.follow_up.trim(), t.id);
    return { done: false, followUp: r.follow_up.trim() };
  }
  const category = (CATEGORIES as readonly string[]).includes(r.category) ? r.category : 'Other';
  await categorise(t, category, !!r.remember);
  await (await db()).runAsync('UPDATE transactions SET note = ? WHERE id = ?', r.label || answer, t.id);
  return { done: true, category };
}

// ---------- weekly / monthly / yearly ----------

export type Bucket = { key: string; label: string; spent: number; income: number };
export type SpendSummary = {
  week: number;
  month: number;
  year: number;
  lastMonth: number;
  months: Bucket[]; // last 12, oldest first
  weeks: Bucket[]; // last 8, oldest first
  years: Bucket[];
  categories: { month: { category: string; total: number }[]; year: { category: string; total: number }[] };
  latest: string | null; // date of the newest transaction
};

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export async function spendSummary(): Promise<SpendSummary> {
  const all = await (await db()).getAllAsync<Txn>('SELECT * FROM transactions');
  // Transfers between your own accounts aren't spending.
  const spend = all.filter((t) => t.amount > 0 && t.category !== 'Transfers');
  const sum = (list: Txn[]) => Math.round(list.reduce((a, t) => a + t.amount, 0) * 100) / 100;
  const now = new Date();
  const ym = (d: Date) => dayKey(d).slice(0, 7);
  const thisMonth = ym(now);
  const lastMonthKey = ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const thisYear = String(now.getFullYear());
  const weekStart = dayKey(mondayOf(now));

  const months: Bucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = ym(d);
    months.push({
      key,
      label: d.toLocaleDateString([], { month: 'short' }),
      spent: sum(spend.filter((t) => t.date.startsWith(key))),
      income: -sum(all.filter((t) => t.amount < 0 && t.date.startsWith(key))),
    });
  }
  const weeks: Bucket[] = [];
  for (let i = 7; i >= 0; i--) {
    const start = mondayOf(addDays(now, -7 * i));
    const from = dayKey(start);
    const to = dayKey(addDays(start, 7));
    weeks.push({
      key: from,
      label: start.toLocaleDateString([], { day: 'numeric', month: 'short' }),
      spent: sum(spend.filter((t) => t.date >= from && t.date < to)),
      income: 0,
    });
  }
  const yearKeys = [...new Set(all.map((t) => t.date.slice(0, 4)))].sort();
  const years = yearKeys.map((y) => ({
    key: y,
    label: y,
    spent: sum(spend.filter((t) => t.date.startsWith(y))),
    income: -sum(all.filter((t) => t.amount < 0 && t.date.startsWith(y))),
  }));
  const dates = all.map((t) => t.date).sort();
  return {
    week: sum(spend.filter((t) => t.date >= weekStart)),
    month: sum(spend.filter((t) => t.date.startsWith(thisMonth))),
    lastMonth: sum(spend.filter((t) => t.date.startsWith(lastMonthKey))),
    year: sum(spend.filter((t) => t.date.startsWith(thisYear))),
    months,
    weeks,
    years,
    categories: {
      month: byCategory(spend.filter((t) => t.date.startsWith(thisMonth))),
      year: byCategory(spend.filter((t) => t.date.startsWith(thisYear))),
    },
    latest: dates.length ? dates[dates.length - 1] : null,
  };
}

// A compact money picture for the advisor coach.
export async function financeContext(): Promise<string> {
  const s = await spendSummary();
  if (!s.latest) return 'No bank statements uploaded yet.';
  const recent = s.months.filter((m) => m.spent || m.income).slice(-6);
  return [
    `Statements up to ${s.latest}.`,
    `Spent this week SGD ${s.week}, this month ${s.month}, last month ${s.lastMonth}, this year ${s.year}.`,
    `Monthly (spent / in): ${recent.map((m) => `${m.label} ${m.spent} / ${m.income}`).join('; ')}.`,
    `This year by category: ${s.categories.year.map((c) => `${c.category} ${c.total.toFixed(0)}`).join(', ')}.`,
    await budgets()
      .then((b) => (Object.keys(b).length ? `Monthly budgets (SGD): ${Object.entries(b).map(([k, v]) => `${k} ${v}`).join(', ')}.` : ''))
      .catch(() => ''),
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------- Notion ----------

// Where finance pages live: your choice, or a page called Finance / Money / Budget.
export async function financeNotionParent(): Promise<string | null> {
  const chosen = await kvGet('notion_finance_page');
  if (chosen) return chosen;
  const nodes = await workspaceMap();
  return nodes.find((n) => n.kind === 'page' && /^(finance|finances|money|budget|personal finance)/i.test(n.title))?.id ?? null;
}

export async function setFinanceNotionParent(id: string) {
  await kvSet('notion_finance_page', id);
}

const money = (n: number) => n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cell = (s: string) => s.replace(/\|/g, '/');

function table(head: string[], rows: string[][]) {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export class NoFinancePageError extends Error {}

// Rewrites the "Spending overview" master page, plus one report page per statement.
export async function syncFinanceToNotion(): Promise<string> {
  const parent = await financeNotionParent();
  if (!parent) throw new NoFinancePageError('Choose the Notion page your finance reports should live under.');
  const s = await spendSummary();
  const md = [
    `> Kept up to date by Kairos. Last sync ${new Date().toLocaleString('en-SG')}. Statements up to ${s.latest ?? '-'}.`,
    '## At a glance',
    table(['Period', 'Spent (SGD)'], [
      ['This week', money(s.week)],
      ['This month', money(s.month)],
      ['Last month', money(s.lastMonth)],
      ['This year', money(s.year)],
    ]),
    '## Yearly',
    table(['Year', 'Spent', 'Money in'], s.years.map((y) => [y.label, money(y.spent), money(y.income)])),
    '## Monthly',
    table(['Month', 'Spent', 'Money in', 'Net'], s.months.map((m) => [m.key, money(m.spent), money(m.income), money(m.income - m.spent)])),
    '## Weekly (last 8 weeks)',
    table(['Week of', 'Spent'], s.weeks.map((w) => [w.label, money(w.spent)])),
    '## This month by category',
    table(['Category', 'SGD'], s.categories.month.map((c) => [c.category, money(c.total)])),
    '## This year by category',
    table(['Category', 'SGD'], s.categories.year.map((c) => [c.category, money(c.total)])),
  ].join('\n\n');
  // Categorised transactions also go into the financial ledger database.
  const all = await (await db()).getAllAsync<Txn>('SELECT * FROM transactions WHERE needs_review = 0 ORDER BY date');
  await pushToLedger(all).catch(() => 0);
  const overview = await ensurePage(parent, 'Spending overview');
  await replacePage(overview.id, md);

  for (const st of await statements()) {
    const txns = await transactions(st);
    const stamp = `${txns.length}:${txns.filter((t) => t.needs_review).length}`;
    const key = `notion_report_${st}`;
    if ((await kvGet(key)) === stamp) continue; // unchanged since last sync
    const cats = byCategory(txns.filter((t) => t.category !== 'Transfers'));
    const page = await ensurePage(overview.id, `Spending · ${st}`);
    const report = await spendingReport(st).catch(() => '');
    await replacePage(
      page.id,
      [
        report,
        '## By category',
        table(['Category', 'SGD'], cats.map((c) => [c.category, money(c.total)])),
        '## Transactions',
        table(
          ['Date', 'Merchant', 'Category', 'SGD', 'Note'],
          txns.slice(0, 95).map((t) => [t.date, cell(t.merchant), t.category ?? '', money(t.amount), cell(t.note ?? '')]),
        ),
      ].join('\n\n'),
    );
    await kvSet(key, stamp);
  }
  return overview.url;
}
