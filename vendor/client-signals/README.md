# Vendored client-signals

This is the JavaScript implementation from
[superfly/client-signals](https://github.com/superfly/client-signals) release
[`v0.4.4`](https://github.com/superfly/client-signals/releases/tag/v0.4.4).

The JavaScript implementation is not published to npm. Vendoring it inside
`@fly/sprites` is the supported distribution model. The runtime source and
TypeScript declarations are unmodified; the package metadata is adapted for
vendoring and carries the upstream Apache-2.0 license.

`@fly/sprites` includes this directory in its tarball through the `files`
entry and imports the runtime directly by relative path. No separate package
installation is required. This avoids depending on how package managers
restore a bundled `file:` dependency from a consumer lockfile.

To update the snapshot, copy the runtime and declarations from a reviewed
upstream release, update the release link above, and keep the `files` entry
and relative imports in sync. Then run the full test
suite and verify that the packed `@fly/sprites` tarball installs offline.
