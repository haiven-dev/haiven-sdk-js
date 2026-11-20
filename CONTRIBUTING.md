# Contributing

This repository is public. Bug reports, questions, fixes, and documentation
improvements are welcome. Contributions are accepted under the Apache
License, Version 2.0. See [LICENSE](LICENSE).

## Issues

Open a GitHub issue for a bug, a question about behavior, or a change you
want to discuss before writing it. Search open issues first.

Include the package version, the Node.js version, and the steps that show
the problem. Do not paste access tokens, passwords, or private endpoints.

## Pull requests

Unless you say otherwise, a contribution you submit is licensed under the
Apache License, Version 2.0, as section 5 of [LICENSE](LICENSE) says. Do
not add code you cannot license that way. For a large change, open an issue
first.

Branch from `main` and open the pull request against `main`. Before you
push, rebase onto the current `main`; do not merge `main` into your branch.
Say what changed and how you checked it. Keep the change focused.

Pull requests into `main` are squash-merged. For a pull request with one
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

Releases are cut from `main`. This repository does not use an `sdk-dev`
branch.

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

`npm test` runs `node --test "test/**/*.test.js"`. Every test file runs in
a standalone clone: `test/client-conformance.test.js` reads the suite in
`conformance/`. Say which tests you ran.
