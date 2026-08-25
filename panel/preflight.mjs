/**
 * Önkoşul kontrolleri — artık connector kayıt defterinin ince bir kabuğu.
 *
 * Eskiden her servisin kontrolü bu dosyada elle yazılıydı; servis eklemek
 * dosyayı büyütüyordu ve "hangi servis hangi işi yapıyor" bilgisi hiçbir yerde
 * durmuyordu. Şimdi her servis `panel/connectors/<ad>.mjs` içinde kendi
 * kontrolünü ve yeteneklerini taşıyor, hangisinin kullanıldığını proje profili
 * söylüyor.
 *
 * Bu dosya çağrı uyumluluğu için duruyor: `import { preflight } from "./preflight.mjs"`
 * yazan çağıranlar (server.mjs) değişmeden çalışsın diye.
 */
export { preflight, capability, tracker, MAP, ALL } from "./connectors/index.mjs";
