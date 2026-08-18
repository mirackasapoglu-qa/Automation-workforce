import { test, expect } from "./fixtures";
import { OrdersPage } from "../pages/OrdersPage";
import { AccountPage } from "../pages/AccountPage";

test.describe("24 - Siparişler ve iadeler", () => {
  test("siparişlerim sayfası hatasız yüklenir", async ({ memberPage }) => {
    const orders = new OrdersPage(memberPage);
    await orders.open();

    await expect(orders.heading).toBeVisible();
    await orders.assertNotNotFound();

    const body = await memberPage.locator("body").innerText();
    expect(body, "ne sipariş listesi ne boş durum mesajı var").toMatch(
      /bulunmamaktadır|siparişiniz bulunmuyor|Sipariş No|Sipariş Tarihi|TÜMÜNÜ GÖR/i,
    );
  });

  test("iadelerim sayfası hatasız yüklenir (API hata durumu yok)", async ({ memberPage }) => {
    const account = new AccountPage(memberPage);
    await account.goto("/hesabim/iadelerim");

    await account.assertNotNotFound();
    const body = await memberPage.locator("body").innerText();
    expect(body, "iadelerim sayfası 'TEKRAR DENE' hata durumunda").not.toMatch(/TEKRAR DENE/);
  });

  test("sipariş özeti hesap ana sayfasında görünür", async ({ memberPage }) => {
    const account = new AccountPage(memberPage);
    await account.open();

    const body = await memberPage.locator("body").innerText();
    expect(body).toMatch(/Son Siparişlerim/);
  });
});
