import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";


export default defineConfig({
  // basicSsl : certificat auto-signé, indispensable pour que le navigateur
  // du téléphone autorise la caméra sur une adresse en 192.168.x.x
  plugins: [react(),],
  server: {
    host: true, // accessible depuis le téléphone
    port: 5173,
    proxy: {
      // wss://IP:5173/ws -> ws://127.0.0.1:8000/ws (serveur Python)
      "/ws": { target: "ws://127.0.0.1:8000", ws: true },
    },
  },
});