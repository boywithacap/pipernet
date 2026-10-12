import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";

const template = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const [directory, identifier, displayName] = args;

function fail(message) {
  console.error(message);
  process.exit(1);
}
function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (!directory || !identifier || args.length > 3) {
  fail('Usage: bun run create -- ../my-app com.example.myapp "My App"');
}
if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(identifier)) {
  fail("Use a lowercase reverse-domain identifier, such as com.example.myapp.");
}
// Resolve the parent first so a symlink cannot accidentally point back into this template.
const requested = resolve(directory);
if (!existsSync(dirname(requested)))
  fail("The destination parent folder must already exist.");
const destination = join(realpathSync(dirname(requested)), basename(requested));
const fromTemplate = relative(template, destination);
if (
  !fromTemplate ||
  (!fromTemplate.startsWith("../") && !isAbsolute(fromTemplate))
) {
  fail("Choose a destination outside the template folder.");
}
if (existsSync(destination))
  fail("The destination already exists. Choose a new folder.");
const slug = basename(destination);
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
  fail("Use a lowercase folder name with optional hyphens, such as my-app.");
}

const ignored = new Set([
  "node_modules",
  ".git",
  ".expo",
  "dist",
  "web-build",
  "ios",
  "android",
  "expo-env.d.ts",
  ".DS_Store",
  "credentials.json",
]);
mkdirSync(destination);
cpSync(template, destination, {
  recursive: true,
  filter: (source) => {
    const name = basename(source);
    return (
      (!ignored.has(name) ||
        ((name === "ios" || name === "android") &&
          relative(template, source).startsWith(`modules/`))) &&
      !name.startsWith(".env") &&
      !/\.(?:tsbuildinfo|p8|p12|pem|key|jks|mobileprovision)$/.test(name)
    );
  },
});

const name = displayName?.trim() || slug;
const pkg = readJson(join(destination, "package.json"));
pkg.name = slug;
writeJson(join(destination, "package.json"), pkg);
const config = readJson(join(destination, "app.json"));
config.expo.name = name;
config.expo.slug = slug;
config.expo.scheme = slug;
config.expo.ios.bundleIdentifier = identifier;
config.expo.android.package = identifier;
delete config.expo.owner;
delete config.expo.extra?.eas;
delete config.expo.updates;
writeJson(join(destination, "app.json"), config);
const eas = readJson(join(destination, "eas.json"));
delete eas.submit?.production?.ios?.ascAppId;
writeJson(join(destination, "eas.json"), eas);
writeFileSync(
  join(destination, "src/constants/app.ts"),
  `export const APP = ${JSON.stringify({ name, storagePrefix: slug }, null, 2)} as const;\n`,
);
// Preserve every dependency resolution while updating the Bun workspace name.
const lockPath = join(destination, "bun.lock");
writeFileSync(
  lockPath,
  readFileSync(lockPath, "utf8").replace(
    /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"[^"]*"/,
    `$1${JSON.stringify(slug)}`,
  ),
);
console.log(
  `Created ${name} at ${destination}\nOpen that folder, then run:\n  bun install --frozen-lockfile\n  bun start`,
);
