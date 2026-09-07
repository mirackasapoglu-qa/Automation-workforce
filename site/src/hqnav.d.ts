/**
 * Ortak ust bar (shared/nav/nav.js) klasik bir script; TypeScript onu gormuyor.
 * Sayfalarin panel/Kapsam adresini sabit yazmak yerine bardan sormasi icin
 * yalnizca kullandigimiz yuzey burada tanimli.
 */
interface HqNavApi {
  url(surface: "panel" | "scope" | "landing" | "onboarding"): string;
  setLeaf(text: string): void;
  setRoot(text: string): void;
}

interface Window {
  HqNav?: HqNavApi;
}
