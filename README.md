# 🌲 Wildlands

An endless, procedurally generated open world you explore **together** with friends, right in the browser.

Chop trees, mine rocks, loot treasure chests, build campfires to survive the night, and team up to awaken and slay the **Ancient Guardians** sleeping in shrines across the land.

## Play

```bash
npm install
npm start
```

Open http://localhost:3000, pick a name, and hit **Play**.

### Playing with friends

Everyone connected to the same server shares the same world.

- **Same Wi‑Fi / LAN:** friends open `http://<your-local-ip>:3000` (find your IP with `ipconfig` / `ifconfig`).
- **Over the internet:** deploy to any Node host that supports WebSockets (Render, Railway, Fly.io, a VPS…), or tunnel your local server with something like `ngrok http 3000`.

## Controls

| Key | Action |
| --- | --- |
| **WASD** / arrows | Move |
| **Mouse** + **click** (hold) | Aim + sword attack |
| **E** | Chop tree · mine rock · eat berries · open chest · awaken shrine |
| **Hold E** next to a downed friend | Revive them |
| **1** / **2** | Build mode: campfire (5 🪵) / wall (2 🪨) — click to place |
| **Esc** / right click | Cancel build mode |
| **X** | Demolish the structure under your cursor (partial refund) |
| **U** | Upgrade sword (costs gold, up to level 10) |
| **Enter** | Chat |
| **H** | Toggle help |

Touch: drag on the left half of the screen to move, tap the right half to attack.

## How it works

- **Infinite world:** terrain (ocean, beaches, meadows, forests, hills, mountains, snowy peaks) is generated from layered value noise using a shared seed. `shared/world.js` runs on both server and client, so the world never has to be sent over the network — only the *changes* to it (harvested resources, buildings, cleansed shrines).
- **Day/night cycle:** a day lasts 4 minutes. At night, wolves and wraiths (who float through walls 👻) come hunting. Campfires light up the dark, heal nearby players, and monsters won't go near them.
- **Co-op mechanics:** when you drop to 0 HP you're downed, not dead. A teammate has 30 seconds to revive you before you respawn at camp and drop half your loot. Guardians scale with party size and are much easier to take down together.
- **Server-authoritative combat:** the Node server (`server.js`) owns enemies, health, inventories and world changes at 20 ticks/sec; clients predict their own movement for snappy controls.

## Config

| Env var | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP/WebSocket port |
| `SEED` | random | World seed (same seed = same world) |
| `START_PHASE` | `0.2` | Time of day the server starts at, `0`–`1` (night starts at `0.62`) |

## Tests

```bash
npm test
```

Spins up the server, connects two players, and checks joining, shared world changes, inventories and chat.
