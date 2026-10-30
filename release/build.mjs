import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
const version = process.env.RELEASE_VERSION;
const revision = process.env.RELEASE_REVISION;
if (
  version !== pkg.version ||
  !/^\d+\.\d+\.\d+(?:-(?:rc|beta|alpha)\.[1-9]\d*)?$/.test(version) ||
  !/^[a-f0-9]{40}$/.test(revision)
)
  throw new Error("Release version/revision is invalid");
if (pkg.license !== "Apache-2.0")
  throw new Error("The release license is missing");
const privateKey = crypto.createPrivateKey(
  process.env.MINIMAIL_RELEASE_SIGNING_KEY || "",
);
const trustedKey = fs.readFileSync(path.join(root, "updater/public-key.pem"));
if (
  !crypto
    .createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .equals(
      crypto
        .createPublicKey(trustedKey)
        .export({ type: "spki", format: "der" }),
    )
)
  throw new Error("Release signing secret differs from embedded public key");
const output = path.join(root, "release-dist");
fs.mkdirSync(output, { recursive: false });
const images = {
  image: process.env.APP_IMAGE,
  databaseImage: process.env.DATABASE_IMAGE,
  vpnImage: process.env.VPN_IMAGE,
};
const updaterVersion = fs
  .readFileSync(path.join(root, "updater/release.go"), "utf8")
  .match(/var updaterVersion = "([0-9]+\.[0-9]+\.[0-9]+)"/)?.[1];
if (!updaterVersion) throw new Error("The updater version is missing");
for (const [name, image] of Object.entries(images))
  if (
    !/^ghcr\.io\/n1k0m0\/minimail(?:-database|-vpn)?@sha256:[a-f0-9]{64}$/.test(
      image || "",
    )
  )
    throw new Error(`Invalid ${name}`);
const common = {
  format: 1,
  version,
  revision,
  ...images,
  schema: 1,
  readSchemaMin: 1,
  readSchemaMax: 1,
  minUpdater: updaterVersion,
  automaticPatchSafe: true,
};
const hash = (data) => crypto.createHash("sha256").update(data).digest("hex");
const sign = (data) =>
  crypto.sign(null, data, privateKey).toString("base64") + "\n";
const childEnvironment = { ...process.env, CGO_ENABLED: "0" };
delete childEnvironment.MINIMAIL_RELEASE_SIGNING_KEY;
const goroot = execFileSync("go", ["env", "GOROOT"], {
  env: childEnvironment,
  encoding: "utf8",
}).trim();
const artifacts = {};
const text = (name) =>
  fs.readFileSync(path.join(root, name), "utf8").replace(/\r\n/g, "\n");
const changes = text("CHANGELOG.md")
  .split(`## ${version}\n`)[1]
  ?.split("\n## ")[0]
  ?.trim();
if (!changes) throw new Error("The release changelog entry is missing");
for (const [os, arch] of [
  ["linux", "amd64"],
  ["linux", "arm64"],
  ["windows", "amd64"],
  ["windows", "arm64"],
  ["darwin", "amd64"],
  ["darwin", "arm64"],
]) {
  const platform = `${os}-${arch}`,
    folder = path.join(output, platform);
  fs.mkdirSync(folder);
  const binary = os === "windows" ? "minimail.exe" : "minimail";
  execFileSync(
    "go",
    [
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-ldflags=-s -w",
      "-o",
      path.join(folder, binary),
      ".",
    ],
    {
      cwd: path.join(root, "updater"),
      env: { ...childEnvironment, GOOS: os, GOARCH: arch },
      stdio: "inherit",
    },
  );
  const compose = text("compose.yaml")
    .replace("    build: .\n", `    image: ${images.image}\n`)
    .replace(
      "    build:\n      context: .\n      dockerfile: database/Dockerfile\n",
      `    image: ${images.databaseImage}\n`,
    );
  const vpnCompose = text("compose.vpn.yaml").replace(
    "    build:\n      context: .\n      dockerfile: vpn/Dockerfile\n",
    `    image: ${images.vpnImage}\n`,
  );
  if (
    /\bbuild:/.test(compose + vpnCompose) ||
    !compose.includes(images.databaseImage) ||
    !compose.includes(images.image) ||
    !vpnCompose.includes(images.vpnImage)
  )
    throw new Error("Release Compose generation left source builds behind");
  fs.writeFileSync(path.join(folder, "compose.yaml"), compose);
  fs.writeFileSync(path.join(folder, "compose.vpn.yaml"), vpnCompose);
  for (const name of [
    "compose.https.yaml",
    "Caddyfile.example",
    "install.sh",
    "install.ps1",
    "install-update-task.ps1",
  ])
    fs.copyFileSync(path.join(root, "release", name), path.join(folder, name));
  for (const name of ["LICENSE", "NOTICE", "README.md", "compose.geoip.yaml"])
    fs.copyFileSync(path.join(root, name), path.join(folder, name));
  fs.copyFileSync(
    path.join(goroot, "LICENSE"),
    path.join(folder, "GO-LICENSE"),
  );
  fs.copyFileSync(
    path.join(root, "updater/public-key.pem"),
    path.join(folder, "release-public-key.pem"),
  );
  fs.chmodSync(path.join(folder, binary), 0o755);
  fs.chmodSync(path.join(folder, "install.sh"), 0o755);
  const files = Object.fromEntries(
    fs
      .readdirSync(folder)
      .sort()
      .map((name) => [name, hash(fs.readFileSync(path.join(folder, name)))]),
  );
  const manifest = Buffer.from(
    JSON.stringify({ ...common, assets: files }, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(folder, "bundle.json"), manifest);
  fs.writeFileSync(path.join(folder, "bundle.json.sig"), sign(manifest));
  const name = `minimail-v${version}-${platform}.${os === "windows" ? "zip" : "tar.gz"}`;
  if (os === "windows")
    execFileSync(
      process.env.PYTHON || "python3",
      [
        "-m",
        "zipfile",
        "-c",
        path.join(output, name),
        ...fs.readdirSync(folder).map((file) => path.join(folder, file)),
      ],
      { env: childEnvironment },
    );
  else
    execFileSync("tar", ["-czf", path.join(output, name), "-C", folder, "."], {
      env: childEnvironment,
    });
  artifacts[name] = hash(fs.readFileSync(path.join(output, name)));
}
const manifest = Buffer.from(
  JSON.stringify({ ...common, assets: artifacts }, null, 2) + "\n",
);
fs.writeFileSync(path.join(output, "release.json"), manifest);
fs.writeFileSync(path.join(output, "release.json.sig"), sign(manifest));
fs.writeFileSync(
  path.join(output, "SHA256SUMS.txt"),
  Object.entries(artifacts)
    .map(([name, sum]) => `${sum}  ${name}`)
    .join("\n") + "\n",
);
fs.writeFileSync(
  path.join(output, "RELEASE_NOTES.md"),
  `MiniMail ${version}\n\n${changes}\n\nApache 2.0 release with prebuilt app, MySQL and optional VPN images, signed installation packages, an administrator update page and a standalone host updater.\n\nUpdates preserve existing encryption keys, private Compose files and persistent volumes. Before migrations, the updater stops the app, backs up data and configuration, and restores the SQL backup into a disposable database to compare table counts and checksums. Compatible image rollback keeps all current SQL data.\n\nDefault policy: notify only. Automatic updates require explicit opt-in and accept stable patch versions within the configured maintenance window. MySQL/VPN image upgrades remain separate maintenance operations.\n\nDownload the package for your host platform, extract it, run install.sh or install.ps1 and configure HTTPS before signing in. Existing installations use the documented adopt command. Source-build instructions and release-package instructions are separate in README.md.\n\nCandidate release: test provider-specific behavior before using it for additional users.\n`,
);
console.log(
  `Prepared signed installation packages for ${version}; no deployment data was included.`,
);
