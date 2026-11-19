import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

// Le QR du desktop contient une URL ...?session=TOKEN : on n'en garde que le token
const extractSession = (text) => {
  try {
    return new URL(text).searchParams.get("session");
  } catch {
    return null;
  }
};

export default function App() {
  const [session, setSession] = useState(
    () => new URLSearchParams(window.location.search).get("session")
  );
  const [status, setStatus] = useState("non connecté");
  const [user, setUser] = useState(null);
  const [info, setInfo] = useState("");
  const [scanning, setScanning] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [attempt, setAttempt] = useState(0); // permet de se reconnecter avec le même token
  const wsRef = useRef(null);

  // --- Connexion WebSocket dès qu'on a un token (depuis l'URL ou depuis le scan)
  useEffect(() => {
    if (!session) {
      setStatus("pas de session : scanne le QR du desktop");
      return;
    }
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws?session=${session}`);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connecté au desktop");
    ws.onclose = (e) => setStatus(`déconnecté (code ${e.code})`);
    ws.onerror = () => setStatus("erreur de connexion WebSocket");
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "user") setUser(msg.data);
    };
    return () => ws.close();
  }, [session, attempt]);

  // --- Scanner QR par caméra
  useEffect(() => {
    if (!scanning) return;
    const qr = new Html5Qrcode("reader");
    const starting = qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },
      (text) => {
        const token = extractSession(text);
        if (token) {
          setSession(token);
          setInfo("✓ QR lu, connexion en cours…");
          setScanning(false);
        } else {
          setInfo("✗ QR non reconnu : " + text.slice(0, 60));
        }
      },
      () => {} // erreurs de lecture image par image : ignorées
    );
    starting.catch((err) => {
      setInfo("✗ caméra : " + err);
      setScanning(false);
    });
    return () => {
      starting.then(() => qr.stop()).then(() => qr.clear()).catch(() => {});
    };
  }, [scanning]);

  const toggleScan = () => {
    if (!scanning && !window.isSecureContext) {
      setInfo("✗ caméra bloquée : ouvre la page en HTTPS (ou sur localhost)");
      return;
    }
    setScanning(!scanning);
  };

  // Saisie manuelle : accepte l'URL complète du QR ou seulement le token
  const connectManual = () => {
    const text = manualUrl.trim();
    const token = extractSession(text) || (/^[\w-]{6,}$/.test(text) ? text : null);
    if (!token) {
      setInfo("✗ URL ou token invalide (attendu : ...?session=TOKEN)");
      return;
    }
    setSession(token);
    setAttempt((a) => a + 1);
    setInfo("✓ connexion en cours…");
  };

  const replyToDesktop = () => {
    const msg = {
      type: "user",
      data: { name: "Réponse depuis le web", email: "web@example.com", age: 30 },
    };
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setInfo(`✗ non envoyé : WebSocket non connecté (état ${ws ? ws.readyState : "aucun"})`);
      return;
    }
    ws.send(JSON.stringify(msg));
    setInfo("✓ envoyé : " + JSON.stringify(msg.data));
  };

  return (
    <div style={{ fontFamily: "sans-serif", padding: 20, maxWidth: 480, margin: "auto" }}>
      <h2>Web ↔ Desktop</h2>
      <p>Statut : <b>{status}</b></p>

      <button onClick={toggleScan} style={{ padding: "10px 16px" }}>
        {scanning ? "Arrêter le scan" : "📷 Scanner le QR code"}
      </button>
      {scanning && <div id="reader" style={{ width: "100%", marginTop: 12 }} />}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && connectManual()}
          placeholder="Colle l'URL du QR ou le token"
          style={{ flex: 1, padding: 8, minWidth: 0 }}
        />
        <button onClick={connectManual} style={{ padding: "8px 14px" }}>
          Se connecter
        </button>
      </div>

      <h3>User reçu du desktop</h3>
      <pre style={{ background: "#eee", color: "#222", padding: 12, borderRadius: 8 }}>
        {user ? JSON.stringify(user, null, 2) : "— rien reçu pour l'instant —"}
      </pre>

      <button onClick={replyToDesktop} style={{ padding: "10px 16px" }}>
        Envoyer un user → desktop
      </button>
      <p>{info}</p>
    </div>
  );
}