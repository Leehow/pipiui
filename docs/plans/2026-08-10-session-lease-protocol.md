# Session single-writer lease protocol (v1)

## Purpose

A session JSONL has exactly one active writer across PipiUI implementations. A
client which cannot acquire the lease may read its history, but must not start
or send work to a `pi` process for that session.

## Lease file

For a session JSONL at `…/<session-file>.jsonl`, its lease is adjacent at
`…/<sessionId>.lease.json` (where `sessionId` is the session header `id`). The
file is UTF-8 JSON and is atomically created; writers replace it atomically for
heartbeats.

```json
{
  "protocolVersion": 1,
  "holder": "pipiui-electron",
  "pid": 12345,
  "hostname": "macbook.local",
  "instanceId": "per-process-random-id",
  "acquiredAt": "2026-08-10T12:00:00.000Z",
  "heartbeatAt": "2026-08-10T12:00:15.000Z",
  "expiresAt": "2026-08-10T12:00:45.000Z"
}
```

`holder` is a stable implementation identifier (initial values are
`pipiui-swift` and `pipiui-electron`). `instanceId` is an opaque per-process
identifier used to ensure a holder releases or refreshes only its own lease.
Future readers must ignore unknown fields.

## Operations

- **Acquire:** create the lease with exclusive create (`wx`, or an equivalent
  mkdir-based primitive). If it already exists, read it. If expired, remove the
  expired lease and retry exclusive creation. Otherwise acquisition fails with
  the current holder record.
- **Heartbeat:** the owner refreshes `heartbeatAt` and `expiresAt` every 15
  seconds. It may only refresh a record with its `instanceId`.
- **Release:** on normal session/process shutdown, the owner removes only a
  lease with its `instanceId`. Process exit attempts the same best-effort
  release.
- **Expiry recovery:** `expiresAt` is 45 seconds after each successful acquire
  or heartbeat. A crashed process therefore stops blocking writers naturally;
  any client may recover the expired file during acquire.
- **Force takeover:** the user explicitly requests takeover. The client first
  invalidates/removes the current lease, then performs exclusive acquisition.
  This is destructive to the old writer's authority and must never happen
  silently.

## Conflict semantics

A client that does not hold the lease is read-only. UI must say `由 X 运行中`
(where `X` is the holder when known), show a read-only badge, disable the
composer, and expose an explicit **强制接管** action. It must not silently spawn
a second writing `pi` process. Querying history and session metadata remains
allowed.

## Host API mapping

Host protocol v2 adds `getSessionLease(sessionId)` and
`forceTakeoverSessionLease(sessionId)`. Capabilities are unchanged so v1/v2
feature capability negotiation remains unaffected. `resumeSession` attempts
acquisition; a conflict still returns the session for read-only viewing, while
`sendPrompt` and queued follow-ups require ownership and fail on conflict.
