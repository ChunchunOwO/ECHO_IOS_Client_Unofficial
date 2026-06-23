<p align="center">
  <img src="docs/app-icon.png" width="96" alt="ECHO iPhone icon" />
</p>

<h1 align="center">ECHO iPhone</h1>

<p align="center">
  An unofficial iPhone companion for <a href="https://github.com/Moekotori/ECHO">ECHO NEXT</a>.
</p>

<p align="center">
  <strong>English</strong> · <a href="README.md">中文</a> · <a href="RELEASE_NOTES.md">Release Notes</a>
</p>

![ECHO iPhone ACG preview](docs/preview.svg)

> This is an unofficial community project and is not maintained by the official ECHO NEXT project.

## What It Is

ECHO iPhone is an unofficial iPhone client for ECHO NEXT. It connects to the desktop app through EchoLink so the phone can show current playback, control playback, browse the library, and stream supported local audio from the PC to the iPhone.

It is not a standalone player. The desktop app still owns the library, queue, lyrics, artwork, and audio metadata. The iPhone app handles control, display, and phone-side streaming.

## Main Features

- Playback: play / pause, previous, next, seek, and volume control.
- Lyrics: loads desktop lyrics, supports LRC auto-scroll and tap-to-seek.
- Library: browse the PC library, search tracks, filter all / streamable / local.
- Streaming: supported local audio can be streamed from the PC to the phone.
- Queue: preview the current queue from the playback page.
- Audio tags: Local, streamable, WASAPI / ASIO, FLAC 48kHz/24bit, bitrate, duration, and related metadata.
- Settings: choose Chinese / English and choose which audio tags are shown.
- Connection: supports `echo://pair?...` pairing links and manual Host, Port, Token input.

## Requirements

- ECHO NEXT must be running on the desktop with EchoLink enabled.
- iPhone and PC must be on the same LAN.
- Windows Firewall must allow ECHO NEXT network access.
- Phone streaming depends on the desktop stream API and audio formats supported by iOS.
- Artwork, lyrics, and audio tags depend on data returned by the desktop app.

## Run Locally

```powershell
npm install
npm run start
```

Type check:

```powershell
npm.cmd run typecheck
```

iOS export check:

```powershell
npx.cmd expo export --platform ios --output-dir build\export-check
```

## Connect to the Desktop App

Pairing URI example:

```text
echo://pair?host=192.168.1.12&port=26789&token=...
```

Manual fields:

- Host: PC LAN IP, for example `192.168.2.27`
- Port: usually `26789`
- Token: copied from the ECHO NEXT EchoLink pairing screen

If connection fails, check LAN, firewall, EchoLink status, host IP, and iOS local network permission.

## EchoLink Endpoints Used

```text
GET  /echo-link/v1/status
GET  /echo-link/v1/library/tracks
GET  /echo-link/v1/library/albums
GET  /echo-link/v1/library/albums/:albumId/tracks
POST /echo-link/v1/playback/command
POST /echo-link/v1/library/tracks/:trackId/stream
GET  /echo-link/v1/library/tracks/:trackId/lyrics
```

Headers:

```text
Authorization: Bearer <token>
x-echo-link-version: 1
```

## Build Unsigned IPA

Windows can trigger the workflow, but actual iOS packaging requires macOS/Xcode.

1. Push the repo to GitHub.
2. Run `Build iOS unsigned IPA` in GitHub Actions.
3. Download the `ECHO-iPhone-unsigned-ipa` artifact.
4. Sign/install it with Sideloadly, AltStore, Xcode, or another tool.

Local Mac:

```bash
bash scripts/build-unsigned-ipa-for-sideloadly.sh
```

Output:

```text
build/ios-unsigned/ECHO-iPhone-unsigned.ipa
```

### Xcode Free Apple ID

```bash
bash scripts/build-free-apple-id-with-xcode.sh
```

The script opens the generated Xcode workspace. Select your Apple ID Team, connect the iPhone, then Run.

## Assets

- `docs/app-icon.png` is used by both README and Expo as the current app icon.
- `docs/app-icon.svg` is a lightweight display version of the same icon.
- `docs/preview.svg` is the README preview image.
- `Assets.car` can be placed at the repository root. The unsigned IPA script copies it into the final `.app`.
- Track artwork is loaded from EchoLink artwork URLs. If loading fails, the app keeps the stable artwork or shows the ECHO fallback.

## Project Structure

```text
App.tsx                         Main UI, playback controls, lyrics, and streaming logic
app.json                        Expo iOS config
src/echoLink/client.ts          EchoLink HTTP client
src/echoLink/types.ts           Mobile EchoLink types
src/echoLink/pairing.ts         Pairing URI parser
src/storage/connectionStore.ts  Local connection storage
scripts/                        iOS build helper scripts
.github/workflows/              Unsigned IPA workflow
docs/                           Icons, preview image, and README assets
```

## Upload Checklist

Recommended:

- `.github/workflows/build-ios-unsigned.yml`
- `.gitattributes`
- `.gitignore`
- `app.json`
- `App.tsx`
- `Assets.car`
- `package.json`
- `package-lock.json`
- `README.md`
- `README.en.md`
- `RELEASE_NOTES.md`
- `tsconfig.json`
- `docs/`
- `scripts/`
- `src/`

Do not upload:

- `node_modules/`
- `build/`
- Generated `.ipa` files

## Release Notes

See [RELEASE_NOTES.md](RELEASE_NOTES.md).
