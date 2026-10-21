# Grand Theft Half Life

**Two Worlds, One Outlaw.** Red Dead Redemption 2 and Half-Life 2 run side by side, and each one changes the other:

- Every enemy Gordon kills in Half-Life 2 adds to Arthur's bounty in RDR2.
- Arthur's honor in RDR2 sets Half-Life 2's difficulty. High honor makes City 17 easy, low honor makes it hard.

Solo play only. RDR2 story mode only: the mod does nothing in Red Dead Online.

Players need their own copies of both games. The mashup ships no game content.

## Status: source only, not yet tested in either game

`python3 tools/preflight.py` lists every open item. Right now it shows:
- three RDR2 hooks still to find on a PC with the game (native lookup, script tick, honor);
- nothing has been run in either game yet.

## How it's built

- `sheets/*.json`: the design. Every game, hook, channel and rule is a row there. Change the sheet before the code.
- `tools/gen.py`: generates `src/generated/sheets.h` from the sheets.
- `tools/preflight.py`: lists unfilled cells, broken references and rows not yet tested in the game.
- `src/rdr2/`: `gthl.asi`, loaded by Ultimate ASI Loader.
- `src/hl2/`: a Source server plugin (`addons/gthl.vdf`), built against Source SDK 2013.
- `src/common/`: rules and the localhost UDP bridge, shared by both halves. `tests/rules_test.cpp` covers the rules.
- `docs/CONTRACT.md`: what crosses between the two games.

Built with the [universal-modder](https://github.com/rehan-remade/universal-modder) skills (MIT).
