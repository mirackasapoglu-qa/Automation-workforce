import { test, expect } from "@playwright/test";
import { StoresPage } from "../pages/StoresPage";

test.describe("07 - Mağazalar", () => {
  test("mağaza listesi yüklenir", async ({ page }) => {
    const stores = new StoresPage(page);
    await stores.open();

    await expect(stores.heading).toBeVisible();
    expect(await stores.storeCount(), "mağaza kartı bulunamadı").toBeGreaterThan(0);
    const names = await stores.storeNames();
    expect(names.length, "mağaza adı okunamadı").toBeGreaterThan(0);
    console.log(`  ${await stores.storeCount()} mağaza: ${names.join(", ")}`);
  });

  test("mağaza arama listeyi filtreler", async ({ page }) => {
    test.setTimeout(90_000);
    const stores = new StoresPage(page);
    await stores.open();

    const before = await stores.storeCount();
    expect(before, "başlangıçta mağaza yok").toBeGreaterThan(0);

    await stores.searchStore("zzzbulunamaz");
    const after = await stores.storeCount();

    expect(after, `sonuçsuz arama sonrası ${after} mağaza kaldı`).toBe(0);
    await stores.assertNotNotFound();
  });
});
