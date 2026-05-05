# Minerva Coach Desktop

The desktop client for [Minerva Coach](https://minervacoach.com) — a
real-time conversational coaching tool. The desktop app runs as a small
always-on-top panel that detects when you're in a Zoom meeting and
streams live coaching feedback during the call.

This repository hosts the desktop client only. The Minerva Coach
backend service is not public.

## Install

Download the installer for your platform from the
[Releases page](../../releases/latest):

- **Windows:** `.msi`
- **macOS Apple Silicon (M1/M2/M3):** `aarch64.dmg`
- **macOS Intel:** `x64.dmg`

The app auto-updates after installation.

For uninstall instructions see [UNINSTALL.md](./UNINSTALL.md).

## Build from source

Requirements:

- Rust stable (with the target for your platform)
- Node.js 20+
- Tauri 2 system dependencies — see
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)

```sh
npm ci
npm run tauri dev      # dev build with hot reload
npm run tauri build    # production build
```

A development build of the app talks to a local Minerva Coach backend
at `https://127.0.0.1:8000`. Production builds talk to the hosted
service at `https://minervacoach.com`.

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the full development setup,
including how to run a local backend.

## Backend

The desktop client communicates with the Minerva Coach hosted backend
over HTTPS and Socket.IO. The backend service and its API are not
public. Backend-related issues — anything that's not the desktop
client itself — should be reported through Minerva Coach support
rather than in this repo.

## Contributions

We are not accepting external pull requests at this time. Issues and
discussions are open for bug reports against the desktop client; for
anything else, please contact support.

## License

This project is licensed under the MIT License — see [LICENSE](./LICENSE).

Third-party dependency licenses are listed in
[THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md), generated from
`Cargo.lock` and `package-lock.json` on every build.

## Trademarks

"Minerva", "Minerva Coach", and the Minerva owl design are trademarks
of Minerva Research Inc. Trademark applications pending at USPTO. The
MIT License governing this repository's source code does not grant any
rights to use these trademarks.
