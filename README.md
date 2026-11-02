# TypeScript spike

## The question

**What does binding the Haiven API from TypeScript actually cost, and which of
those costs are the API's rather than TypeScript's?**

TypeScript goes first because it needs no engine toolchain. That isolates the
API surface from the target runtime: anything awkward here is awkward because of
the API, not because of Unity's IL2CPP stripping or Unreal's module system. It
is also the least hypothetical target — `packages/app`, `apps/desktop` and
`apps/mobile` are real consumers, and the transport has already forked once
between them.

Three sub-questions, from `docs/findings.md`:

1. **(Q5) Is there anything a generator can consume**, or does a binding have to
   hand-write DTOs against 373 KB of Go?
2. **(Q6) Do the two published vocabularies survive codegen?** `wire/errorcode`
   and `wire/messagetype` are deliberately *open* string types so a client on an
   older contract can receive and forward a value minted after it shipped. Does
   that intent reach a TypeScript consumer?
3. **(Q2, Q3) Does the in-band auth handshake bind cleanly**, and can
   `auth.expired` be answered on the live socket, or does a binding end up
   reconnecting when the server never asked it to?

## What this spike is and is not

It is a **reproduction harness**. Every claim in `docs/findings.md` that came
from here is produced by something in `test/` that can be re-run, and the
findings are meant to be changed by rerunning it rather than by editing the
conclusion.

The socket half runs **both ways**. `test/live.test.ts` drives the scenarios
against a real server — `backend/cmd/wsfixture`, which is the real websocket
stack with only the identity provider, one user row and the pub/sub broker
stubbed — and `test/auth.test.ts` drives the same scenarios against a model of
it (`src/ws/fake-server.ts`) so they stay reachable without a Go toolchain.

The model is not an independent source of truth. Where the two disagree the
server is right and the model is a bug, and it was a bug: F9 records what a live
run corrected. Re-derive the model by running the live suite, not by adjusting
it until tests pass.

The live suite skips itself, loudly, when `../../backend` or `go` is absent. It
covers both of the backend's expired-session behaviours — the deployed one, which
discards outbound frames, and `fix/ws-expired-message-loss`, which parks and
replays them — selecting by what the fixture reports about itself.

The REST transport needs no model. Its 139 typed endpoint methods and 156
component types are generated from the public gaming OpenAPI description at the
pinned `haiven-contracts` commit. The older extractor remains only as the
reproduction harness for the historical missing-artifact finding.

## Running it

Node 22.18+ (24+ recommended). Types are stripped natively, so there is no build
step and no runtime dependency.

```sh
node --test "test/**/*.test.ts"
```

Several tests measure the real backend and skip themselves when `../../backend`
is absent, so the suite is green in a standalone clone but only *complete* inside
the Haiven development workspace. The skip is reported rather than silent. The
live socket suite additionally needs a Go toolchain — it builds and runs the
fixture — and takes about 20s.

To run it against a different checkout, for example a worktree at another
revision:

```sh
HAIVEN_BACKEND=/path/to/backend node --test "test/**/*.test.ts"
```

Type checking needs the one dev dependency:

```sh
npm install --no-save typescript@5.9.3 @types/node
npx tsc --noEmit
```

`make check` from the repository root runs both.

### Game login handoff

`HaivenClient.createHandoff` creates a PKCE handoff coordinator over the same
`TokenStore` used by REST and WebSocket. A successful exchange writes the access
token and its absolute expiry before returning, so the next REST request and an
already-open socket's next authentication frame both read the new credential.

The target-independent state machine lives in `src/handoff/core.ts`. Its host
boundary deliberately injects the parts JavaScript runtimes do not share:
secure random bytes, SHA-256, transient verifier storage, and URL launching.
The three supplied profiles are:

- `browserHandoffHost`: Web Crypto + `sessionStorage` + same-tab navigation;
- `nodeHandoffHost`: Node's global Web Crypto + an in-memory transaction store,
  with an optional launcher; and
- `reactNativeHandoffHost`: explicit crypto, `Linking.openURL`, and an
  AsyncStorage/SecureStore-shaped store, without importing React Native into the
  portable package.

The embedding app delivers its platform callback URL to `complete`. The
coordinator validates the configured callback target and one-use state before
posting the generated form exchange, rejects refresh credentials, and consumes
the verifier even when the exchange fails.

### Recovering an API description by hand

```sh
node scripts/extract-swagger.mjs                        # summarise
node scripts/extract-swagger.mjs '' /tmp/haiven.json    # and write it out
```

Defaults to `../../haiven-backend/cmd/server/docs/docs.go`; pass a path as the first
argument to point it elsewhere. This exists to **measure** the missing artifact,
not to become the supported way to get one — the supported fix is one flag on
the backend's `swag` task, which `docs/findings.md` spells out.

## Layout

```text
ts/
├── scripts/extract-swagger.mjs   Q5 — recover a description from swag's Go
├── src/handoff/                  PKCE coordinator + browser/Node/RN profiles
├── src/rest/client.ts            hand-written host/session/error transport
├── src/rest/generated.ts         generated component types + endpoint methods
├── src/wire/code.ts              Q6 — the sealed and open bindings, side by side
├── src/ws/protocol.ts            the envelope, hand-written from Go
├── src/ws/fake-server.ts         the server model, corrected by the live run
├── src/ws/live.ts                the live fixture driver and a real-socket client
├── src/ws/session.ts             Q2/Q3 — the client state machine
├── test/                         the findings, as assertions
└── fixtures/docs-excerpt.go.txt  hermetic input for the extractor
```

`src/ws/session.ts` marks with `FORCED` every decision the protocol made for the
binding rather than left to it. Those comments are the finding; the code around
them is just what it took to get there.
