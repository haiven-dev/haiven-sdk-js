# Contributing

This repository is public. Bug reports and questions are welcome. Code from
outside Haiven is not accepted until a license file is in the repository.

## Issues

Open a GitHub issue for a bug, a question about behavior, or a change you
want to discuss before writing it. Search open issues first.

Include the package version, the Node.js version, and the steps that show
the problem. Do not paste access tokens, passwords, or private endpoints.

## Pull requests

Code from outside Haiven is not accepted until a license file is in the
repository. Until then, use GitHub issues for bug reports and questions.
Do not open a pull request that changes this repository.

Haiven changes branch from `main` and use a
[Conventional Commits](https://www.conventionalcommits.org/) subject:

`type(scope): subject`

`type` is one of `feat`, `fix`, `docs`, `deps`, `style`, `refactor`,
`perf`, `test`, `build`, `ci`, `chore`, or `revert`. `scope` is optional.
Open the pull request against `main`. Say what changed and how you checked
it. Keep the change focused.

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

`npm install` does not install `@types/node`. `tsconfig.json` sets
`"types": ["node"]`, so `npm run typecheck` fails with `TS2688` after that
install. Install the checker and `@types/node`, then typecheck:

```sh
npm install --no-save typescript@5.9.3 @types/node
npm run typecheck
```
