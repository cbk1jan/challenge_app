# challenge_app
Eine App um eine Schnitzeljagd bzw. Challenge Event mit Custom Fragen zu veranstalten

## Deployment mit Portainer

Die App wird automatisch als Docker Image auf GitHub Container Registry (ghcr.io) veröffentlicht.

### Portainer Stack hinzufügen

1. In Portainer: **Stacks** → **Add stack**
2. Name: `challenge-app` (oder beliebiger Name)
3. Build method: **Repository** oder **Web editor**
4. Folgende URL verwenden:
   ```
   https://raw.githubusercontent.com/cbk1jan/challenge_app/main/docker-compose.yml
   ```

   Oder den Inhalt direkt in den Web Editor kopieren:
   ```yaml
   version: '3.8'
   services:
     app:
       image: ghcr.io/cbk1jan/challenge_app:latest
       ports:
         - "3000:3000"
       environment:
         - PORT=3000
         - SESSION_SECRET=IHR-SICHERES-SECRET-HIER
         - NODE_ENV=production
       volumes:
         - challenge_data:/app/data
         - challenge_uploads:/app/uploads
       restart: unless-stopped
       healthcheck:
         test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
         interval: 30s
         timeout: 5s
         retries: 3
         start_period: 10s
   volumes:
     challenge_data:
     challenge_uploads:
   ```

5. **Wichtig**: `SESSION_SECRET` durch ein sicheres Passwort ersetzen!
6. Optional: Port anpassen (z.B. `"8080:3000"` für Port 8080)
7. Stack deployen

### Umgebungsvariablen

- `PORT`: Interner Port der App (Standard: 3000)
- `SESSION_SECRET`: **Wichtig!** Sicheres Secret für Sessions (bitte ändern!)
- `NODE_ENV`: Produktionsmodus (production)

### Zugriff

Nach dem Deployment ist die App erreichbar unter:
```
http://IHR-SERVER:3000
```

### Updates

Das Image wird automatisch bei jedem Push auf den `main` Branch aktualisiert. In Portainer:
1. Stack auswählen
2. "Pull and redeploy" klicken

## Lokale Entwicklung

```bash
npm install
npm start
```
