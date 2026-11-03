import { db, Txn } from './db';
import { generateJson, userWithFile } from './gemini';

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
Set confident=false and write a short question when the merchant is ambiguous (e.g. PayNow/PayLah to a person, generic names, marketplaces).
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
  const { generateText } = await import('./gemini');
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
