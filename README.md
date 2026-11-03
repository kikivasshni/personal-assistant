# The Oracle

A personal AI life OS for Android: nine coaches that share one memory, nag you until you follow through, and live entirely on your phone. No server.

- **Today**: an AI morning briefing built from your calendar, To Do and goals, a mood check-in, today's commitments, food totals and your 7-day follow-through rate. After 6pm it switches to the evening audit.
- **Coaches**: The Oracle (chief of staff), plus Manifest, Body, Study, Drive, Career, Play, Money and Calm. Each one has its own persona and tools, and they all read the same memory.
- **Nags**: when you commit to something, the app schedules a reminder, a firmer one 30 minutes later, and a Drive coach escalation at 75 minutes. Tap **Done** on the notification to cancel the rest, or **Snooze 30 min**.
- **Goal Feed**: YouTube Shorts fetched for each coach's goals, your Pinterest boards, and TikTok, Reels and Shorts links you save. It stops after 10 clips and points you at your next commitment.
- **Studio**: food photo to macros with PCOS-aware notes, DBS statement PDF to categorised spending (it asks you about the ambiguous ones and remembers your answers), and lecture slides to notes, flashcards and quizzes.
- **Integrations**: Microsoft To Do, Google Calendar (so it also shows in Notion Calendar), and Notion (Journal entries and school notes).

Everything is stored in SQLite on the phone. Keys and tokens are kept in the Android Keystore. The only network calls go out to Gemini, Microsoft, Google, Notion, YouTube and Pinterest.

## Stack

Expo SDK 58 · React Native 0.88 · TypeScript · Expo Router · expo-sqlite · expo-notifications · Gemini REST API · Fraunces + Nunito fonts.

```
src/
  app/                 screens (Expo Router)
    (tabs)/            Today, Coaches, Feed, Studio, You
    chat/[coach].tsx   chat with any coach
    studio/            food, money, notes
    notes/[id].tsx     note detail and flashcards
    memory.tsx         profile and shared memory
  components/          UI kit (cards, buttons, pills) and Markdown renderer
  data/coaches.ts      the 9 coaches: personas, tools, starter prompts, feed topics
  lib/
    agent.ts           chat loop, context building, function calling
    tools.ts           tools the coaches can call
    memory.ts          profile, facts, cross-coach digest
    commitments.ts     commitments and nag chains
    nags.ts            notifications, daily briefing/audit schedule
    briefing.ts        morning briefing
    feed.ts            YouTube, Pinterest, saved links
    food.ts finance.ts notes.ts backup.ts
    integrations/      oauth, microsoft (To Do), google (Calendar), notion
  theme.ts             colours, fonts, spacing: restyle everything here
```

## 1. Get it on your phone

You need Node 20+ and a free Expo account.

```sh
npm install
npx expo install --check        # confirms versions match SDK 58
npx eas-cli@latest login
npx eas-cli@latest init         # links the project and writes the projectId into app.json
npm run build:dev               # cloud build of the development APK
```

When the build finishes, open the link on your phone, install the APK, and allow "Install unknown apps" for your browser. Then:

```sh
npx expo start                  # add --tunnel if phone and laptop aren't on the same Wi-Fi
```

Open **The Oracle** on the phone and pick the dev server. JavaScript changes reload instantly. You only rebuild the APK when native config changes, for example after adding the Google scheme in step 5.

For a standalone app that doesn't need your laptop running, use `npm run build:preview` and install that APK instead.

## 2. Gemini (required)

1. Create a key at <https://aistudio.google.com/apikey>.
2. In the app, open **You → Gemini**, paste the key, then tap **Test Gemini**.

The defaults are `gemini-3.5-flash-lite` for chat and `gemini-3.8-flash` for briefings, PDFs, notes and photos. If you hit a `404`, the model name has changed, so update it there. If you hit a `429`, you've reached the free-tier limit.

## 3. Notifications and battery (do this or nags arrive late)

1. **You → Nags and daily rhythm → Save daily schedule.** Allow notifications when asked.
2. Tap **Allow exact alarms** and turn it on for The Oracle.
3. On Samsung, go to **Settings → Battery → Background usage limits → Never sleeping apps** and add The Oracle.
4. Tap **Send a test nag**. It should arrive within 5 seconds.

## 4. Microsoft To Do

Use your existing Azure app registration:

1. Go to **Azure portal → App registrations → your app → Authentication → Add a platform → Mobile and desktop applications**.
2. Add the custom redirect URI `oracle://auth`. Leave "Allow public client flows" on.
3. In the app, open **You → Microsoft To Do**, paste the Application (client) ID, then tap **Connect Microsoft**.

## 5. Google Calendar

1. In the Google Cloud console, enable the **Google Calendar API**.
2. Set up the **OAuth consent screen**: External, add yourself as a test user, and add the scope `.../auth/calendar.events`.
3. Under **Credentials → Create OAuth client ID**, choose type **iOS** with bundle ID `com.kirthi.oracle`. The iOS type is deliberate: it lets the app sign in through the browser on Android without a client secret.
4. Copy the client ID. Its reversed form, `com.googleusercontent.apps.<the part before .apps.googleusercontent.com>`, must go into `app.json`:
   ```json
   "scheme": ["oracle", "com.googleusercontent.apps.1234567890-abcdef"]
   ```
   The app shows the exact value under **You → Google Calendar** once you paste the ID.
5. Rebuild the dev APK (`npm run build:dev`) and install it, then tap **Connect Google**.

Events the coaches add go to your primary Google Calendar, so they also appear in Notion Calendar.

## 6. Notion

1. Create an internal integration at <https://www.notion.so/my-integrations> and copy the token.
2. Open your **Journal** database and choose **••• → Connections → add your integration**. Do the same for the page where school notes should go.
3. In the app, open **You → Notion**. Paste the token, the Journal database link and the notes page link, then tap **Test Notion**.

## 7. Goal Feed

- **YouTube**: in the Google Cloud console, enable **YouTube Data API v3** and create an API key, then paste it under **You → Goal Feed**. The free quota is 10,000 units a day, and a full refresh uses about 900.
- **Pinterest**: add public boards, one per line, as `username/board-name`. The app reads each board's RSS feed.
- **TikTok and Instagram**: these have no feed API, so in either app tap **Share → Copy link**, then in Goal Feed tap **+ → Paste**. The app tags each clip to a coach automatically.

If a YouTube clip won't play inline, tap the open icon to watch it in YouTube.

## 8. Backups

Everything lives on the phone. Use **You → Export backup** now and then and save the JSON to Google Drive.

## Costs

The whole setup runs on free tiers: Gemini (free tier), YouTube Data API, Notion, Microsoft Graph, Google Calendar and Expo's free builds. Nothing is hosted.

## Development

```sh
npx tsc --noEmit                              # typecheck
npx expo export --platform android            # check the JS bundle builds
```
