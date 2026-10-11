# Custom SilverBullet build

This fork's `custom/heading-folds` branch starts at the installed SilverBullet revision `1340f7369e782a9c99e898de75cd588051fdb7cd` (2.11.1), not newer upstream `main`.

## Changes

- Clickable fold controls appear only beside headings, not nested bullets or fenced code.
- Triangle controls are vertically centered at every heading level.
- Existing list/code folding commands remain available.
- Browser tests cover layout, folding, edits, and unchanged Markdown; a release integration test exercises the embedded client.
- `custom/table-widths` extends installed revision `2ee76b649c110e071e9e352f8593bb14fdaafd03` with draggable table-column boundaries. Drag any interior divider to redistribute the two adjacent columns without changing the overall table width. Arrow keys adjust a focused divider (Shift for one-pixel steps), Escape cancels a drag, and double-click/Home or **Reset column widths** restores automatic sizing.
- Table widths are relative proportions stored only in the browser's space-scoped client datastore, not in Markdown. They survive reload and body edits, and do not sync across browsers/devices. Identity is page path + source header + occurrence among matching headers: renaming the page, changing a header, or inserting/reordering duplicate-header tables can reset/reassign the preference. Clearing local client data clears widths. Rendered Markdown table widgets are supported; dynamically generated Lua/HTML tables are not included.
- Embedded-release tests verify dragging, persistence, responsiveness, reset/cancel/keyboard controls, independent tables/pages, ordinary cell editing, and unchanged Markdown.

## Builds

`.github/workflows/custom-build.yml` runs on pushes to this custom branch. It builds a static Linux x86-64 binary, runs frontend/editor/browser/release tests, and uploads the binary with checksums, source revision, feature diff, and test results. Third-party actions are commit-pinned. The workflow has read-only repository permissions and uses no server credentials.

Enable Actions under this fork's Actions tab if GitHub has disabled workflows for the fork. If enabled after the initial push, push a new commit to trigger the build. Manual dispatch is also defined, but GitHub requires the workflow to exist on the default branch before manual dispatch is available; this setup intentionally leaves `main` unchanged.

Inherited upstream CI ignores `custom/**` pushes so this feature does not run upstream's multi-platform release matrix. Do not manually run upstream publishing workflows for this custom branch.

There is **no automatic deployment**. Download the successful run's `silverbullet-heading-folds-linux-amd64-<commit>` artifact; verify checksums before manual installation. Keep the server's existing runtime/Docker base and a retained rollback image. A moving `latest` image is not a reproducible rollback.

## Maintenance

Keep upstream-tracking `main` separate from custom feature commits. Review and test upstream updates before merging/rebasing them into the custom branch. Do not put knowledge-base contents, server state, credentials, or private SSH keys in this repository.
