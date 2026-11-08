import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { addDatabaseChangeListener } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';

// Live data. Every write to the SQLite file (from a screen, a sheet, a coach's
// tool call or a background sync) fires a change event. Screens subscribe with
// useLive(load) so they refresh the moment something changes, not only when
// you navigate back to them.

type Batch = { tables: Set<string>; firstAt: number };
type Listener = (b: Batch) => void;

const listeners = new Set<Listener>();
let pending: Batch | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

// Bookkeeping tables no screen shows; writes to them shouldn't refresh anything.
const SILENT = new Set(['notion_links']);

function queue(table: string) {
  if (SILENT.has(table)) return;
  if (!pending) pending = { tables: new Set(), firstAt: Date.now() };
  pending.tables.add(table);
  if (timer) return;
  // Writes arrive one row at a time; coalesce a burst into one refresh.
  timer = setTimeout(() => {
    const b = pending!;
    pending = null;
    timer = null;
    listeners.forEach((l) => {
      try {
        l(b);
      } catch {
        // one bad listener shouldn't stop the others
      }
    });
  }, 120);
}

function start() {
  if (started) return;
  started = true;
  addDatabaseChangeListener((e) => queue(e.tableName));
}

/** Signal a change that didn't go through SQLite (e.g. a Notion write). */
export function notifyChange(table = '*') {
  start();
  queue(table);
}

export function onDataChange(fn: Listener): () => void {
  start();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

type LiveOptions = {
  /** Only refresh when one of these tables changes. Default: any table. */
  tables?: string[];
  /** Never refresh for these tables (e.g. 'messages' while chatting). */
  ignore?: string[];
  /** Only listen while the screen is focused (default true). Components that aren't screens pass false. */
  focus?: boolean;
};

// Scheduling state for one useLive caller. Kept outside React state: it is
// only read and written inside effects and change callbacks, never in render.
class Runner {
  load: () => unknown = () => undefined;
  active = false;
  running = false;
  again = false;
  settledAt = 0;
  chained = false;
  seenLoad: unknown = null;

  async run(fromChange: boolean): Promise<void> {
    if (this.running) {
      if (fromChange) this.again = true;
      return;
    }
    this.running = true;
    try {
      await this.load();
    } catch {
      // screens surface their own errors
    } finally {
      this.running = false;
      this.settledAt = Date.now();
      if (this.again) {
        this.again = false;
        void this.run(true);
      }
    }
  }

  /** Takes the latest load; refetches if it changed while on screen. */
  setLoad(load: () => unknown) {
    const changed = this.seenLoad !== null && this.seenLoad !== load;
    this.load = load;
    this.seenLoad = load;
    if (changed && this.active) void this.run(false);
  }

  activate(fresh: boolean) {
    this.active = true;
    if (fresh) this.chained = false;
    void this.run(false);
  }

  deactivate() {
    this.active = false;
  }

  onBatch(b: Batch, want: string[] | null, skip: string[]) {
    if (!this.active) return;
    const hit = [...b.tables].some((t) => t === '*' || ((!want || want.includes(t)) && !skip.includes(t)));
    if (!hit) return;
    // A change that started while (or just after) our own load ran is
    // probably that load's write. Allow one follow-up, then settle.
    const selfish = this.running || b.firstAt - this.settledAt < 400;
    if (selfish && this.chained) return;
    this.chained = selfish;
    void this.run(true);
  }
}

/**
 * Runs `load` when the screen gains focus and again whenever the data changes
 * while it is on screen. Writes made by `load` itself can trigger at most one
 * follow-up refresh, so a load that also writes a cache can't loop.
 */
export function useLive(load: () => unknown, opts: LiveOptions = {}) {
  const { tables, ignore, focus = true } = opts;
  const [runner] = useState(() => new Runner());

  // Keep the latest load, and refetch when it changes (a different month,
  // id or filter means different data). Runs before the effects below.
  useLayoutEffect(() => runner.setLoad(load), [load, runner]);

  useFocusEffect(
    useCallback(() => {
      if (!focus) return;
      runner.activate(true);
      return () => runner.deactivate();
    }, [focus, runner]),
  );

  // Components that aren't screens listen for as long as they're mounted.
  useEffect(() => {
    if (focus) return;
    runner.activate(false);
    return () => runner.deactivate();
  }, [focus, runner]);

  const tablesKey = tables?.join(',') ?? '';
  const ignoreKey = ignore?.join(',') ?? '';
  useEffect(
    () => onDataChange((b) => runner.onBatch(b, tablesKey ? tablesKey.split(',') : null, ignoreKey ? ignoreKey.split(',') : [])),
    [tablesKey, ignoreKey, runner],
  );
}
