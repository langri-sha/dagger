/**
 * Reusable Dagger building blocks for TigerFS — install the CLI into a
 * container, mount Postgres-backed filesystems, provision file-first apps.
 *
 * TigerFS turns a Postgres database (Tiger Cloud, Ghost.build, or any
 * Postgres connection string) into a FUSE filesystem. Each "app" is a
 * directory backed by a typed table; each file is a row.
 *
 * Workflow encoded by these helpers:
 *   1. install()                 — drop the tigerfs binary in /usr/local/bin
 *   2. withMount()               — mount ghost:NAME or postgres:// into PATH
 *   3. withApp() (file-first)    — `echo <kind> > <mount>/.build/<name>`
 *
 * Skipping step 3 is exactly what made the previous hermes-workspace
 * integration silently lose writes: writes to the mount root land in no
 * table because no app was provisioned.
 */
import {
  dag,
  Container,
  Directory,
  Secret,
  object,
  func,
  CacheSharingMode,
} from "@dagger.io/dagger"

const DEFAULT_INSTALL_DIR = "/usr/local/bin"
const DEFAULT_INSTALLER_URL = "https://install.tigerfs.io"
const DEFAULT_GHOST_INSTALLER_URL = "https://install.ghost.build"

@object()
export class Tigerfs {
  /**
   * Install the `tigerfs` CLI (and `ghost` for ghost:NAME backends) into a
   * container. Caches the installer download.
   */
  @func()
  install(
    ctr: Container,
    /**
     * URL of the tigerfs install script. Defaults to the official one.
     */
    installerUrl?: string,
    /**
     * URL of the ghost install script. Set null/empty to skip.
     */
    ghostInstallerUrl?: string,
    /**
     * Directory inside the container to install the binaries into.
     */
    installDir?: string,
  ): Container {
    const dir = installDir?.trim() || DEFAULT_INSTALL_DIR
    const tigerUrl = installerUrl?.trim() || DEFAULT_INSTALLER_URL
    const ghostUrl =
      ghostInstallerUrl === undefined
        ? DEFAULT_GHOST_INSTALLER_URL
        : ghostInstallerUrl.trim() || ""

    let result = ctr
      .withExec([
        "sh",
        "-c",
        `set -e
         apt-get update -qq
         DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
           ca-certificates curl fuse3
         apt-get clean && rm -rf /var/lib/apt/lists/*
         curl -fsSL ${tigerUrl} | INSTALL_DIR=${dir} sh
         tigerfs version | head -3`,
      ])

    if (ghostUrl) {
      result = result.withExec([
        "sh",
        "-c",
        `set -e
         curl -fsSL ${ghostUrl} | INSTALL_DIR=${dir} sh
         ghost version | head -1`,
      ])
    }

    return result
  }

  /**
   * Return a Bash snippet that mounts a TigerFS filesystem in the
   * background, waits for the mountpoint, and exits non-zero on failure.
   *
   * Use this inside an entrypoint script. It expects:
   *   - GHOST_API_KEY env var if connection starts with `ghost:`
   *   - mount path is writable to the running user
   *   - fusermount3 is SUID-root (installed by `install()`)
   *
   * The snippet runs `tigerfs migrate` first so a pre-existing ghost DB
   * gets the file-first schema installed before mount, which avoids the
   * silent-write trap when the DB exists but the schema does not.
   */
  @func()
  mountSnippet(
    /**
     * Connection string. ghost:NAME, tiger:ID, or postgres://...
     */
    connection: string,
    /**
     * Where to mount the filesystem inside the container.
     */
    mountPath: string,
    /**
     * Optional log file (relative to /tmp by default).
     */
    logFile?: string,
  ): string {
    const log = logFile?.trim() || `/tmp/tigerfs-${slug(connection)}.log`
    return [
      `# tigerfs mount: ${connection} -> ${mountPath}`,
      `mkdir -p "${mountPath}"`,
      `echo "[tigerfs] migrate ${connection}"`,
      `tigerfs migrate "${connection}" >"${log}.migrate" 2>&1`,
      `echo "[tigerfs] mount ${connection} -> ${mountPath}"`,
      `tigerfs mount "${connection}" "${mountPath}" >"${log}" 2>&1 &`,
      `for _ in $(seq 1 60); do`,
      `  if mountpoint -q "${mountPath}" 2>/dev/null; then break; fi`,
      `  sleep 0.5`,
      `done`,
      `if ! mountpoint -q "${mountPath}" 2>/dev/null; then`,
      `  echo "[tigerfs] FAILED to mount ${connection} at ${mountPath}" >&2`,
      `  cat "${log}" >&2`,
      `  exit 1`,
      `fi`,
      `echo "[tigerfs] mounted ${connection} at ${mountPath}"`,
    ].join("\n")
  }

  /**
   * Return a Bash snippet that provisions a file-first app inside an
   * already-mounted TigerFS filesystem, idempotently.
   *
   * `kind` is one of:
   *   - "markdown"           — YAML frontmatter + body, columns auto-inferred
   *   - "markdown,history"   — markdown app with versioned history
   *   - "plaintext"          — body-only, no frontmatter parsing
   *
   * No-op if the app directory already exists.
   */
  @func()
  buildAppSnippet(
    mountPath: string,
    appName: string,
    kind?: string,
  ): string {
    const k = kind?.trim() || "markdown"
    return [
      `# tigerfs app: ${appName} (${k})`,
      `if [ ! -d "${mountPath}/${appName}" ]; then`,
      `  echo "${k}" > "${mountPath}/.build/${appName}"`,
      `  echo "[tigerfs] provisioned app ${appName} (${k}) at ${mountPath}/${appName}"`,
      `else`,
      `  echo "[tigerfs] app ${appName} already provisioned at ${mountPath}/${appName}"`,
      `fi`,
    ].join("\n")
  }

  /**
   * Snapshot the contents of a TigerFS-backed app directory into a Dagger
   * `Directory` so consumers can mount it without running FUSE inside
   * their own container.
   *
   * Why: privileged FUSE-in-Dagger needs `insecureRootCapabilities=true`
   * on every consumer service. The simpler pattern is to do the FUSE
   * work in a one-shot helper container, snapshot the file tree it
   * exposes, and hand the consumer a plain Directory artifact they
   * mount with `withMountedDirectory` (no caps, no FUSE).
   *
   * Trade-off: the result is read-only at the consumer side. If you need
   * persistent writes, keep the FUSE mount in the consumer container or
   * build an upload step that pushes a Directory back into TigerFS.
   *
   * Steps inside the helper container:
   *   1. install tigerfs + ghost CLIs into debian:trixie-slim
   *   2. tigerfs migrate / mount ghost:<connection> at /mnt/tigerfs
   *   3. provision the app (no-op if it already exists)
   *   4. cp -a the app dir into /snapshot
   *   5. unmount and return /snapshot
   */
  @func()
  snapshot(
    /**
     * Connection string. ghost:NAME, tiger:ID, or postgres://...
     */
    connection: string,
    ghostApiKey: Secret,
    /**
     * App name to snapshot. Provisioned on demand if missing.
     */
    app: string,
    /**
     * App kind ("markdown" | "markdown,history" | "plaintext"). Defaults
     * to "plaintext" so binary blobs round-trip verbatim.
     */
    appKind?: string,
  ): Directory {
    const kind = appKind?.trim() || "plaintext"
    const mountPath = "/mnt/tigerfs"
    const snapshotPath = "/snapshot"
    const mount = this.mountSnippet(connection, mountPath)
    const build = this.buildAppSnippet(mountPath, app, kind)

    return this.install(
      dag
        .container()
        .from("debian:trixie-slim")
        .withMountedCache(
          "/var/cache/apt",
          dag.cacheVolume("apt-cache"),
          { sharing: CacheSharingMode.Locked },
        ),
    )
      .withSecretVariable("GHOST_API_KEY", ghostApiKey)
      .withExec([
        "sh",
        "-c",
        `set -e
${mount}
${build}
mkdir -p ${snapshotPath}
cp -a "${mountPath}/${app}/." "${snapshotPath}/"
fusermount3 -u "${mountPath}" || umount "${mountPath}"
echo "[tigerfs] snapshot ${app} (${kind}) -> ${snapshotPath}"
ls -la "${snapshotPath}" | head -20`,
      ])
      .directory(snapshotPath)
  }

  /**
   * Smoke-test container: install tigerfs+ghost, mount the given ghost
   * database, provision a markdown app, write a known file, read it back,
   * and dump the row count. Intended as a CI check or for debugging
   * authentication / permission issues end-to-end.
   *
   * Caller must supply a Ghost API key with permission to create / migrate
   * the target database.
   */
  @func()
  smokeTest(
    /**
     * ghost:NAME, tiger:ID or postgres:// connection string.
     */
    connection: string,
    ghostApiKey: Secret,
    /**
     * Mount path. Defaults to /mnt/tigerfs-smoke.
     */
    mountPath?: string,
    /**
     * App name to provision. Defaults to "smoke".
     */
    appName?: string,
  ): Container {
    const path = mountPath?.trim() || "/mnt/tigerfs-smoke"
    const app = appName?.trim() || "smoke"
    const mount = this.mountSnippet(connection, path)
    const build = this.buildAppSnippet(path, app, "markdown")

    return this.install(
      dag
        .container()
        .from("debian:trixie-slim")
        .withMountedCache(
          "/var/cache/apt",
          dag.cacheVolume("apt-cache"),
          { sharing: CacheSharingMode.Locked },
        ),
    )
      .withSecretVariable("GHOST_API_KEY", ghostApiKey)
      .withExec([
        "sh",
        "-c",
        `set -e
${mount}
${build}
cat > "${path}/${app}/proof.md" <<'EOF'
---
title: TigerFS Dagger Smoke Test
author: dagger
tags: [smoke, dagger]
---

This file was written through a Dagger-orchestrated TigerFS mount.
EOF
echo "--- file content ---"
cat "${path}/${app}/proof.md"
echo "--- ls ---"
ls -la "${path}/${app}/"`,
      ])
  }
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 60) || "tigerfs"
}
