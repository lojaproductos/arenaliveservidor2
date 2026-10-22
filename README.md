# Servidor da Arena

Conecta na live do TikTok e manda comentários e presentes para o site por WebSocket.
Usa a biblioteca `tiktok-live-connector` versão 2 (a atual).

## Subir no GitHub + Render
1. Crie um repositório no GitHub e suba **todos** estes arquivos (`server.js`, `package.json`, `render.yaml`, `.gitignore`, `.env.example`).
2. No Render: New → Web Service → escolha o repositório (ou New → Blueprint, que lê o `render.yaml` sozinho).
   - Build Command: `npm install`  ·  Start Command: `npm start`
3. (Recomendado) Em Environment, crie `SIGN_API_KEY` com uma chave gratuita de eulerstream.com. Sem ela funciona, mas pode falhar quando muita gente usa o serviço gratuito.
4. Quando ficar "Live", abra a URL do Render. Deve aparecer "Servidor da Arena no ar ✅". Use no site como `wss://seu-app.onrender.com`.

## Como conferir se está funcionando
- `https://seu-app.onrender.com/health` → `ok`
- `https://seu-app.onrender.com/status` → lista as lives conectadas, com quantos comentários e presentes chegaram.
- Nos Logs do Render aparece uma linha 🎁 a cada presente recebido.
- No site, o selo "● AO VIVO" confirma a conexão.

## Observações
- A live precisa estar ativa. Se ainda não começou, o servidor espera e tenta de novo sozinho (o site mostra "OFFLINE").
- O plano gratuito do Render dorme quando fica parado: abra a URL dele uns minutos antes de começar a live.
- Presentes em combo são contados só quando o combo termina (valendo a quantidade final).
- Node 20 ou mais novo.
