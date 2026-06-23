<p align="center">
  <img src="docs/app-icon.png" width="96" alt="ECHO iPhone app icon" />
</p>

<h1 align="center">ECHO iPhone</h1>

<p align="center">
  An unofficial iPhone control / streaming client built for <a href="https://github.com/Moekotori/ECHO">ECHO NEXT</a>.
</p>

<p align="center">
  <a href="README.md">中文</a> · <strong>English</strong> · <a href="RELEASE_NOTES.md">Release Notes</a>
</p>

> This is an unofficial community project and is not affiliated with the official ECHO NEXT repository.

> If you have any ownership claims, suggestions, or feedback, you can contact @白雪ユキ in the [official ECHO QQ group](https://qm.qq.com/q/OdpngxJU86).

> This project may become an independent music player in the future, but for now it only serves EchoLink. Upstream updates will be synchronized here as soon as possible.

> If ECHO NEXT releases an official iOS client, I will mark it in this project and stop updating this repository.

> This is my first project, so it may be poorly made or even abandoned in the future. The main purpose of this project is to prove that Windows can complete the full workflow of making an iOS app, except signing and publishing, and to make it more convenient for myself to use ECHO on iOS. Thank you for your understanding <3

## What is this?

ECHO iPhone turns your iPhone into a music controller / player for the ECHO NEXT desktop app. It connects to the computer through EchoLink, reads the current playback status, browses the local music library on the computer, controls playback, progress, volume, and queue, and can stream songs to the phone for playback when the audio format is supported.

The UI has temporarily been redesigned. The playback page, cover art, lyrics, control area, and dock have all been reorganized into a unified glass-style interface. The lyrics page uses a larger font size, automatic scrolling, and current-line highlighting, making it suitable for using the phone directly as a lyrics display while music is playing.

## Features

- EchoLink pairing link connection: supports one-tap filling through `echo://pair?...`.
- Manual LAN connection: Host, Port, and Token can be saved separately.
- Three main pages: Playback, Library, and Connection, with bottom dock and swipe navigation.
- Redesigned full playback page: cover art, song information, progress, playback controls, volume, and output switching are more compact.
- Gaussian glass UI: playback panels, buttons, dock, and popups use a unified `expo-blur` style.
- Lyrics mode: fetches `/lyrics`, parses LRC, auto-scrolls, and highlights the current lyric line with a larger font.
- Tap-to-seek lyrics: lyric lines with timestamps can be tapped to seek directly.
- Stable cover loading: keeps the previous cover before the new one is successfully loaded, reducing default-cover flickering.
- Slider touch interruption fix: page gestures are locked while dragging the progress bar or volume slider to prevent vertical swipes from stealing touch input.
- Playback controls: previous track, play / pause, next track, repeat one, and playlist preview.
- Library search: browse the PC local music library and select songs from the phone to play on the computer.
- Output switching: control playback on the computer, or stream to the iPhone when supported.
- Audio information tags: Local, streamable, WASAPI / ASIO, format, sample rate, bit depth, bitrate, and more.

## Current Limitations

- ECHO NEXT EchoLink must be enabled on the computer.
- The iPhone and computer must be on the same LAN.
- Windows Firewall must allow ECHO NEXT communication.
- Mobile streaming depends on the desktop stream interface and audio formats supported by iOS.
- Cover art, lyrics, and audio tags depend on the data returned by the desktop EchoLink service.
- This repository is an Expo / React Native project, not a native SwiftUI project.

## Requirements

- Node.js and npm
- Expo, through `npx expo`
- Local iOS builds require macOS + Xcode
- Windows users can trigger a macOS runner through GitHub Actions to generate an unsigned IPA
- Real-device installation requires Sideloadly, AltStore, Xcode, or another signing / installation method

## Local Development

```powershell
npm install
npm run start
```

Type checking:

```powershell
npm run typecheck
```

iOS Expo export check:

```powershell
npx expo export --platform ios --output-dir build\export-check
```

## Connecting to ECHO NEXT

You can use a pairing link or manually enter the LAN address.

```text
echo://pair?host=192.168.1.12&port=26789&token=...
```

Manual connection fields:

- Host: the computer's LAN IP, for example `192.168.2.27`
- Port: usually `26789`
- Token: copied from the EchoLink pairing page in the desktop app

If the connection fails, check the following first:

- Whether the iPhone and computer are connected to the same Wi-Fi / LAN.
- Whether ECHO NEXT is running and EchoLink is enabled.
- Whether Windows Firewall allows ECHO NEXT communication on private networks.
- Whether Host is set to the computer's LAN IP instead of `localhost`, a virtual network adapter IP, or a public IP.
- Whether iOS local network permission is allowed.

## EchoLink API

The mobile client currently uses:

```text
GET  /echo-link/v1/status
GET  /echo-link/v1/library/tracks?page=1&pageSize=40&q=...
GET  /echo-link/v1/library/albums?page=1&pageSize=40&q=...
GET  /echo-link/v1/library/albums/:albumId/tracks
POST /echo-link/v1/playback/command
POST /echo-link/v1/library/tracks/:trackId/stream
GET  /echo-link/v1/library/tracks/:trackId/lyrics
```

Request headers:

```text
Authorization: Bearer <token>
x-echo-link-version: 1
```

## Building an Unsigned IPA

iOS builds still depend on macOS and Xcode. Windows cannot directly generate a usable IPA, but it can trigger GitHub Actions.

### GitHub Actions

1. Push this repository to GitHub.
2. Open GitHub Actions.
3. Run `Build iOS unsigned IPA`.
4. Download the `ECHO-iPhone-unsigned-ipa` artifact.
5. Sign and install it using Sideloadly, AltStore, or another method.

### Local Mac Build

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

The script will open the generated Xcode workspace. Select your own Apple ID Team, connect your iPhone, and then click Run.

## Assets

- `docs/app-icon.png` is the current app icon shared by the README and Expo.
- `docs/app-icon.svg` is a lightweight display version of the same style.
- `docs/preview.svg` is the ACG-style feature preview image at the top of the README.
- `Assets.car` can be placed in the repository root. The unsigned IPA script will copy it into the final `.app` during packaging.
- Song cover art is loaded from EchoLink artwork URLs. If the remote image fails to load, the mobile client will keep the stable cover or show the ECHO placeholder.

## Project Structure

```text
App.tsx                         Main UI, playback controls, lyrics, and streaming logic
app.json                        Expo iOS configuration
src/echoLink/client.ts          EchoLink HTTP client
src/echoLink/types.ts           Mobile EchoLink types
src/echoLink/pairing.ts         Pairing URI parser
src/storage/connectionStore.ts  Local connection information storage
scripts/                        iOS build helper scripts
.github/workflows/              Unsigned IPA workflow
docs/                           Icons, preview images, and README assets
```

## Upload Checklist

Recommended files to upload:

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

For the latest updates, see [RELEASE_NOTES.md](RELEASE_NOTES.md).
