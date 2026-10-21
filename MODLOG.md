# MODLOG

## Route
- **RDR2 (primary, RAGE, C++):** an ASI plugin via Ultimate ASI Loader, which Melty installs. Script Hook RDR2 is
  not used because players would have to install it by hand, so the ASI resolves natives itself
  (hooks.native_lookup, hooks.script_tick).
- **HL2 (companion, Source, C++):** a Source server plugin listening to the `entity_killed` game event and setting
  the `skill` convar. Source's own plugin interface is the established route; no game files are patched.
- **Together:** both games run at once and talk over localhost UDP (pattern 2, state exchange, from mashup-mods).

## Native hashes
From alloc8or/rdr3-nativedb-data: PLAYER_ID 0x217E9DC48139933D, GET_BOUNTY 0x54310AAB97B92816,
ADD_BOUNTY 0x0E3BDEED21BEB945, NETWORK_IS_GAME_IN_PROGRESS 0x10FAB35428CCC9D7.

## Open questions
- Honor has no native. It's a story-script global whose offset moves with game patches. Fallback under
  discussion: drive HL2 difficulty from Arthur's bounty (GET_BOUNTY), which has a native.
- Whether current hl2.exe (post-2024 update) is 64-bit decides how the plugin is built.
