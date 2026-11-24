# Windows launch reliability

The native launcher rejects Windows Session 0 with exit code 20. This prevents an invisible service-session instance from holding the single-instance lock. Launch from the signed-in Windows desktop or use an interactive user token. No process killing, data reset or security weakening is added.

Validated: native build and Session 0 negative test. This is a specific fix, not a guarantee of flawless operation.

Sync requires both clients to use the same reachable server and pairing. Preserve concurrent edits and tombstones. Android end-to-end sync is not verified. Do not restore old snapshots to repair a connection.

Never publish profiles, pairing keys, state, logs or signing material. Historical archives need dependency and recovery checks before cleanup.
