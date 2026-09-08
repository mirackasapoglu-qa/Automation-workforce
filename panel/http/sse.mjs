/**
 * SSE dinleyici havuzu — canlı log, koşum ve diff olayları.
 *
 * Eskiden `server.mjs` içinde çıplak bir `Set` + `broadcast()` vardı ve
 * `/api/events` dinleyiciyi elle ekleyip `req.on("close")` ile düşürüyordu.
 * Aynı üç satır iki yerde tekrarlanmasın diye burada: `add` yanıtı SSE'ye
 * çevirir, `write` tek dinleyiciye (geçmişi tekrar oynatmak için), `broadcast`
 * herkese. Kopan bağlantı yazma hatasında sessizce düşer.
 */
export function createSseHub() {
  const clients = new Set();
  const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  return {
    add(req, res) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": bagli\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
    },

    write(res, event, data) {
      try { res.write(frame(event, data)); } catch { clients.delete(res); }
    },

    broadcast(event, data) {
      const msg = frame(event, data);
      for (const res of clients) {
        try { res.write(msg); } catch { clients.delete(res); }
      }
    },

    size: () => clients.size,
  };
}
