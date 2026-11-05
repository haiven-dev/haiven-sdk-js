# Contributing

Contributions are welcome. This repository is public. Bug reports, fixes,
and documentation improvements are all useful.

## Issues

Open a GitHub issue for a bug, a question about behavior, or a change you
want to discuss before writing it. Search open issues first.

Include the package version, the Node.js version, and the steps that show
the problem. Do not paste access tokens, passwords, or private endpoints.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep the change focused.
3. Use a [Conventional Commits](https://www.conventionalcommits.org/)
   subject:

   `type(scope): subject`

   `type` is one of `feat`, `fix`, `docs`, `deps`, `style`, `refactor`,
   `perf`, `test`, `build`, `ci`, `chore`, or `revert`. `scope` is
   optional.
4. Open the pull request against `main`. Say what changed and how you
   checked it.

Do not commit access tokens, passwords, private endpoints, or local
credentials. Do not add fixtures from outside this repository to make a
test pass.

## Checks

Node.js 22.18 or newer, as `package.json` requires. From the repository
root:

```sh
npm test
```

That runs `node --test "test/**/*.test.ts"`. In a standalone clone, three
tests currently throw because they read a fixture this repository does not
contain, before they can skip. Do not satisfy them by vendoring that
fixture. Say which tests you ran.

To typecheck after `npm install`:

```sh
npm run typecheck
```
