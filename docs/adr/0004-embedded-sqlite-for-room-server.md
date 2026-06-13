# Embedded SQLite for Room Server persistence

The Room Server persists its state (per-Viewer avatar claims, Module state such as currency/leaderboards/poll history, the Streamer's Twitch tokens) in **embedded SQLite**, written to a host bind-mounted file (`./data/room.db`). There is **no database container** in the Room Server's compose stack — "persistent data outside the container" means that file on the host.

## Why

A Room Server is single-tenant (one Room, modest write-concurrency). Embedded SQLite removes a long-running service the self-hoster would otherwise have to run, resource, and maintain, and makes backups trivial (copy the file). This is a deliberate deviation from the obvious "Postgres service in docker-compose" — recorded so it isn't "fixed" later.

## Note

The **Hub** is a separate, centrally-operated, multi-Room service and uses **Postgres**. The two data stores are independent; only the Room Server uses SQLite.
