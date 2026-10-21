# Bridge contract

| | |
|---|---|
| Who owns the player | Each game keeps its own player. Nothing moves between them except the two messages below. |
| Transport | UDP on 127.0.0.1, one text line per datagram. Ports from `sheets/channels.json`. |
| HL2 -> RDR2 | `KILL <victim_classname>` on 27961, sent once per NPC killed by entindex 1 (Gordon). |
| RDR2 -> HL2 | `HEAT <bounty_dollars> <honor>` on 27962, once a second. Honor -1000 means unknown (HL2 stays on normal). |
| Lost or late | Either side may be closed. Messages to a closed port are dropped; nothing queues. |
| Rate limit | RDR2 adds at most $60 of bounty per rolling minute (`rules.kill_to_bounty`). |
| Online | The RDR2 side checks `NETWORK_IS_GAME_IN_PROGRESS` every tick and does nothing while it's true. |
