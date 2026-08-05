# Vendored client-signals

This is the JavaScript implementation from
[superfly/client-signals](https://github.com/superfly/client-signals) release
[`v0.4.4`](https://github.com/superfly/client-signals/releases/tag/v0.4.4).

The JavaScript implementation is not published to npm. Vendoring it inside
`@fly/sprites` is the supported distribution model. The runtime source and
TypeScript declarations are unmodified; the package metadata is adapted for
bundling and carries the upstream Apache-2.0 license.

`@fly/sprites` ships this directory two ways: npm resolves the dependency from
the bundled `node_modules` copy, and the `files` entry keeps `vendor/` in the
tarball so the `file:vendor/client-signals` specifier still resolves under
package managers that handle `bundledDependencies` differently.

To update the snapshot, copy the runtime and declarations from a reviewed
upstream release, update the release link above, and keep the local dependency,
`bundledDependencies`, and `files` entries in sync. Then run the full test
suite and verify that the packed `@fly/sprites` tarball installs offline.
