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

Haiven changes branch from `sdk-dev` and open their pull request against
`sdk-dev`. `main` is the default branch, so set the base to `sdk-dev` when
you open the pull request. Before you push, rebase onto the current
`sdk-dev`; do not merge `sdk-dev` into your branch. Say what changed and
how you checked it. Keep the change focused.

Pull requests into `sdk-dev` are squash-merged. For a pull request with one
commit, GitHub uses that commit's subject as the squash commit subject.
Otherwise it uses the pull request title. So give the title and every commit
subject the [Conventional Commits](https://www.conventionalcommits.org/)
format:

`type(scope): subject`

`type` is one of `feat`, `fix`, `docs`, `deps`, `style`, `refactor`,
`perf`, `test`, `build`, `ci`, `chore`, `revert`, or `wip`. `scope` is
optional. A breaking change puts `!` immediately before the colon, in the
commit subject and the pull request title:

`type(scope)!: subject`

Releases are cut from `main`. `sdk-dev` reaches `main` through a pull
request merged with a merge commit, never a squash, and after each release
`main` is merged back into `sdk-dev` with a merge commit.

Do not commit access tokens, passwords, private endpoints, or local
credentials. Do not add fixtures from outside this repository to make a
test pass.

## Checks

Node.js 22.18 or newer, as `package.json` requires. From the repository
root, install the dev dependencies (`typescript` and `@types/node`), then
type-check the declarations and run the tests:

```sh
npm ci
npm run typecheck
npm test
```

`npm test` runs `node --test "test/**/*.test.js"`. In a standalone clone,
four test files currently fail at load, before they can skip, because each
reads a conformance suite from a private Haiven checkout this repository
does not contain: `test/conformance.test.js`,
`test/handoff-conformance.test.js`, `test/moderation-conformance.test.js`,
and `test/client-conformance.test.js`. Do not satisfy them by vendoring
those suite files. Say which tests you ran.
