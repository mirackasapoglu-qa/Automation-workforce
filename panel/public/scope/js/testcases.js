// Test Case'ler — Xray'deki "Test Repository"ye benzer, ağaçtaki TÜM test
// case'leri (hangi sayfaya bağlı olursa olsun, hangi pakette olursa olsun)
// tek bir yerden gözden geçirme fikri. BİLEREK GELİŞTİRİLMEDİ: sidebar'da yeri
// ayrıldı ama içeriği yok — kullanıcı bu sayfayı kendi tasarlayıp kuracak
// (bkz. proje notları). Sadece bu dosyanın kendi modülü olması, ileride
// paketlerin (packages.js) içine karışmadan buraya oturması için.
export function renderTestCasesView() {
  const wrap = document.createElement('div');
  wrap.className = 'pkg-list-page';

  const header = document.createElement('div');
  header.className = 'pkg-page-header';
  const h2 = document.createElement('h2');
  h2.textContent = "Test Case'ler";
  const p = document.createElement('p');
  p.textContent = 'Yakında — ağaçtaki tüm test case\'leri tek bir yerden gözden geçirme.';
  header.append(h2, p);
  wrap.appendChild(header);

  const empty = document.createElement('div');
  empty.className = 'board-col-empty';
  empty.textContent = 'Bu sayfa henüz tasarlanmadı.';
  wrap.appendChild(empty);

  return wrap;
}
