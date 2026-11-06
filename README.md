# JavaScript SDK spike

The GitHub repository is [`haiven-sdk-js`](https://github.com/haiven-dev/haiven-sdk-js).
The previous name `haiven-sdk-ts` redirects to that repository.

Sources under `src/` and `test/` are JavaScript. Each module has a sibling
`.d.ts` declaration file. Node runs the `.js` files directly.

## The package

`package.json` points `exports` at `src/` and publishes that tree, except
`src/ws/live.js`, `src/rest/moderation-fixture.js`, `src/rest/handoff-fixture.js`
and their declarations. Those drivers spawn `go` and read a sibling checkout,
and no entry point reaches them. The tarball is the remaining sources, with
no build step:

| Entry point | Module |
| --- | --- |
| `@haiven/sdk-ts` | `src/client.js` |
| `@haiven/sdk-ts/contracts` | `src/contracts.js` (types only) |
| `@haiven/sdk-ts/vocabulary` | `src/vocabulary.js` |
| `@haiven/sdk-ts/testing` | `src/ws/fake-server.js` |

## The question

**What does binding the Haiven API from JavaScript, with TypeScript
declarations, actually cost, and which of those costs are the API's rather
than the language's?**

JavaScript goes first because it needs no engine toolchain. That isolates the
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
   that intent reach a consumer of the `.d.ts` files?
3. **(Q2, Q3) Does the in-band auth handshake bind cleanly**, and can
   `auth.expired` be answered on the live socket, or does a binding end up
   reconnecting when the server never asked it to?

## What this spike is and is not

It is a **reproduction harness**. Every claim in `docs/findings.md` that came
from here is produced by something in `test/` that can be re-run, and the
findings are meant to be changed by rerunning it rather than by editing the
conclusion.

The socket half runs **both ways**. `test/live.test.js` drives the scenarios
against a real server — `backend/cmd/wsfixture`, which is the real websocket
stack with only the identity provider, one user row and the pub/sub broker
stubbed — and `test/auth.test.js` drives the same scenarios against a model of
it (`src/ws/fake-server.js`) so they stay reachable without a Go toolchain.

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

Node 22.18+ (24+ recommended). The modules are JavaScript, and each one has a
sibling `.d.ts`. Node runs the `.js` files directly, so there is no build step
and no runtime dependency. `npm run typecheck` checks the declarations.

```sh
node --test "test/**/*.test.js"
```

The complete suite needs three sibling checkouts:

| Sibling | Override | Without it |
| --- | --- | --- |
| `haiven-api` | `HAIVEN_API_ROOT` | The tests that measure the real backend skip, and say so. The live socket suite also needs a Go toolchain, because it builds and runs the fixture, and takes about 20s. |
| `haiven-contracts` | `HAIVEN_CONTRACTS_ROOT` | `conformance`, `handoff-conformance` and `moderation-conformance` fail at load. |
| `haiven-sdk` | `HAIVEN_SDK_ROOT` | `client-conformance` fails at load. |

Use the `haiven-contracts` commit the generated files name in their `Source:`
header. To run against other checkouts, for example worktrees at another
revision:

```sh
HAIVEN_API_ROOT=/path/to/haiven-api \
HAIVEN_CONTRACTS_ROOT=/path/to/haiven-contracts \
HAIVEN_SDK_ROOT=/path/to/haiven-sdk \
node --test "test/**/*.test.js"
```

Type checking uses the dev dependencies (`typescript` and `@types/node`):

```sh
npm install
npm run typecheck
```

`tsc` checks the declarations against each other. It does not read the `.js`
bodies, because a sibling `.d.ts` takes the place of its module. The tests are
what hold a module to its declaration.

### Game login handoff

`HaivenClient.createHandoff` creates a PKCE handoff coordinator over the same
`TokenStore` used by REST and WebSocket. A successful exchange writes the access
token and its absolute expiry before returning, so the next REST request and an
already-open socket's next authentication frame both read the new credential.

The target-independent state machine lives in `src/handoff/core.js`. Its host
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

Defaults to `../../haiven-api/cmd/server/docs/docs.go`; pass a path as the first
argument to point it elsewhere. This exists to **measure** the missing artifact,
not to become the supported way to get one — the supported fix is one flag on
the backend's `swag` task, which `docs/findings.md` spells out.

## Updating from haiven-sdk

`sdks/js` in `haiven-sdk` is the upstream source, and its codegen emits
TypeScript. To take a newer revision:

1. Copy its `src` and `test`, with `scripts` alongside for `artifact.test.ts`.
2. Copy `codegen/emitted-contracts/` to `src/generated/contracts/` and
   `codegen/emitted/` to `src/generated/vocabulary/`. Those trees sit outside
   `sdks/js`. Rewrite the specifiers that point at them, and keep the `.ts`
   extension so the `tsc` step below can compile them:
   - `src/contracts.ts` imports `../../../codegen/emitted-contracts/index.ts`.
     Point it at `./generated/contracts/index.ts`.
   - `src/vocabulary.ts` imports `../../../codegen/emitted/ErrorCode.ts`,
     `WsErrorCode.ts` and `MessageType.ts`. Point them at
     `./generated/vocabulary/` with the same file names.
   - `src/ws/generated.ts` imports
     `../../../../codegen/emitted-contracts/index.ts`. Point it at
     `../generated/contracts/index.ts`.
3. Run `tsc` with `declaration`, `allowJs`, `allowImportingTsExtensions` and
   `rewriteRelativeImportExtensions` on, `noEmit` off, and the rest of this
   repository's `tsconfig.json`.
4. Rewrite the `.ts` specifiers `tsc` leaves in the emitted `.d.ts` files to
   `.js`, along with `.ts` paths in comments.
5. Copy the `// Generated by` header onto each generated `.d.ts`.
6. Reapply what upstream does not have: the sibling paths, which
   `test/sibling-backend.test.js` covers, and the type check in
   `test/contracts.test.d.ts`.

## Layout

```text
├── scripts/extract-swagger.mjs   Q5 — recover a description from swag's Go
├── src/handoff/                  PKCE coordinator + browser/Node/RN profiles
├── src/generated/                generated contract types and vocabularies
├── src/rest/client.js            hand-written host/session/error transport
├── src/rest/generated.js         generated component types + endpoint methods
├── src/wire/code.js              Q6 — the sealed and open bindings, side by side
├── src/ws/generated.js           generated frame types and event router
├── src/ws/protocol.js            the envelope, hand-written from Go
├── src/ws/fake-server.js         the server model, corrected by the live run
├── src/ws/live.js                the live fixture driver and a real-socket client
├── src/ws/session.js             Q2/Q3 — the client state machine
├── test/                         the findings, as assertions
└── fixtures/docs-excerpt.go.txt  hermetic input for the extractor
```

Every `.js` module under `src/` and `test/` has a sibling `.d.ts`.

`src/ws/session.js` marks with `FORCED` every decision the protocol made for the
binding rather than left to it. Those comments are the finding; the code around
them is just what it took to get there.
