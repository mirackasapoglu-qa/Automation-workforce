import { BrowserRouter, Route, Routes } from "react-router-dom";
import Index from "./pages/Index";
import Onboarding from "./pages/Onboarding";

/**
 * SPA ARTIK KOKTE DEGIL: `/` tek dosyalik statik landing (Vesper.ai tasarimi,
 * kokteki `index.html`). React uygulamasinin girisi `onboarding/index.html`.
 *
 * `/` rotasi yine burada duruyor ama YALNIZCA eski landing'i (pages/Index)
 * geri getirmek gerekirse diye — normal akista bu dokuman `/` adresinde hic
 * servis edilmiyor. Yeni tasarimi kaldirip eskiye donmek isteyen kisi kokteki
 * index.html'i React girisine cevirip bu rotayi kullanir.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        {/* Eski cok bolumlu landing, karsilastirma icin acik: /landing */}
        <Route path="/landing" element={<Index />} />
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    </BrowserRouter>
  );
}
