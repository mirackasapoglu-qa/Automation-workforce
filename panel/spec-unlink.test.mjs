/*
 * Ağaçtan spec bağını kaldırma — GERÇEK dosyaya yazar, o yüzden geçici cwd'de
 * ayrı süreçte koşar (aynı desen scope-writeback.test.mjs'te).
 *
 * Ölçülen davranış: her "yeniden üret" runRef.specs'e yeni dosya ekliyordu,
 * eskisi duruyordu ve aynı case üç kopyada koşuyordu (canlıda 4 case → 9 test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MOD = path.resolve(import.meta.dirname, "scope.mjs");

const AGAC = [{
  id: "n1", name: "Kok", type: "module", children: [
    {
      id: "n2", name: "Sayfa", type: "page", children: [],
      runRef: { runId: null, specs: ["gen-a.spec.ts", "gen-b.spec.ts"] },
      testCases: [
        { id: "tc1", title: "Gercek case", spec: "gen-a.spec.ts", steps: [] },
        { id: "tc2", title: "Otomatik: gen-a.spec.ts", spec: "gen-a.spec.ts", steps: [] },
        { id: "tc3", title: "Baska case", spec: "gen-b.spec.ts", steps: [] },
      ],
    },
  ],
}];

function calistir(kod) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unlink-"));
  fs.mkdirSync(path.join(dir, "panel-data", "scope"), { recursive: true });
  fs.writeFileSync(path.join(dir, "panel-data", "scope", "tree.json"), JSON.stringify(AGAC));
  const script = `
    const s = await import(${JSON.stringify(MOD)});
    console.log("<<<" + JSON.stringify(await (async () => { ${kod} })()) + ">>>");
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8", env: { ...process.env, PANEL_PROJECT: "homee" } });
  const sonuc = JSON.parse(out.slice(out.indexOf("<<<") + 3, out.lastIndexOf(">>>")));
  const agac = JSON.parse(fs.readFileSync(path.join(dir, "panel-data", "scope", "tree.json"), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...sonuc, __agac: agac };
}

test("bag UC yerden birden kalkar: runRef, tc.spec ve cop case", () => {
  const r = calistir(`return s.unlinkSpec("gen-a.spec.ts");`);
  const n2 = r.__agac[0].children[0];
  assert.deepEqual(n2.runRef.specs, ["gen-b.spec.ts"], "runRef'ten dusmeli");
  assert.equal(n2.testCases.find((t) => t.id === "tc2"), undefined, "'Otomatik: <dosya>' cop case'i dusmeli");
  assert.equal(n2.testCases.find((t) => t.id === "tc1").spec, undefined, "gercek case 'elle'ye donmeli");
  assert.equal(n2.testCases.find((t) => t.id === "tc3").spec, "gen-b.spec.ts", "diger spec'e DOKUNULMAMALI");
  assert.equal(r.cases, 1);
  assert.equal(r.dropped, 1);
});

test("olmayan spec: agac degismez, hata da vermez", () => {
  const r = calistir(`return s.unlinkSpec("gen-yok.spec.ts");`);
  const n2 = r.__agac[0].children[0];
  assert.deepEqual(n2.runRef.specs, ["gen-a.spec.ts", "gen-b.spec.ts"]);
  assert.deepEqual(r.nodes, []);
});

test("specUsage: silmeden ONCE ne etkilenecegini soyler", () => {
  const r = calistir(`return s.specUsage("gen-a.spec.ts");`);
  assert.equal(r[0].nodeId, "n2");
  assert.equal(r[0].onNode, true);
  assert.equal(r[0].cases.length, 2);
});

test("bos ad reddedilir", () => {
  // NOT: `calistir` donen degere __agac ekliyor, o yuzden nesne dondurulur.
  const r = calistir(`try { s.unlinkSpec(""); return { hata: null }; } catch (e) { return { hata: e.message }; }`);
  assert.match(r.hata, /spec adı zorunlu/);
});
