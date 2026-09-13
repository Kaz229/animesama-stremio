# Déploiement sur un serveur public — à lire avant

Le code est prêt techniquement : `index.js` lit `process.env.PORT`, ce qu'attendent
Railway, Render et consorts. Mais quatre points doivent être pesés d'abord.

## Ansembed cessera probablement de fonctionner

C'est la limite la plus concrète. Les URLs HLS d'Ansembed portent un jeton lié à
**l'ASN du réseau qui l'a demandé** (`asn=` dans l'URL), valable 12 h.

L'addon récupère ce jeton depuis le serveur. Hébergé à distance, c'est l'ASN du
datacenter qui est gravé dans l'URL, alors que votre lecteur, lui, est chez votre
opérateur. Le flux a toutes les chances d'être refusé.

Sibnet n'a pas ce problème : l'addon ne renvoie qu'une URL statique, et c'est le
lecteur qui déclenche la redirection signée depuis son propre réseau.

Un déploiement distant fait donc perdre Ansembed et garder Sibnet — la majorité du
catalogue d'après l'échantillon mesuré, mais pas la totalité.

## Stremio Web exige du HTTPS

Les applications desktop, mobile et TV acceptent un addon en HTTP simple.
`web.stremio.com` non : il faut un certificat valide. La plupart des hébergeurs en
fournissent un automatiquement.

## L'addon n'a aucune authentification

Toute personne connaissant l'URL peut l'installer et s'en servir. Il n'y a ni jeton,
ni restriction d'origine, ni limite de débit. Sachant que le contenu servi provient
d'un site de streaming illégal, exposer publiquement cette URL n'engage pas la même
responsabilité que de faire tourner l'addon chez soi pour son propre usage.

## Le contournement DNS devient inutile

L'IP codée en dur existe parce que les FAI français bloquent `anime-sama.to`.
Sur un serveur à l'étranger la résolution DNS fonctionne normalement : le
contournement reste inoffensif, mais c'est une IP figée de plus à surveiller.

## Si vous déployez quand même

- ne rien coder en dur : laisser l'hébergeur fournir `PORT` ;
- garder le cache mémoire tel quel — il s'efface à chaque redémarrage, ce qui est
  sans gravité ;
- surveiller `DNS_MAP` dans `scraper.js`, seul point qui casse silencieusement.

