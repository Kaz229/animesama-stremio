# Hébergeurs

État relevé en septembre 2026.

## Taux d'extraction

Taux d'extraction mesuré sur 10 URLs embed par hébergeur :

| Hébergeur | Extraction | Format livré | Referer exigé |
|-----------|-----------|--------------|---------------|
| **Sibnet** | 10/10 | MP4 après redirection signée | **oui** — 400 sans |
| **Ansembed** | 10/10 | HLS m3u8 | non |
| **Sendvid** | 0/10 | — | — (hébergeur en 502) |
| **Streamtape** | non rencontré | MP4 (regex JS) | — |
| **Lpayer (embed4me.com)** | ❌ | — | — |

> Sendvid répond actuellement `502` sur ses pages embed : la panne est chez
> l'hébergeur, l'extracteur n'est pas en cause.

## En-têtes par hébergeur

Seul Sibnet refuse la requête sans le `Referer` de sa page embed. Lui seul reçoit donc
`notWebReady: true` + `proxyHeaders`, qui font relayer le flux par le serveur interne
de Stremio.

Appliquer ce drapeau à tout le monde pénalisait Ansembed : son HLS (master, variantes,
44 segments) transitait par le proxy alors qu'il se sert sans aucun en-tête — master,
variante et segment répondent `200` sans `Referer`. Les hébergeurs sans contrainte
gardent `notWebReady: false` et sont lus nativement.

Les jetons Ansembed sont valides 12 h et liés à l'ASN appelant (`asn=` dans l'URL),
ce qui les rend inutilisables depuis un réseau différent de celui qui les a obtenus.

## Problème lpayer (TODO principal)

Le player `lpayer.embed4me.com` est une SPA React avec Vidstack. Il :
1. Appelle `/api/v1/info?id=HASH` → réponse chiffrée AES-CBC
2. Clé hardcodée : `kiemtienua911ca` (hex: `6b69656d7469656e6d75613931316361`)
3. IV hardcodé : `1234567890oiuytr` (hex: `313233343536373839306f6975797472`)
4. Réponse déchiffrée = JSON avec `playerId`, `title`, `poster`, etc. — **mais pas d'URL vidéo**
5. L'URL vidéo devrait venir de `/api/v1/player?t=TOKEN` — mais ce call n'est jamais déclenché malgré des clics simulés
6. La détection anti-bot est forte : vérifie `navigator.webdriver`, `userAgent` (cherche "puppeteer", "playwright", etc.), et le contexte d'exécution
7. Le `data-load="custom"` du player indique un chargement manuel déclenché par un événement React — pas par un simple `.click()` sur `.vds-play-button`

**Pistes pour débloquer lpayer :**
- Injecter du JS pour appeler directement la fonction React qui charge la source vidéo
- Utiliser Playwright avec bypass stealth plus avancé
- Monkey-patcher `fetch` avant le chargement de la page pour capturer l'appel `/api/v1/player`
- Analyser le bundle `prod-CbREaqWl.js` pour trouver la fonction qui génère le token et appelle l'API player
- Essayer de déconstruire le token manuellement (encrypt de quoi ?)

