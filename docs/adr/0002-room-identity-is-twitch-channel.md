# Room identity is the Twitch channel

A **Room** corresponds one-to-one to a Twitch channel. The Streamer authenticates with Twitch (OAuth); the Hub keys its directory by the verified Twitch login (`hub.site/alice` ↔ `twitch.tv/alice`), and the Room Server's registration with the Hub is authorized by that proof of channel ownership. The same OAuth grants the scopes used to ingest the channel's chat.

## Why

Naming, anti-impersonation, anti-squatting, and the chat connection we need anyway all fall out of a single OAuth. The rejected alternative — arbitrary Room names with Hub-issued registration tokens — decouples identity from Twitch but permits squatting and a name that mismatches the streamer's handle.
