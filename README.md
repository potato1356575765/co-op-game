# 🍰 Cake Defense 3D

An online co-op 3D browser game. A giant birthday cake sits in the middle of a picnic blanket, and it's swarmed by bugs that want to eat it. You and your friends are tiny chef-hat bakers armed with sprinkle blasters. **Protect the cake.**

## Play

```bash
npm install
npm start
```

Open http://localhost:3000, pick a name and a **room code**, then hit **Play**. Anyone who enters the same room code joins your game, and you can also just share the URL (`?room=yourcode`).

### 🪟 Windows .exe (no Node needed)

Grab `CakeDefense.exe` from the latest **Build exe** run in this repo's **Actions** tab (or build it yourself, see below) and double-click it. A console window opens with the server running, and your browser opens the game. Keep that window open while you play, and close it to stop.

The console prints a `http://192.168.x.x:3000` link that friends on your Wi-Fi can open. The first time, Windows Firewall will ask whether to allow it on your network, so click **Allow**. The exe isn't code-signed, so SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

Build it yourself (from Windows, macOS or Linux, using Node 22):

```bash
npm install
npm run build:exe            # -> dist/CakeDefense.exe
npm run build:exe -- linux   # -> dist/CakeDefense-linux
```

This uses Node's built-in [single executable applications](https://nodejs.org/api/single-executable-applications.html): it bundles the server with esbuild, embeds the client and three.js as assets, and injects them into the official Node binary.

### Playing with friends online

- **Same Wi‑Fi:** friends open `http://<your-local-ip>:3000`.
- **Over the internet:** deploy to any Node host with WebSocket support (Render, Railway, Fly.io, a VPS…), or tunnel with `ngrok http 3000`.

## Controls

| Input | Action |
| --- | --- |
| **WASD** / arrows | Move |
| **Mouse** + **click** (hold) | Aim + shoot sprinkles |
| **1–4** | Buy upgrades (between waves) |
| **Enter** | Chat |
| Stand next to a downed friend | Revive them 💖 |

Touch: drag on the left half of the screen to move, and touch the right half to aim and shoot.

## The bugs

| Bug | Deal |
| --- | --- |
| 🐜 Ant | Marches straight for the cake. There are lots of them. |
| 🐝 Wasp | Ignores the cake and hunts **you**. Shows up from wave 2. |
| 🪲 Beetle | Slow, tanky, and takes big bites. Shows up from wave 3. |
| 👑 Queen | Boss ant every 5th wave. Bring friends. |

Each wave gets bigger and scales with how many players are in the room.

## Co-op stuff

- **Shared wallet:** every squished bug adds coins to one team pot, and anyone can spend it in the shop between waves. Buy Sprinkle Power (damage), Rapid Fire, Zoomies (move speed), or Frosting Patch (+25 cake HP).
- **Downed, not dead:** at 0 HP you fall over. A teammate who stands next to you for 2 seconds revives you; otherwise you respawn after 15s (5s if you're solo).
- **The cake gets eaten tier by tier**, so you can see how much trouble you're in. If it hits 0, it's game over and the room restarts.

## How it works

- `server.js` is a Node server (plain `http` + `ws`). It runs an authoritative 30 tick/s simulation **per room** on a flat 2D plane and sends snapshots at 20 Hz. Rooms are created on demand and deleted when empty.
- `public/client.js` renders that plane in 3D with **three.js**: shadows, a flickering candle light, animated bug legs and wings, crumb particles, and a follow camera. Your own movement is predicted on the client so it feels instant.
- three.js is served from `node_modules`, so there are no CDN dependencies.

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |

## Tests

```bash
npm test
```

Boots the server, connects players to rooms, and checks room isolation, movement sync, the shared shop, chat, waves spawning, shooting bugs, game over, and room cleanup.
