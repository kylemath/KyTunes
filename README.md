# KyTunes

A music player for files on your computer. Another computer or a phone runs the same app and streams songs from the one machine that holds the library. Nothing is copied until you tap **Keep** on a song.

**[Install KyTunes](https://kylemath.github.io/KyTunes)** — the same player, hosted on GitHub Pages. Open that link and install it from the browser. It starts with the built-in tracks. Add a server from the library menu when you want one.

## Dev server

`npm run dev` runs the player in the browser while you work on it. It does not install the Mac app, and the role it asks for is not used by that app.

```bash
npm install
npm run dev
```

Before Vite starts, choose one:

- **client** — this computer plays music from a library hosted somewhere else. Open the address Vite prints and choose **Add a server**.
- **server** — this computer hosts the music. Open that address, choose **Host on this computer**, then enter the music folder and a password.

The choice is saved for the next `npm run dev`. Run `npm run dev -- --choose` to switch. In the dev player you can also choose **Choose a music folder** to play files on this computer through the browser’s folder picker.

## Mac app

You do not need `npm run dev` to install the app. The install command builds the player and copies the app to `/Applications`. The role is the command you run.

On the computer that only plays:

```bash
npm install
npm run install-client
```

Open **KyTunes** from Applications. It serves the built player. Choose **Add a server** and enter the library address and password.

On the computer that has the music:

```bash
npm install
npm run install-server
```

Open **KyTunes Server** from Applications. The first launch asks for the music folder and a password. After that it serves the player and the music on port 8787.

`npm run library` still starts that same library server from a terminal:

```bash
npm run library -- --dir ~/Music --password 'choose-a-password'
```

The password is stored only as a hash in `library.config.json`, which is not committed. Use the address it prints from other devices. Do not put a home address in this repo.

The server sends the song list and the audio. Seeking requests a slice of the file. **Keep** is what saves a whole song on the device you are using.

## Another computer

Install the client there with `npm run install-client`, or run `npm run dev` and choose **client**. Then choose **Add a server**, and enter the address from the library machine, for example `http://<library-computer>:8787`, and the password. Only the catalog and the audio cross the network.

## Phone

There is no app-store install. Open the player in the phone browser, then use **Add to Home Screen**.

On the same Wi-Fi, with this project running:

- With `npm run dev` running, the address Vite prints on the network can be opened on the phone. The interface loads from the dev server, and the songs come from the library.
- **KyTunes Server**, or `npm run library` after the player has been built, serves the player page and the audio on port 8787. The phone can open that address without the dev server.

A home-screen install that behaves as its own app needs HTTPS. Away from home, install Tailscale on the library machine and the phone, run `tailscale serve 8787`, open that `https://` address, and add it to the home screen. A plain `http://` address on your network still plays in the browser.

Android Chrome cannot browse an arbitrary music folder. The phone streams, and **Keep** stores the songs you want on the device.

## Android phone over Tailscale

This works away from home, on mobile data or another Wi-Fi.

1. On the library computer, start the server with `npm run library -- --dir ~/Music --password '…'` and leave it running.
2. In a second terminal, run `npm run share`. It prints a QR code and an address like `https://your-mac.your-tailnet.ts.net/`, then runs `tailscale serve 8787` until you press Ctrl+C. The first time, Tailscale may ask you to turn on HTTPS for the tailnet in its admin console.
3. On the phone, install the Tailscale app from the Play Store, sign in to the same tailnet, and switch it on.
4. Open that `https://` address in Chrome (scan the QR code, or type it). Use it without `:8787`; Tailscale Serve answers on the normal HTTPS port and passes requests to 8787 on the computer.
5. Enter the password, then use **Add to Home Screen** (or **Install app**) from Chrome's menu.

You can also open [the GitHub Pages app](https://kylemath.github.io/KyTunes) on the phone and add the same `https://…ts.net` address from **Add a server** in the library menu. Typing just the host name is fine; a `.ts.net` name gets `https://` added. An `http://` address, including `http://100.x.y.z:8787`, is refused there because the browser blocks plain HTTP from an HTTPS page.

If the phone says it can't reach the server, check that Tailscale is on in the phone's app and that `npm run share` is still running on the computer.

## Installed from GitHub Pages

[https://kylemath.github.io/KyTunes](https://kylemath.github.io/KyTunes) is this app. Chrome and Edge show an install icon. On a phone, use **Add to Home Screen**. The installed window is the player: library 0 is the five public-domain recordings in `public/demo/` (Bach, Mozart, Beethoven, Chopin, and Vivaldi, from Musopen, the European Archive, and the Modena Chamber Orchestra), plus any folder you pick and any song you have already played from a server.

The page is HTTPS. It can connect to an `https://` library, such as Tailscale Serve. A home `http://` address is blocked by the browser. On your own network, install the client or run `npm run dev` and choose **client**, then add the server.

Pages deploys with GitHub Actions (`npm run build:pages`) when `main` is pushed. That build is the installable app. The library server build stays at `/` and serves the same player with the music.
