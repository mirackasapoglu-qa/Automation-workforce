// Flowscope'un fiilen bağlı olduğu üç yeteneğin (tracker/design/docs) durumu.
// Yeni bir uç açmıyor — panelin kendi "Bağlantılar" sekmesinin okuduğu
// /api/preflight'ı kullanıyor, yalnızca Flowscope'un umursadığı satırları süzüyor.
// Kimlik/şalter/reassignment mantığının TEK doğruluk kaynağı sunucu tarafında
// (connectors/index.mjs); burada hiçbir sağlayıcı adı sabit yazılmıyor —
// hangi sağlayıcının hangi yeteneği karşıladığını sunucu söylüyor.
const WANTED_CAPS = new Set(['tracker', 'design', 'docs']);

/** @returns {Array<{key,label,state,detail,capabilities}>|null} */
export async function fetchConnectorStatus() {
  try {
    const res = await fetch('/api/preflight');
    const data = await res.json();
    const checks = Array.isArray(data.checks) ? data.checks : [];
    return checks.filter(c => !c.passive && (c.capabilities || []).some(cap => WANTED_CAPS.has(cap)));
  } catch (e) {
    return null;
  }
}
