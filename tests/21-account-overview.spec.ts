import { test, expect } from "./fixtures";
import { AccountPage } from "../pages/AccountPage";
import { OrdersPage } from "../pages/OrdersPage";
import { FavoritesPage } from "../pages/FavoritesPage";
import { ACCOUNT_ROUTES } from "./routes";
import { TEST_EMAIL } from "../pages/authState";

test.describe("21 - Hesabım özeti", () => {
  test("hesap özeti kullanıcı bilgilerini gösterir", async ({ memberPage }) => {
    const account = new AccountPage(memberPage);
    await account.open();

    await expect(account.heading).toHaveText(/Hesabım/);
    const body = (await memberPage.locator("body").innerText()).toLowerCase();
    expect(body).toContain(TEST_EMAIL.toLowerCase());
    await expect(account.logoutButton).toBeVisible();
  });

  test("hesap menüsündeki tüm alt sayfalar açılır", async ({ memberPage }) => {
    test.setTimeout(180_000);
    const account = new AccountPage(memberPage);
    const problems: string[] = [];

    for (const route of ACCOUNT_ROUTES) {
      await account.goto(route.path);
      if (memberPage.url().includes("/giris")) {
        problems.push(`${route.path} → login'e düştü (oturum kaybı)`);
        continue;
      }
      if (await account.isNotFound()) {
        problems.push(`${route.path} → Sayfa Bulunamadı`);
        continue;
      }
      const h1 = await memberPage.locator("h1:visible").first().innerText();
      if (!h1.includes(route.heading)) {
        problems.push(`${route.path} → beklenen "${route.heading}", gelen "${h1}"`);
      }
    }

    expect(problems, problems.join("\n")).toHaveLength(0);
  });

  test("siparişlerim sayfası liste veya boş durum gösterir", async ({ memberPage }) => {
    const orders = new OrdersPage(memberPage);
    await orders.open();

    await expect(orders.heading).toBeVisible();
    const count = await orders.orderCount();
    if (count === 0) {
      expect(await orders.isEmpty(), "sipariş yok ama boş durum mesajı da yok").toBe(true);
    }
  });

  test("favorilerim sayfası liste veya boş durum gösterir", async ({ memberPage }) => {
    const fav = new FavoritesPage(memberPage);
    await fav.open();

    await expect(fav.heading).toBeVisible();
    await fav.assertNotNotFound();
  });

  test("çıkış yapınca oturum kapanır ve korumalı sayfa login'e döner", async ({ memberPage }) => {
    test.setTimeout(120_000);
    const account = new AccountPage(memberPage);
    await account.open();

    // logout() onay diyaloğunu da basar — sadece menü butonuna basmak yetmez
    await account.logout();

    await account.goto("/hesabim/siparislerim");
    expect(memberPage.url(), "çıkıştan sonra korumalı sayfa hâlâ açılıyor").toContain("/giris");
  });
});
