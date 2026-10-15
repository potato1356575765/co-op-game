# 🍰 Cake Defense 3D

An online co-op 3D browser game. A giant birthday cake sits in the middle of a picnic blanket, and it's swarmed by bugs that want to eat it. You and your friends are tiny chef-hat bakers armed with sprinkle blasters. **Protect the cake.**

## Play

```bash
npm install
npm start
```

Open http://localhost:3000, pick a name and a **room code**, then hit **Play**. Anyone who enters the same room code joins your game, and you can also just share the URL (`?room=yourcode`).

### 🖥️ Desktop app (Windows)

Cake Defense is a real desktop app with its own window and icon. Grab it from the latest **Build app** run in this repo's **Actions** tab (or build it yourself, see below):

- **`CakeDefense-Setup.exe`** installs the game with a desktop + Start menu shortcut.
- **`CakeDefense-Portable.exe`** is a single file you just double-click. Nothing gets installed.

Open the app, pick a name, and hit **Play** to host a game on your PC. The menu shows the address friends on your Wi-Fi should type into **Friend's IP** in their app. **Esc** opens the pause menu, and **F11** toggles fullscreen.

The first time you host, Windows Firewall asks whether to allow Cake Defense on your network, so click **Allow**. The app isn't code-signed, so SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

Build it yourself:

```bash
npm install
npm run app          # run the desktop app from source
npm run dist:win     # -> dist/CakeDefense-Setup.exe + dist/CakeDefense-Portable.exe
npm run dist:linux   # -> dist/CakeDefense.AppImage
```

Building the Windows installer on Linux or macOS needs [Wine](https://www.winehq.org/). On Windows it just works.

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

## Hosting: kick & ban

The host types these in chat (**Enter**). Only the computer running the game can use them.

| Command | What it does |
| --- | --- |
| `/kick Name` | Boot someone from the game |
| `/ban Name [30m\|2h\|7d] [reason]` | Ban someone (permanent if you leave out a time) |
| `/unban Name` | Lift a ban |
| `/bans` | List current bans |

Banned players get a ban screen with the reason and how long is left. Bans are saved on the host's computer and match both the player's app ID and their IP. Every player's app is its own server, so a ban only applies to games *you* host. Bans across every game would need a central server or Epic's Sanctions service.

## Co-op stuff

- **Shared wallet:** every squished bug adds coins to one team pot, and anyone can spend it in the shop between waves. Buy Sprinkle Power (damage), Rapid Fire, Zoomies (move speed), or Frosting Patch (+25 cake HP).
- **Downed, not dead:** at 0 HP you fall over. A teammate who stands next to you for 2 seconds revives you; otherwise you respawn after 15s (5s if you're solo).
- **The cake gets eaten tier by tier**, so you can see how much trouble you're in. If it hits 0, it's game over and the room restarts.

## How it works

- `main.js` is the Electron desktop app. It starts the game server inside the app and shows the game in its own window. `preload.js` gives the page app-only buttons (leave, fullscreen, quit).
- `server.js` is a Node server (plain `http` + `ws`). It runs an authoritative 30 tick/s simulation **per room** on a flat 2D plane and sends snapshots at 20 Hz. Rooms are created on demand and deleted when empty.
- `public/client.js` renders that plane in 3D with **three.js**: shadows, a flickering candle light, animated bug legs and wings, crumb particles, and a follow camera. Your own movement is predicted on the client so it feels instant.
- three.js is served from `node_modules`, so there are no CDN dependencies.
- **Cheat protection:** the server owns all game state (movement speed, fire rate, damage, coins, the shop), so a modified client can only send inputs. The server also caps message size, kicks clients that flood messages, throttles chat, and clamps aim coordinates.
- **Easy Anti-Cheat (in progress):** `anticheat.js` checks EAC when the app starts. It's off until the EOS SDK is wired up (`"eac": { "enabled": true }` in `package.json`, or `CAKE_EAC=1` to test). When it's on and EAC fails to load, the app shows an error screen and won't let you play.

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |

## Tests

```bash
npm test
```

Boots the server, connects players to rooms, and checks room isolation, movement sync, the shared shop, chat, waves spawning, shooting bugs, game over, spam/flood protection, and room cleanup.
