
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);

function read(path) {
    return readFileSync(new URL(path, root), "utf8");
}

const commands = [
    "get_app_info",
    "check_ipc_protocol",
    "open_sqlite_connection",
    "list_sqlite_connections",
    "close_sqlite_connection",
    "get_sqlite_schema",
];

test("only approved IPC commands are registered", () => {
    const source = read("src-tauri/src/lib.rs");

    const handler = source.match(
        /generate_handler!\s*\[([\s\S]*?)\]/,
    );

    assert.ok(handler, "Tauri command handler is missing");

    const registered = [
        ...handler[1].matchAll(
            /commands::(?:app_info|connections)::(\w+)/g,
        ),
    ].map((match) => match[1]);

    assert.deepEqual(registered, commands);
    assert.doesNotMatch(source, /\bfn\s+greet\b/);
});

test("command permissions remain restricted", () => {
    const capability = JSON.parse(
        read("src-tauri/capabilities/default.json"),
    );

    const expected = commands
        .map((command) => `allow-${command.replaceAll("_", "-")}`)
        .sort();

    assert.deepEqual(capability.windows, ["main"]);
    assert.deepEqual([...capability.permissions].sort(), expected);

    const build = read("src-tauri/build.rs");

    for (const command of commands) {
        assert.ok(
            build.includes(`"${command}"`),
            `Missing command manifest entry: ${command}`,
        );
    }
});

test("production CSP restricts script execution", () => {
    const config = JSON.parse(
        read("src-tauri/tauri.conf.json"),
    );

    const security = config.app.security;

    assert.deepEqual(security.capabilities, ["default"]);

    assert.equal(security.csp["script-src"], "'self'");
    assert.match(security.csp["connect-src"], /\bipc:/);
    assert.match(
        security.csp["connect-src"],
        /http:\/\/ipc\.localhost/,
    );

    assert.doesNotMatch(
        security.csp["script-src"],
        /unsafe-inline|unsafe-eval/,
    );

    assert.notEqual(security.csp, null);
});

test("opener plugin is not enabled", () => {
    const manifest = read("src-tauri/Cargo.toml");
    const packageJson = JSON.parse(read("package.json"));

    assert.doesNotMatch(manifest, /tauri-plugin-opener/);

    assert.equal(
        packageJson.dependencies?.["@tauri-apps/plugin-opener"],
        undefined,
    );
});
