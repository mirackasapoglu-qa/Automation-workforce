/*
 * Tür paketi deposu — GERÇEK dosyaya yazarak ölçülür, ama geçici bir çalışma
 * dizininde: depo yolunu `process.cwd()`'den kuruyor, o yüzden ayrı süreçte
 * koşuyor (aynı desen `scope-writeback.test.mjs`'te). Repo'daki
 * `panel-data/type-packages.json` kirletilmez.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MOD = path.resolve(import.meta.dirname, "type-packages.mjs");

function calistir(kod) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tp-"));
  const script = `
    const { listPackages, savePackage, deletePackage } = await import(${JSON.stringify(MOD)});
    const hata = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
    const sonuc = await (async () => { ${kod} })();
    console.log("<<<" + JSON.stringify(sonuc) + ">>>");
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out.slice(out.indexOf("<<<") + 3, out.lastIndexOf(">>>")));
}

test("dosya yoksa liste BOS doner — tohumlama yok", () => {
  assert.deepEqual(calistir("return listPackages();"), []);
});

test("paket kaydedilir, turler tekillestirilir ve liste doner", () => {
  const out = calistir(`
    savePackage({ label: "Regresyon", types: ["happy", "negative", "happy", " boundary "] });
    return listPackages();
  `);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "tp1");
  assert.deepEqual(out[0].types, ["happy", "negative", "boundary"]);
});

test("isim bos ya da tur bos olamaz", () => {
  const out = calistir(`
    return {
      isim: hata(() => savePackage({ label: "  ", types: ["happy"] })),
      tur: hata(() => savePackage({ label: "X", types: [] })),
    };
  `);
  assert.match(out.isim, /İsim boş olamaz/);
  assert.match(out.tur, /En az bir test türü/);
});

test("ayni isim iki kez kaydedilemez (buyuk/kucuk harf duyarsiz)", () => {
  const out = calistir(`
    savePackage({ label: "Regresyon", types: ["happy"] });
    return hata(() => savePackage({ label: "REGRESYON", types: ["negative"] }));
  `);
  assert.match(out, /zaten var/);
});

test("id ile guncellenir, yeni kayit acilmaz", () => {
  const out = calistir(`
    const p = savePackage({ label: "Regresyon", types: ["happy"] });
    savePackage({ id: p.id, label: "Regresyon v2", types: ["happy", "negative"] });
    return listPackages();
  `);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Regresyon v2");
  assert.deepEqual(out[0].types, ["happy", "negative"]);
});

test("olmayan id ile guncelleme ve silme hata verir", () => {
  const out = calistir(`
    return { guncelle: hata(() => savePackage({ id: "tp99", label: "X", types: ["happy"] })),
             sil: hata(() => deletePackage("tp99")) };
  `);
  assert.match(out.guncelle, /Paket bulunamadı/);
  assert.match(out.sil, /Paket bulunamadı/);
});

test("silinen paket listeden duser", () => {
  const out = calistir(`
    const a = savePackage({ label: "A", types: ["happy"] });
    savePackage({ label: "B", types: ["negative"] });
    deletePackage(a.id);
    return listPackages().map((p) => p.label);
  `);
  assert.deepEqual(out, ["B"]);
});

test("limit 1-10 arasina sikistirilir", () => {
  const out = calistir(`
    savePackage({ label: "A", types: ["happy"], limit: 99 });
    savePackage({ label: "B", types: ["happy"], limit: 0 });
    return listPackages().map((p) => [p.label, p.limit]);
  `);
  assert.deepEqual(out.sort(), [["A", 10], ["B", 1]]);
});
