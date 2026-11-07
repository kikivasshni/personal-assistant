# Kairos

Kairos is the ancient Greek word for the right moment to act. This is a personal life OS for Android: coaches for every area of your life that share one memory, keep your Notion up to date, and nag you until you follow through. No server.

- **Today**: an AI briefing, a mood check-in (with a monthly mood calendar), your to-dos for today and this week, locked-in commitments, calendar, and quick body stats (food, steps, cycle day).
- **Life**: your areas as rooms, each with its own cards:
  - **Planner**, **Motivation**, **Career**, **Wellbeing**: one coach each.
  - **Health**: Food & diet, Workouts (Samsung Health steps and sessions), PCOS & cycle (phase-aware advice, cycle tracking).
  - **Study**: AWS SAP-C03, Terraform Associate, SMU modules, plus any topic you add. Exam countdowns and study streaks.
  - **Hobbies**: Electric guitar (song list, tabs rendered on a fretboard card, a coach that chases you to practise), Kathak, Photography, F1, Aviation, plus any hobby you add.
  - **Manifestation**: Neville's teachings, and My desires (what you're assuming vs what has manifested, with morning and night affirmations as notifications).
  - **Finance**: Spending (weekly, monthly, yearly; synced to a Notion overview page), Monthly statement (upload a DBS PDF; Kairos asks about anything unclear, one question at a time), and an Advisor / trading coach that knows your numbers.
- Every card is a chat with a live panel on top (macros, steps, cycle, exam countdown, songs, desires) that folds away while you type.
- **Notion**: Kairos maps every page your integration can see. Coaches append to the right page, or create a new page where it belongs, after reading a sibling page to copy your structure.
- **Tasks**: Microsoft To Do is the hub. Samsung Reminder syncs with it, and a Notion tasks database is kept in step both ways.
- **Nags**: commitments get a reminder, a firmer one 30 minutes later, and an escalation from the Motivation coach at 75 minutes.
- **Goal Feed**: YouTube Shorts per area, Pinterest boards, and TikTok, Reels and Shorts links you save.

Everything is stored in SQLite on the phone. Keys and tokens are kept in the Android Keystore. Icons are Microsoft's Fluent Emoji 3D (MIT, see `assets/icons3d/LICENSE.txt`).

## Stack

Expo SDK 58 · React Native 0.88 · TypeScript · Expo Router · expo-sqlite · expo-notifications · Gemini REST API · Fraunces + Nunito fonts.

```
src/
  app/                   screens (Expo Router)
    (tabs)/              Today, Life, Feed, You
    space/[id].tsx       an area and its cards
    chat/[id].tsx        chat with any card (e.g. /chat/hobby.guitar)
    finance/             spending overview, statement upload + questions
    mood.tsx desires.tsx songs/ food.tsx notes/ exam.tsx memory.tsx
  components/            UI kit, Icon3D, RichText (tabs, tables, code), ThreadPanel, NotionPicker
  data/spaces.ts         areas, cards, personas, tools, starters
  lib/
    agent.ts             chat loop, per-card context, streaming, function calling
    gemini.ts            REST client: retries, model fallback, streaming, thinking level
    tools.ts             tools the coaches can call
    tasks.ts             To Do + Notion tasks sync
    health.ts            Samsung Health via Health Connect, workouts, cycle
    desires.ts           desires and scheduled affirmations
    hobbies.ts           songs, practice logs, your own cards
    moods.ts finance.ts food.ts notes.ts memory.ts commitments.ts nags.ts feed.ts
    integrations/        oauth, microsoft (To Do), google (Calendar), notion (workspace map)
  theme.ts               colours, fonts, spacing
assets/icons3d/          3D icons
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

Open **Kairos** on the phone and pick the dev server. JavaScript changes reload instantly. You only rebuild the APK when native config changes, for example after adding the Google scheme in step 5.

For a standalone app that doesn't need your laptop running, use `npm run build:preview` and install that APK instead.

## 2. Gemini (required)

1. Create a key at <https://aistudio.google.com/apikey>.
2. In the app, open **You → Gemini**, paste the key, then tap **Test Gemini**.

The defaults are `gemini-3.5-flash-lite` for chat and `gemini-3.8-flash` for briefings, PDFs, notes and photos.

- **503 "high demand"** means Google's servers for that model are overloaded. It isn't your quota. Kairos retries twice with backoff, then switches to your other model. Free-tier traffic is the first to be shed when a model is busy, so turning on billing for the API key (Tier 1) makes 503s much rarer.
- **429** means you've hit your rate limit. Kairos switches to the other model straight away.
- **Speed**: chat streams the reply as it's written and runs with low thinking effort. A lite model for chat is the fastest choice. Keep the bigger model for the heavy jobs.
- **404**: the model name has changed, so update it there.

## 3. Notifications and battery (do this or nags arrive late)

1. **You → Nags and daily rhythm → Save daily schedule.** Allow notifications when asked.
2. Tap **Allow exact alarms** and turn it on for Kairos.
3. On Samsung, go to **Settings → Battery → Background usage limits → Never sleeping apps** and add Kairos.
4. Tap **Send a test nag**. It should arrive within 5 seconds.

## 4. Microsoft To Do (and Samsung Reminder)

Use your existing Azure app registration:

1. Go to **Azure portal → App registrations → your app → Authentication → Add a platform → Mobile and desktop applications**.
2. Add the custom redirect URI `oracle://auth`. Leave "Allow public client flows" on.
3. In the app, open **You → Microsoft To Do**, paste the Application (client) ID, then tap **Connect Microsoft**.
4. In **Samsung Reminder → Settings**, turn on **Sync with Microsoft To Do**. Tasks you add in Kairos now show up there, and ticking them off anywhere syncs back.

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
2. In Notion, open each top-level page Kairos should work in (school notes, hobbies, finance, your tasks database) and choose **••• → Connections → add your integration**. Sub-pages are included.
3. In the app, open **You → Notion**, paste the token and tap **Scan my Notion**. Check that it found your **Tasks database** and a page for **Finance reports** (or pick them).

The coaches get an outline of your workspace. When you tell one something worth keeping, it appends to the matching page, or reads a sibling page and creates a new one in the same style and place. The map refreshes every 6 hours, or when you scan again.

## 7. Samsung Health

1. Rebuild the development APK once (`npm run build:dev`). Health Connect is a native module, so it isn't in older builds.
2. In **Samsung Health → Settings → Health Connect**, allow Samsung Health to share steps, exercise, sleep, weight and cycle data.
3. In Kairos, open **You → Samsung Health → Connect** and allow the permissions.

You don't need Google's Health Connect approval for a sideloaded APK. That's only for the Play Store.

## 8. Goal Feed

- **YouTube**: in the Google Cloud console, enable **YouTube Data API v3** and create an API key, then paste it under **You → Goal Feed**. The free quota is 10,000 units a day, and a full refresh uses about 900.
- **Pinterest**: add public boards, one per line, as `username/board-name`. The app reads each board's RSS feed.
- **TikTok and Instagram**: these have no feed API, so in either app tap **Share → Copy link**, then in Goal Feed tap **+ → Paste**. The app tags each clip to a coach automatically.

If a YouTube clip won't play inline, tap the open icon to watch it in YouTube.

## 9. Automatic builds

`.eas/workflows/build-android.yml` builds a new preview APK (installable on Android) on every push to `main`, once the GitHub repo is linked to the Expo project (expo.dev → project → Settings → GitHub).

## 10. Backups

Everything lives on the phone. Use **You → Export backup** now and then and save the JSON to Google Drive.

## Costs

The whole setup runs on free tiers: Gemini (free tier), YouTube Data API, Notion, Microsoft Graph, Google Calendar and Expo's free builds. Nothing is hosted.

## Development

```sh
npx tsc --noEmit                              # typecheck
npx eslint src                                # lint
npx expo export --platform android            # check the JS bundle builds
```
