import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const launcher = join(repositoryRoot, "scripts/dev-desktop-first-run.mjs");
const isolatedKeys = [
  "ZCODE_DATA_BASE_DIR",
  "ZCODE_DESKTOP_HOME_DIR",
  "ZCODE_DESKTOP_USER_DATA_DIR",
  "ZCODE_DESKTOP_SESSION_DATA_DIR",
  "ZCODE_HOME",
  "ZCODE_STORAGE_DIR",
  "ZCODE_SESSION_DB_PATH",
];

test("first-run commands are added while the original mise dev task is unchanged", async () => {
  const { scripts } = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
  assert.equal(scripts["dev:desktop:first-run"], "node scripts/dev-desktop-first-run.mjs");
  assert.equal(scripts["dev:desktop:test"], "node scripts/dev-desktop-env.mjs test");
  const mise = await readFile(join(repositoryRoot, "mise.toml"), "utf8");
  assert.equal(
    mise.match(/\[tasks\.dev\]\n[\s\S]*?(?=\n\[|$)/)?.[0].trim(),
    '[tasks.dev]\ndescription = "Start the desktop app in an isolated local test environment."\n' +
      'env = { ZCODE_DATA_BASE_DIR = "{{env.HOME}}/.zcode-dev-home" }\n' +
      'run = "mise exec -- node scripts/mise-run.mjs pnpm dev:desktop:test"',
  );
  assert.match(
    mise,
    /\[tasks\.dev-first-run\][\s\S]*?run = "mise exec -- node scripts\/mise-run\.mjs pnpm dev:desktop:first-run"/,
  );
});

test("each run overrides old persistence paths without mutating the parent environment", async (t) => {
  const { createFirstRunEnvironment } = await import(pathToFileURL(launcher).href);
  const inherited = {
    HOME: join(tmpdir(), "existing-home"),
    USERPROFILE: join(tmpdir(), "existing-profile"),
    PATH: "existing-toolchain",
    ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA: "1",
    ...Object.fromEntries(isolatedKeys.map((key) => [key, "existing-data"])),
  };
  const before = { ...inherited };
  const first = await createFirstRunEnvironment(inherited);
  t.after(() => rm(first.runRoot, { recursive: true, force: true }));
  const second = await createFirstRunEnvironment(inherited);
  t.after(() => rm(second.runRoot, { recursive: true, force: true }));
  assert.notEqual(first.runRoot, second.runRoot);
  assert.deepEqual(await readdir(first.runRoot), []);
  assert.deepEqual(inherited, before);
  assert.equal(first.env.HOME, inherited.HOME);
  assert.equal(first.env.USERPROFILE, inherited.USERPROFILE);
  assert.equal(first.env.PATH, inherited.PATH);
  assert.equal(first.env.ZCODE_DATA_BASE_DIR, first.runRoot);
  assert.equal(first.env.ZCODE_DESKTOP_HOME_DIR, first.runRoot);
  assert.equal(first.env.ZCODE_DESKTOP_USER_DATA_DIR, join(first.runRoot, "electron"));
  assert.equal(first.env.ZCODE_DESKTOP_SESSION_DATA_DIR, join(first.runRoot, "electron-session"));
  assert.equal(first.env.ZCODE_DESKTOP_USE_ELECTRON_DEFAULT_USER_DATA, "0");
  assert.equal(first.env.ZCODE_HOME, join(first.runRoot, ".zcode"));
  assert.equal(first.env.ZCODE_STORAGE_DIR, join(first.runRoot, "agent-storage"));
  assert.equal(
    first.env.ZCODE_SESSION_DB_PATH,
    join(first.runRoot, "agent-storage/session.sqlite"),
  );
});

async function runLauncherFixture(t, exitCode = 0, signal = "") {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "first-run launcher fixture "));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(join(fixtureRoot, "scripts"));
  await copyFile(launcher, join(fixtureRoot, "scripts/dev-desktop-first-run.mjs"));
  await writeFile(
    join(fixtureRoot, "scripts/dev-desktop-env.mjs"),
    `import { writeFile } from "node:fs/promises";
await writeFile(process.env.FIRST_RUN_TEST_RESULT, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(), node: process.execPath,
  env: Object.fromEntries(${JSON.stringify([...isolatedKeys, "HOME"])}.map(key => [key, process.env[key]])),
}));
await writeFile(process.env.ZCODE_DATA_BASE_DIR + "/retained-record", "completed");
if (process.env.FIRST_RUN_TEST_SIGNAL) process.kill(process.pid, process.env.FIRST_RUN_TEST_SIGNAL);
else process.exitCode = Number(process.env.FIRST_RUN_TEST_EXIT_CODE);
`,
  );
  const oldData = join(fixtureRoot, "old-data");
  await mkdir(oldData);
  await writeFile(join(oldData, "retained-record"), "existing");
  const resultFile = join(fixtureRoot, "result.json");
  const result = await exec(
    process.execPath,
    [join(fixtureRoot, "scripts/dev-desktop-first-run.mjs")],
    {
      cwd: tmpdir(),
      env: {
        ...process.env,
        ...Object.fromEntries(isolatedKeys.map((key) => [key, oldData])),
        FIRST_RUN_TEST_RESULT: resultFile,
        FIRST_RUN_TEST_EXIT_CODE: String(exitCode),
        FIRST_RUN_TEST_SIGNAL: signal,
      },
    },
  ).then(
    (value) => ({ ...value, code: 0 }),
    (error) => error,
  );
  const child = JSON.parse(await readFile(resultFile, "utf8"));
  const runRoot = child.env.ZCODE_DATA_BASE_DIR;
  t.after(() => rm(runRoot, { recursive: true, force: true }));
  assert.deepEqual(child.args, ["test"]);
  assert.equal(child.cwd, fixtureRoot);
  assert.equal(child.node, process.execPath);
  assert.equal(child.env.HOME, process.env.HOME);
  assert.ok(result.stdout.includes(runRoot), "the data directory is printed");
  assert.equal(await readFile(join(runRoot, "retained-record"), "utf8"), "completed");
  assert.equal(await readFile(join(oldData, "retained-record"), "utf8"), "existing");
  return result;
}

test("launcher delegates to the existing test startup and retains data after successful exit", async (t) => {
  const result = await runLauncherFixture(t);
  assert.equal(result.code, 0, result.stderr);
});

test("launcher preserves the startup failure code and retains diagnostic data", async (t) => {
  const result = await runLauncherFixture(t, 17);
  assert.equal(result.code, 17, result.stderr);
});

test("launcher reports failure when the startup script cannot be loaded", async (t) => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "first-run-missing-child-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await mkdir(join(fixtureRoot, "scripts"));
  await copyFile(launcher, join(fixtureRoot, "scripts/dev-desktop-first-run.mjs"));
  await assert.rejects(
    exec(process.execPath, [join(fixtureRoot, "scripts/dev-desktop-first-run.mjs")]),
    (error) => {
      const runRoot = error.stdout.match(/\[first-run\] Data directory: (.+)/)?.[1];
      if (runRoot) t.after(() => rm(runRoot, { recursive: true, force: true }));
      assert.equal(error.code, 1);
      assert.match(error.stderr, /MODULE_NOT_FOUND/);
      assert.ok(runRoot);
      return true;
    },
  );
});

test(
  "launcher propagates a child termination signal",
  { skip: process.platform === "win32" },
  async (t) => {
    const result = await runLauncherFixture(t, 0, "SIGTERM");
    assert.equal(result.signal, "SIGTERM");
  },
);
