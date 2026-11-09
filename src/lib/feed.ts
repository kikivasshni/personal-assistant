import { space, SPACES } from '@/data/spaces';
import { db, FeedItem, kvGet, kvSet } from './db';
import { generateJson } from './gemini';
import { getSecret } from './secrets';

// Goal Feed. YouTube Shorts are fetched automatically (official Data API).
// Pinterest boards come from their public RSS feeds. TikTok and Instagram
// have no feed API, so you paste or share links and the app keeps them.

export type Source = FeedItem['source'];

export function parseLink(url: string): { source: Source; embed: string | null; id: string | null } {
  const u = url.trim();
  let m: RegExpMatchArray | null;
  if ((m = u.match(/(?:youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{11})/)))
    return { source: 'youtube', id: m[1], embed: youtubeEmbed(m[1]) };
  if ((m = u.match(/tiktok\.com\/.*\/video\/(\d+)/)))
    return { source: 'tiktok', id: m[1], embed: `https://www.tiktok.com/player/v1/${m[1]}` };
  if (/vt\.tiktok\.com|vm\.tiktok\.com/.test(u)) return { source: 'tiktok', id: null, embed: null };
  if ((m = u.match(/instagram\.com\/(?:reel|reels|p)\/([\w-]+)/)))
    return { source: 'instagram', id: m[1], embed: `https://www.instagram.com/reel/${m[1]}/embed` };
  if (/pinterest\.|pin\.it/.test(u)) return { source: 'pinterest', id: null, embed: null };
  return { source: 'link', id: null, embed: null };
}

export function youtubeEmbed(id: string) {
  return `https://www.youtube.com/embed/${id}?playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${id}`;
}

async function insertItem(item: Omit<FeedItem, 'id' | 'created_at' | 'seen_at' | 'saved'> & { saved?: number }) {
  await (await db()).runAsync(
    'INSERT OR IGNORE INTO feed_items(source, url, embed_url, title, thumb, coach, saved, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
    item.source,
    item.url,
    item.embed_url,
    item.title,
    item.thumb,
    item.coach,
    item.saved ?? 0,
    Date.now(),
  );
}

// Save a TikTok / Instagram / YouTube / Pinterest link and tag it to a coach.
export async function saveLink(url: string, coachId?: string): Promise<FeedItem['source']> {
  let finalUrl = url.trim();
  let parsed = parseLink(finalUrl);
  let title: string | null = null;
  let thumb: string | null = null;

  if (parsed.source === 'tiktok') {
    // Short share links (vt./vm.tiktok.com) redirect to the full video URL.
    if (!parsed.id) {
      try {
        const r = await fetch(finalUrl);
        if (/\/video\/\d+/.test(r.url)) {
          finalUrl = r.url.split('?')[0];
          parsed = parseLink(finalUrl);
        }
      } catch {
        // keep the short link
      }
    }
    try {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(finalUrl)}`);
      const j = (await r.json()) as { title?: string; thumbnail_url?: string; html?: string };
      title = j.title ?? null;
      thumb = j.thumbnail_url ?? null;
      const id = j.html?.match(/data-video-id="(\d+)"/)?.[1];
      if (id) parsed = { source: 'tiktok', id, embed: `https://www.tiktok.com/player/v1/${id}` };
    } catch {
      // keep the bare link
    }
  }
  if (parsed.source === 'youtube' && parsed.id) {
    thumb = `https://i.ytimg.com/vi/${parsed.id}/hqdefault.jpg`;
    try {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(finalUrl)}`);
      title = ((await r.json()) as { title?: string }).title ?? null;
    } catch {
      // fine without a title
    }
  }

  const tag = coachId ?? (await guessCoach(`${title ?? ''} ${finalUrl}`));
  await insertItem({ source: parsed.source, url: finalUrl, embed_url: parsed.embed, title, thumb, coach: tag, saved: 1 });
  return parsed.source;
}

async function guessCoach(text: string): Promise<string> {
  try {
    const r = await generateJson<{ coach: string }>(
      `Which coach does this saved clip best support? Options: ${SPACES.map((c) => `${c.id} (${c.tagline})`).join(', ')}.
Clip: ${text}
Return {"coach": "<id>"}`,
      { temperature: 0 },
    );
    return space(r.coach).id;
  } catch {
    return 'hq';
  }
}

type YtSearch = {
  items?: { id: { videoId?: string }; snippet: { title: string; thumbnails?: { high?: { url: string } } } }[];
  error?: { message?: string };
};

// Fetch fresh Shorts for each coach. Uses ~100 quota units per search; the
// free quota is 10,000 a day, so refreshing once or twice a day is fine.
export async function refreshYouTube(coachIds?: string[]): Promise<number> {
  const key = await getSecret('youtubeApiKey');
  if (!key) throw new Error('Add a YouTube Data API key in Settings to fetch Shorts.');
  const targets = (coachIds ?? SPACES.map((c) => c.id)).map(space);
  let added = 0;
  for (const c of targets) {
    const seeds = c.feedSeeds;
    const seed = seeds[Math.floor(Math.random() * seeds.length)];
    const q = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      videoDuration: 'short',
      videoEmbeddable: 'true',
      maxResults: '6',
      relevanceLanguage: 'en',
      safeSearch: 'moderate',
      q: `${seed} #shorts`,
      key,
    });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${q}`);
    const j = (await r.json()) as YtSearch;
    if (!r.ok) throw new Error(`YouTube: ${j.error?.message ?? r.status}`);
    for (const it of j.items ?? []) {
      const id = it.id.videoId;
      if (!id) continue;
      await insertItem({
        source: 'youtube',
        url: `https://www.youtube.com/shorts/${id}`,
        embed_url: youtubeEmbed(id),
        title: it.snippet.title,
        thumb: it.snippet.thumbnails?.high?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        coach: c.id,
      });
      added++;
    }
  }
  await kvSet('feed_refreshed_at', String(Date.now()));
  return added;
}

export async function searchClips(query: string, coachId: string): Promise<number> {
  const key = await getSecret('youtubeApiKey');
  if (!key) return 0;
  const q = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoDuration: 'short',
    videoEmbeddable: 'true',
    maxResults: '5',
    q: `${query} #shorts`,
    key,
  });
  const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${q}`);
  const j = (await r.json()) as YtSearch;
  let n = 0;
  for (const it of j.items ?? []) {
    const id = it.id.videoId;
    if (!id) continue;
    await insertItem({
      source: 'youtube',
      url: `https://www.youtube.com/shorts/${id}`,
      embed_url: youtubeEmbed(id),
      title: it.snippet.title,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      coach: coachId,
      saved: 1,
    });
    n++;
  }
  return n;
}

// Pinterest boards: "username/board-name" lines; each public board has an RSS feed.
export async function getPinterestBoards(): Promise<string[]> {
  const raw = (await kvGet('pinterest_boards')) ?? '';
  return raw
    .split('\n')
    .map((s) => s.trim().replace(/^https?:\/\/(www\.)?pinterest\.[a-z.]+\//, '').replace(/\/$/, ''))
    .filter(Boolean);
}

export async function refreshPinterest(): Promise<number> {
  const boards = await getPinterestBoards();
  let added = 0;
  for (const b of boards) {
    try {
      const r = await fetch(`https://www.pinterest.com/${b}.rss`);
      const xml = await r.text();
      const items = xml.split('<item>').slice(1, 26);
      for (const it of items) {
        const link = it.match(/<link>(.*?)<\/link>/)?.[1];
        const img = it.match(/<img[^>]+src="([^"]+)"/)?.[1];
        const title = it.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] ?? null;
        if (!link || !img) continue;
        await insertItem({
          source: 'pinterest',
          url: link,
          embed_url: null,
          title,
          thumb: img.replace('/236x/', '/736x/'),
          coach: 'manifest',
        });
        added++;
      }
    } catch {
      // skip boards that fail
    }
  }
  return added;
}

export async function feedItems(coachId: string | 'all', limit = 40): Promise<FeedItem[]> {
  const d = await db();
  const where = coachId === 'all' ? '' : 'WHERE coach = ?';
  const args = coachId === 'all' ? [] : [coachId];
  // Unseen first, then saved, newest first.
  return d.getAllAsync<FeedItem>(
    `SELECT * FROM feed_items ${where} ORDER BY (seen_at IS NULL) DESC, saved DESC, created_at DESC LIMIT ${limit}`,
    ...args,
  );
}

export async function markSeen(id: number) {
  await (await db()).runAsync('UPDATE feed_items SET seen_at = ? WHERE id = ? AND seen_at IS NULL', Date.now(), id);
}

export async function toggleSaved(id: number) {
  await (await db()).runAsync('UPDATE feed_items SET saved = 1 - saved WHERE id = ?', id);
}

export async function removeItem(id: number) {
  await (await db()).runAsync('DELETE FROM feed_items WHERE id = ?', id);
}

export async function randomClipFor(coachId: string): Promise<FeedItem | null> {
  return (await db()).getFirstAsync<FeedItem>(
    'SELECT * FROM feed_items WHERE coach = ? AND embed_url IS NOT NULL ORDER BY RANDOM() LIMIT 1',
    coachId,
  );
}
