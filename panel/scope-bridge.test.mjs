// scope-bridge saf katmanı — hiçbir test diske dokunmaz (fonksiyonlar ağacı
// parametre olarak alır). Ölçtüğümüz şey: profildeki elle yazılmış listelerin
// yerini alan türetmelerin GERÇEKTEN aynı bilgiyi üretmesi ve tahmine dayalı
// eşleme yapmaması.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nodeSiteUrl, toRoutePath, deriveRoutes, routesWithFallback, deriveJiraIndex,
  nodesForSpec, deriveCases, deriveSummary, deriveRuns, matchPerfRoutes, resourceKind,
} from "./scope-bridge.mjs";

const node = (id, name, extra = {}) => ({
  id, name, type: "page", status: "⬜", notes: [], jiraTasks: [], resourceLinks: [],
  statusHistory: [], testCases: [], children: [], ...extra,
});
const link = (url, type) => ({ url, label: "", type: type ?? undefined, createdAt: "2026-09-14T00:00:00.000Z" });

const AGAC = [
  node("n1", "Homee", {
    type: "module", children: [
      node("n2", "Anasayfa", {
        resourceLinks: [link("https://site.test/")],
        runRef: { runId: "test-anasayfa", specs: ["01-homepage.spec.ts"] },
        jiraTasks: [{ id: "j1", taskId: "MAC-7037" }],
        testCases: [{ id: "tc1", title: "Otomatik: 01-homepage.spec.ts", spec: "01-homepage.spec.ts", automated: true, runs: [{ id: "r1", at: "2026-09-14T10:00:00.000Z", status: "✅", note: "5/5 geçti" }] }],
      }),
      node("n3", "Sepet", {
        status: "❌",
        resourceLinks: [
          link("https://www.figma.com/design/ABC/x"),
          link("https://site.test/sepet?x=1"),
        ],
        jiraTasks: [{ id: "j2", taskId: "mac-7074" }],
        testCases: [{ id: "tc2", title: "Elle: boş sepet", draft: true, runs: [] }],
      }),
      node("n4", "Yabanci", { resourceLinks: [link("https://baska.example/sayfa")] }),
      node("n5", "Linksiz", {}),
    ],
  }),
];

test("nodeSiteUrl: figma/confluence/jira linkleri rota sayilmaz", () => {
  const sepet = AGAC[0].children[1];
  assert.equal(nodeSiteUrl(sepet), "https://site.test/sepet?x=1");
  assert.equal(resourceKind("https://machinarium.atlassian.net/wiki/spaces/X/pages/1"), "confluence");
  assert.equal(resourceKind("https://machinarium.atlassian.net/browse/MAC-1"), "jira");
});

test("nodeSiteUrl: baseHost verilirse yabanci host elenir", () => {
  const yabanci = AGAC[0].children[2];
  assert.equal(nodeSiteUrl(yabanci), "https://baska.example/sayfa");
  assert.equal(nodeSiteUrl(yabanci, "site.test"), null);
});

test("toRoutePath: sondaki egik cizgi duser, sorgu korunur", () => {
  assert.equal(toRoutePath("https://site.test/"), "/");
  assert.equal(toRoutePath("https://site.test/sepet/"), "/sepet");
  assert.equal(toRoutePath("https://site.test/arama?q=koltuk"), "/arama?q=koltuk");
  assert.equal(toRoutePath("degil"), null);
});

test("deriveRoutes: yalnizca site linkli dugumler, agac sirasinda", () => {
  const r = deriveRoutes(AGAC, { baseUrl: "https://site.test" });
  assert.deepEqual(r.map((x) => x.path), ["/", "/sepet?x=1"]);
  assert.equal(r[0].runId, "test-anasayfa");
  assert.deepEqual(r[1].jiraKeys, ["MAC-7074"]);   // buyuk harfe normalize
});

test("deriveRoutes: ayni yol iki dugumde ise ilki kazanir, digeri alsoNodes'a duser", () => {
  const iki = [node("a", "A", {
    type: "module", children: [
      node("b", "B", { resourceLinks: [link("https://site.test/sepet")] }),
      node("c", "C", { resourceLinks: [link("https://site.test/sepet")] }),
    ],
  })];
  const r = deriveRoutes(iki, { baseUrl: "https://site.test" });
  assert.equal(r.length, 1);
  assert.equal(r[0].nodeId, "b");
  assert.deepEqual(r[0].alsoNodes, ["c"]);
});

test("routesWithFallback: agac bossa profil listesi ayni sekilde doner", () => {
  const bos = routesWithFallback([], { baseUrl: "https://site.test", quickRoutes: [["Anasayfa", "/"]] });
  assert.equal(bos.source, "profile");
  assert.equal(bos.routes[0].path, "/");
  assert.equal(bos.routes[0].url, "https://site.test/");
  const dolu = routesWithFallback(AGAC, { baseUrl: "https://site.test", quickRoutes: [["X", "/x"]] });
  assert.equal(dolu.source, "scope");
});

test("deriveJiraIndex: kart -> dugum, anahtar buyuk harf", () => {
  const idx = deriveJiraIndex(AGAC, { baseUrl: "https://site.test" });
  assert.deepEqual(Object.keys(idx).sort(), ["MAC-7037", "MAC-7074"]);
  assert.equal(idx["MAC-7074"][0].nodeId, "n3");
  assert.equal(idx["MAC-7074"][0].status, "❌");
});

test("nodesForSpec: yalnizca acik runRef eslesmesi (URL benzerligi DEGIL)", () => {
  assert.deepEqual(nodesForSpec(AGAC, "01-homepage.spec.ts").map((n) => n.id), ["n2"]);
  assert.deepEqual(nodesForSpec(AGAC, "06-cart.spec.ts").map((n) => n.id), []);
  assert.deepEqual(nodesForSpec(AGAC, ""), []);
});

test("deriveCases: son kosum ve taslak isareti tasinir", () => {
  const c = deriveCases(AGAC);
  assert.equal(c.length, 2);
  assert.equal(c[0].lastRun.status, "✅");
  assert.equal(c[1].draft, true);
  assert.equal(c[1].lastRun, null);
});

test("deriveSummary: kapsam 'case var mi', kosulmus olmak ayri sayac", () => {
  const s = deriveSummary(AGAC, { baseUrl: "https://site.test" });
  assert.equal(s.nodes.total, 5);
  assert.equal(s.nodes.leaves, 4);
  assert.equal(s.coverage.withCase, 2);
  assert.equal(s.coverage.pct, 50);
  assert.equal(s.cases.total, 2);
  assert.equal(s.cases.run, 1);            // tc2 hic kosulmamis
  assert.equal(s.cases.byLastStatus["✅"], 1);
  assert.equal(s.routes.total, 2);
  assert.equal(s.jira.keys, 2);
});

test("deriveRuns: whitelist disi runId known:false ile isaretlenir", () => {
  const r = deriveRuns(AGAC, ["test-anasayfa"]);
  assert.equal(r.length, 1);
  assert.equal(r[0].known, true);
  assert.deepEqual(r[0].nodes.map((n) => n.nodeId), ["n2"]);
  assert.equal(deriveRuns(AGAC, [])[0].known, false);
});

test("matchPerfRoutes: sorgu dizesi yok sayilarak eslesir", () => {
  const m = matchPerfRoutes(AGAC, [{ route: "/sepet" }, { route: "/yok" }], { baseUrl: "https://site.test" });
  assert.equal(m[0].nodeId, "n3");
  assert.equal(m[1].nodeId, null);
});
