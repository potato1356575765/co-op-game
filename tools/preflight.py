"""Lay every sheet over each other and list each unchecked box.

A box is open when a cell is missing or null, or when a row has not been tested in the game.
Cross-sheet references (rules -> hooks/channels, hooks/channels -> games) must resolve.
Exit code 0 only when nothing is open.
"""
import json
import pathlib
import sys

SHEETS = pathlib.Path(__file__).resolve().parent.parent / "sheets"


def load():
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(SHEETS.glob("*.json"))}


def main():
    sheets = load()
    ids = {name: {r["id"] for r in s["rows"]} for name, s in sheets.items()}
    unfilled, untested, broken = [], [], []

    for name, s in sheets.items():
        for row in s["rows"]:
            for col in s["columns"]:
                if col not in row or row[col] is None or row[col] == "":
                    unfilled.append(f"{name}.{row['id']}.{col}")
            if row.get("tested_in_game") is not True:
                untested.append(f"{name}.{row['id']}")

    def ref(where, sheet, value):
        if value not in ids.get(sheet, set()):
            broken.append(f"{where} -> {sheet}.{value}")

    for row in sheets["hooks"]["rows"]:
        ref(f"hooks.{row['id']}.game", "games", row["game"])
    for row in sheets["channels"]["rows"]:
        ref(f"channels.{row['id']}.from", "games", row["from"])
        ref(f"channels.{row['id']}.to", "games", row["to"])
    for row in sheets["rules"]["rows"]:
        ref(f"rules.{row['id']}.trigger_channel", "channels", row["trigger_channel"])
        for h in row["uses_hooks"]:
            ref(f"rules.{row['id']}.uses_hooks", "hooks", h)

    for title, items in (("Unfilled cells", unfilled), ("Broken references", broken), ("Not yet tested in the game", untested)):
        print(f"{title}: {len(items)}")
        for i in items:
            print(f"  - {i}")
    clean_for_build = not unfilled and not broken
    print("BUILD: " + ("clean" if clean_for_build else "blocked"))
    print("RELEASE: " + ("clean" if clean_for_build and not untested else "blocked"))
    return 0 if clean_for_build and not untested else 1


if __name__ == "__main__":
    sys.exit(main())
