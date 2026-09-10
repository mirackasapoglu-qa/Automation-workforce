/**
 * Claude Code CLI çağrısı — hesap ortamı, limit ayrımı, çökme dayanıklılığı.
 * Sahte `claude` script'leriyle koşar; Anthropic'e HİÇ gidilmez.
 *
 * Koşum: node --test panel/claude-cli.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { askClaude, parseJsonLoose } from "./claude-cli.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cli-"));
const sh = (name, body) => {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return f;
};

/** Ortamı ve istemi yankılayan sahte CLI. */
const ECHO = sh("echo.sh", `
cat > "$0.stdin"
printf '{"result":"%s|%s","total_cost_usd":0.5,"modelUsage":{"claude-haiku-4-5":{"outputTokens":5},"claude-opus-4-6":{"outputTokens":900}},"session_id":"s1"}\\n' "$CLAUDE_CODE_OAUTH_TOKEN" "$CLAUDE_CONFIG_DIR"`);

test("hesap ortami CLI'ye gecer; istem stdin'den gider", async () => {
  const r = await askClaude("merhaba istem", {
    bin: ECHO,
    env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-HESAP", CLAUDE_CONFIG_DIR: "/veri/claude-2" },
    account: { id: "claude-2", label: "Ayşe" },
  });
  assert.equal(r.text, "sk-ant-oat01-HESAP|/veri/claude-2");
  assert.equal(fs.readFileSync(`${ECHO}.stdin`, "utf8"), "merhaba istem");
  assert.equal(r.costUsd, 0.5);
});

test("model etiketi: EN COK cikti ureten model (ilk anahtar degil)", async () => {
  const r = await askClaude("x", { bin: ECHO, env: { CLAUDE_CODE_OAUTH_TOKEN: "t", CLAUDE_CONFIG_DIR: "/c" } });
  assert.equal(r.model, "claude-opus-4-6");
  assert.deepEqual(r.models, ["claude-haiku-4-5", "claude-opus-4-6"]);
});

test("limit hatasi ayirt edilir ve HESAP ADI ile soylenir", async () => {
  const limitJson = sh("limit.sh", `cat > /dev/null; echo '{"is_error":true,"result":"Usage limit reached. Resets at 3pm."}'`);
  await assert.rejects(
    askClaude("x", { bin: limitJson, account: { id: "claude-1", label: "Murat" } }),
    (e) => e.code === "RATE_LIMIT" && /"Murat" hesabının/.test(e.message) && e.account === "Murat",
  );
  const limitExit = sh("limit2.sh", `cat > /dev/null; echo "rate limit exceeded, try again later" >&2; exit 1`);
  await assert.rejects(askClaude("x", { bin: limitExit }), (e) => e.code === "RATE_LIMIT");
});

test("siradan hata RATE_LIMIT sayilmaz", async () => {
  const bozuk = sh("bozuk.sh", `cat > /dev/null; echo '{"is_error":true,"result":"something broke"}'`);
  await assert.rejects(askClaude("x", { bin: bozuk }), (e) => e.code === "CLI_ERROR");
});

test("⚠️ istemi OKUMADAN cikan CLI paneli DUSURMEZ (EPIPE yakalanir)", async () => {
  const erken = sh("erken.sh", "exit 3");
  await assert.rejects(
    askClaude("x".repeat(200_000), { bin: erken }),
    (e) => e.code === "CLI_ERROR" && /EPIPE|3 koduyla/.test(e.message),
  );
  // Surec ayakta: bu satira gelebiliyor olmak testin kendisi.
  assert.ok(true);
});

test("CLI yoksa NO_CLI, kurulum ipucuyla", async () => {
  await assert.rejects(askClaude("x", { bin: path.join(tmp, "yok-boyle-bir-cli") }), (e) => e.code === "NO_CLI");
});

test("zarf JSON degilse ham metin dondurulur (surum farkinda uretim comez)", async () => {
  const duz = sh("duz.sh", `cat > /dev/null; echo "duz metin yanit"`);
  const r = await askClaude("x", { bin: duz });
  assert.equal(r.text, "duz metin yanit");
  assert.equal(r.costUsd, null);
});

test("parseJsonLoose: kod blogu ve on ek metni tolere eder", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Iste sonuc: {"a":2} umarim olur'), { a: 2 });
  assert.throws(() => parseJsonLoose("hic json yok"), /JSON döndürmedi/);
});
