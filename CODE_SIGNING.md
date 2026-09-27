# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

> The application to the SignPath Foundation open-source program is in progress. Until it is approved, Windows releases
> are published unsigned.

## What is signed

Only the Windows installer `unvara-win-x64.exe` attached to
[GitHub Releases of this repository](https://github.com/Chumbayoumba/unvara/releases). It is built from the source code
in this repository by the [`release` workflow](.github/workflows/release.yml) on GitHub-hosted runners, when a version
tag is pushed. No artifact built outside that workflow, and no third-party binary, is signed.

The product name is `Unvara` and the file version matches the release tag.

## Team roles

| Role | Members |
|---|---|
| Authors (commit to the repository) | [@Chumbayoumba](https://github.com/Chumbayoumba) |
| Reviewers (review pull requests from other contributors) | [@Chumbayoumba](https://github.com/Chumbayoumba) |
| Approvers (approve each signing request) | [@Chumbayoumba](https://github.com/Chumbayoumba) |

All members use multi-factor authentication for GitHub and SignPath. Every release is approved manually before it is
signed.

## Privacy

This program will not transfer any information to other networked systems unless specifically requested by the user or
the person installing or operating it, except for the update and model-catalog checks described in
[PRIVACY.md](PRIVACY.md).
