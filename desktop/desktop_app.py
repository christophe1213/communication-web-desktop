"""
Prototype : customTkinter <-> React via QR code d'appairage + WebSocket (serveur local).

Flux :
1. Le desktop génère un token de session et démarre un serveur local (FastAPI).
2. Il affiche un QR contenant http://IP-LOCALE:8000/?session=TOKEN
3. Le téléphone scanne le QR avec l'appareil photo natif -> ouvre la page React
   servie par ce même serveur -> la page ouvre un WebSocket /ws?session=TOKEN
4. Les deux côtés échangent des messages JSON : {"type": "user", "data": {...}}
"""
import asyncio
import json
import os
import queue
import secrets
import socket
import threading

import customtkinter as ctk
import qrcode
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

PORT = 8000
SESSION = secrets.token_urlsafe(8)          # token d'appairage
DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")

incoming = queue.Queue()                    # messages web -> UI desktop
state = {"ws": None, "loop": None}          # connexion web active

# ---------------------------------------------------------------- serveur ---
app = FastAPI()


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, session: str = ""):
    if session != SESSION:                  # token invalide -> refus
        await ws.close(code=4403)
        return
    await ws.accept()

    old = state["ws"]                       # une seule connexion active
    if old is not None:
        try:
            await old.close()
        except Exception:
            pass
    state["ws"], state["loop"] = ws, asyncio.get_running_loop()
    incoming.put({"type": "status", "connected": True})

    try:
        while True:
            incoming.put(await ws.receive_json())
    except WebSocketDisconnect:
        pass
    except Exception as exc:                # JSON invalide, etc.
        incoming.put({"type": "error", "detail": str(exc)})
    finally:
        if state["ws"] is ws:
            state["ws"] = None
            incoming.put({"type": "status", "connected": False})


if os.path.isdir(DIST):                     # sert le build React
    app.mount("/", StaticFiles(directory=DIST, html=True), name="web")


def run_server():
    config = uvicorn.Config(app, host="0.0.0.0", port=PORT, log_level="warning")
    asyncio.run(uvicorn.Server(config).serve())


def send_to_web(payload: dict) -> bool:
    ws, loop = state["ws"], state["loop"]
    if ws is None or loop is None:
        return False
    asyncio.run_coroutine_threadsafe(ws.send_json(payload), loop)
    return True


def local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


# --------------------------------------------------------------------- UI ---
class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Desktop <-> Web (QR)")
        self.geometry("440x760")

        # FRONT_PORT=5173 en mode `npm run dev` ; sinon la page est servie par le port 8000
        front_port = int(os.getenv("FRONT_PORT", PORT))
        scheme = "https" if os.getenv("FRONT_HTTPS") else "http"
        self.url = f"{scheme}://{local_ip()}:{front_port}/?session={SESSION}"
        img = qrcode.make(self.url).get_image().convert("RGB")
        self.qr = ctk.CTkImage(light_image=img, size=(240, 240))

        ctk.CTkLabel(self, image=self.qr, text="").pack(pady=(16, 6))
        ctk.CTkLabel(self, text=self.url, wraplength=400, font=("Consolas", 11)).pack()
        self.status = ctk.CTkLabel(self, text="⏳ En attente du scan…")
        self.status.pack(pady=8)

        self.name = ctk.CTkEntry(self, placeholder_text="Nom", width=300)
        self.email = ctk.CTkEntry(self, placeholder_text="Email", width=300)
        self.age = ctk.CTkEntry(self, placeholder_text="Âge", width=300)
        for w in (self.name, self.email, self.age):
            w.pack(pady=3)

        ctk.CTkButton(self, text="Envoyer user → web", command=self.send_user).pack(pady=10)
        self.log = ctk.CTkTextbox(self, width=400, height=240)
        self.log.pack(pady=6)

        self.after(100, self.poll)

    def write(self, text: str):
        self.log.insert("end", text + "\n")
        self.log.see("end")

    def send_user(self):
        try:
            age = int(self.age.get() or 0)
        except ValueError:
            age = 0
        msg = {"type": "user",
               "data": {"name": self.name.get(), "email": self.email.get(), "age": age}}
        ok = send_to_web(msg)
        self.write(("→ envoyé : " if ok else "✗ aucun client : ") + json.dumps(msg, ensure_ascii=False))

    def poll(self):
        while not incoming.empty():
            msg = incoming.get()
            if msg.get("type") == "status":
                self.status.configure(
                    text="✅ Web connecté" if msg["connected"] else "⏳ Web déconnecté")
            else:
                self.write("← reçu : " + json.dumps(msg, ensure_ascii=False))
        self.after(100, self.poll)


if __name__ == "__main__":
    threading.Thread(target=run_server, daemon=True).start()
    App().mainloop()