# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## 0.1.1

- The stdio transport is now imported lazily, only when a `command` target is used.
  In-memory testing no longer loads `node:child_process`, so the kit bundles for
  browsers and edge runtimes.
- Added a stdio end-to-end test.
- Docs: install and import commands now use the published name, `@sriramadari/mcp-devkit`.
- `prepare` script builds `dist/`, so the package can be installed straight from git.

## 0.1.0

Initial release: in-memory and stdio test clients, fluent tool-result assertions,
input-schema validation, mock server fixtures, an automated conformance checker, and a CLI.
