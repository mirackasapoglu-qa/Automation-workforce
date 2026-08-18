import { test, expect } from "@playwright/test";
import { BasePage } from "../pages/BasePage";
import { STATIC_ROUTES } from "./routes";
import { KNOWN_ISSUES } from "./known-issues";

test.describe("08 - Statik / kurumsal sayfalar", () => {
  for (const route of STATIC_ROUTES) {
    test(`${route.path} açılır ve doğru başlığı gösterir`, async ({ page }) => {
      const p = new BasePage(page);
      await p.goto(route.path);

      await p.assertNotNotFound();
      const h1 = await page.locator("h1:visible").first().innerText();
      expect(h1, `${route.path} → beklenen başlık "${route.heading}", gelen "${h1}"`).toContain(
        route.heading,
      );
    });
  }

  /** BİLİNEN HATA HOMEE-002: /magazalar sayfasında kırık görsel */
  test("statik sayfalarda kırık görsel yok", async ({ page }) => {
    test.setTimeout(180_000);
    test.fail(true, `${KNOWN_ISSUES.storesBrokenImage.id}: ${KNOWN_ISSUES.storesBrokenImage.detail}`);
    const p = new BasePage(page);
    const problems: string[] = [];

    for (const route of STATIC_ROUTES.slice(0, 5)) {
      await p.goto(route.path);
      const broken = await page.$$eval("img", (imgs) =>
        imgs
          .filter((i) => !!(i as HTMLImageElement).offsetHeight)
          .filter((i) => !(i as HTMLImageElement).naturalWidth)
          .map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src),
      );
      if (broken.length) problems.push(`${route.path}: ${broken.slice(0, 3).join(", ")}`);
    }

    expect(problems, `kırık görseller:\n${problems.join("\n")}`).toHaveLength(0);
  });
});
