# The Oracle

A personal assistant and coach app for Android. It runs on your phone, keeps its memory on the phone, and calls Gemini directly. There is no server.

This is **Phase 0**: an Expo app with a dark theme, a Settings screen that stores your Gemini key in the Android Keystore, and one screen that sends a prompt to Gemini and shows the reply.

## Stack

- Expo SDK 58, React Native 0.88, TypeScript, Expo Router (`src/app/`)
- `expo-secure-store` for secrets, `expo-dev-client` for development builds
- Gemini called over REST with `fetch` (`src/lib/gemini.ts`), no SDK
- All colours, spacing and type live in `src/theme.ts`

## Get it on your phone (about 30 minutes the first time)

1. **Gemini key.** Create one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Use the same free-tier project as before.
2. **Install dependencies.** You need Node 20 or newer.
   ```sh
   npm install
   npx expo install --check   # confirms versions match SDK 58
   ```
3. **Build the development app once.** This makes an APK in Expo's cloud (free plan, no Android Studio needed).
   ```sh
   npx eas-cli@latest login            # free Expo account
   npx eas-cli@latest init             # links the project, writes the projectId into app.json
   npm run build:dev                   # eas build -p android --profile development
   ```
   When it finishes, open the link or scan the QR code on your phone, download the APK and install it. Allow "Install unknown apps" for your browser when Android asks.

   If you'd rather build locally, install Android Studio and run `npx expo run:android` with the phone plugged in over USB.
4. **Run it.**
   ```sh
   npx expo start            # add --tunnel if the phone and laptop aren't on the same Wi-Fi
   ```
   Open **The Oracle** on the phone and pick your laptop's server. Code changes reload instantly. You only rebuild the APK when a native module is added, which happens in Phase 3.
5. **Test.** Go to Settings, paste the key, save, then tap **Ask Gemini** on the home screen. You should see a reply and how long it took.

## If something goes wrong

| Symptom | Fix |
| --- | --- |
| `Gemini 404` | The model name is wrong. Change it in Settings (default `gemini-3.5-flash-lite`). |
| `Gemini 400 API key not valid` | Re-paste the key. |
| `Rate limited (429)` | Free-tier limit. Wait a minute, or use the AI Pro credits later. |
| The app can't find the dev server | Run `npx expo start --tunnel`. |

## Layout

```
src/
  app/          screens (Expo Router)
    _layout.tsx
    index.tsx   Phase 0 Gemini check
    settings.tsx
  lib/
    gemini.ts   REST client
    secrets.ts  key and model in secure storage
  theme.ts      design tokens
```

## Next: Phase 1

Coach chats (8 coaches plus HQ), SQLite memory shared across coaches, fact extraction, and picking a styling library (NativeWind or Uniwind) once it's confirmed working on SDK 58.
