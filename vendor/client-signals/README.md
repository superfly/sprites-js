# Vendored client-signals

This is the JavaScript package from
[superfly/client-signals](https://github.com/superfly/client-signals) at
release `v0.4.3`.

It is bundled with `@fly/sprites` because `@fly/client-signals` is not yet
published to npm. The runtime source is unmodified. This vendored package adds
TypeScript declarations and corrects the package license metadata to match the
upstream Apache-2.0 repository license.

`@fly/sprites` ships this directory two ways: npm resolves the dependency from
the bundled `node_modules` copy, and the `files` entry keeps `vendor/` in the
tarball so the `file:vendor/client-signals` specifier still resolves under
package managers that handle `bundledDependencies` differently.

Once `@fly/client-signals` is on npm, delete this directory and replace the
file dependency, the `bundledDependencies` entry, and the `files` entry with a
normal registry version range.
