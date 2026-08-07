# SOC Bar — plugin Flexbar (FlexDesigner v1)

> **Variante plugin (macOS + FlexDesigner).** C'est l'artefact d'origine du projet, qui tourne
> *dans* FlexDesigner. Pour piloter la barre **sans FlexDesigner** (démon headless sur un nœud
> Proxmox), voir [`daemon/`](daemon/) et le [README principal](README.md).

Détourne la ENIAC Flexbar en **bandeau d'état SOC/pentest** : métriques live + un bouton
tactile à retour haptique. On garde le firmware d'usine ; on remplace juste l'usage logiciel
par le nôtre via un plugin FlexDesigner.

## Ce que ça affiche

- **CPU / RAM / LOAD / DISK** — métriques locales, chacune avec un **graphe d'historique
  glissant en fond** et un code couleur par seuil. (RAM = calcul type Moniteur d'activité ;
  DISK = volume de données, cf. plus bas.)
- **Flux SOC** (optionnel) — tuiles supplémentaires alimentées par HTTP (compte d'items :
  observables CTI, cases TheHive, alertes…), définies dans `socbar.config.json`.
- **Bouton SOC Action** — un tap déclenche un refresh + une **vibration** de confirmation.

Code couleur par tuile : vert (ok) / orange (warn) / rouge (crit), seuils configurables.

## Pré-requis

- FlexDesigner installé **et lancé** (le plugin s'y branche en WebSocket).
- Node ≥ 20 (`nvm use 20`).
- `flexcli` (`@eniac/flexcli`) installé globalement.

## Installation

```bash
nvm use 20
cd ~/work/flexbar-socbar
npm install
npm run validate        # vérifie le manifest
npm run link            # branche le plugin dans FlexDesigner (le démarre)
```

Puis dans **FlexDesigner** : glisse la key **SOC Bar → SOC Dashboard** (et éventuellement
**SOC Action**) sur ton profil. Le bandeau se met à jour toutes les 1,5 s.

Logs : `npm run logs`. Après un changement de code : `npm run restart`.

## Configurer les flux SOC

Édite `socbar.config.json`. Chaque flux :

| champ | rôle |
|-------|------|
| `label` | libellé court de la tuile |
| `url` | endpoint JSON à interroger |
| `token` / `headerName` | en-tête d'auth (`Authorization` par défaut) |
| `countPath` | chemin `a.b.c` vers le nombre/tableau à compter |
| `warn` / `crit` | seuils de couleur |
| `enabled` | `false` pour ignorer le flux |

`countPath` pointant sur un tableau → on prend sa longueur ; sinon on lit le nombre, ou
`.count` / `.total` par défaut. Un flux injoignable affiche `×` en rouge (jamais de crash).

## Monitoring uptime (key SOC Uptime)

Une tuile par site surveillé, avec un **emoji identifiant à gauche** (`emoji` dans la config —
p.ex. ⚔️🛡️ pour Cyber, 🦊🎓 pour Academie) et l'**historique du ping en graphe de fond** :
**temps de réponse en ms** si up (vert), **orange** si lent (`> warnMs`) ou statut 4xx,
**rouge `DOWN`/`T/O`** si injoignable ou timeout. Re-check auto toutes les 20 s ; **un tap =
re-check immédiat + vibration**.

Sites définis dans `socbar.config.json → monitors[]` (repli sur les deux sites Humanix si
absent) :

```json
"monitors": [
  { "enabled": true, "label": "CYBER",    "url": "https://humanix-cybersecurity.fr", "warnMs": 800, "timeoutMs": 5000 },
  { "enabled": true, "label": "ACADEMIE", "url": "https://humanix-academie.fr",       "warnMs": 800, "timeoutMs": 5000 }
]
```

`warnMs` = seuil orange, `timeoutMs` = au-delà = `T/O`. La mesure = temps jusqu'aux en-têtes
de réponse (redirections suivies). Ajoute autant de sites que voulu.

## Périphériques USB (key SOC USB)

Compte des périphériques USB connectés + **nom du périphérique sélectionné** (`i/N`).
**Un tap fait défiler** vers le périphérique suivant (avec vibration, retour au début en fin
de liste). Au **branchement / débranchement** : vibration + message nommant le device
(`USB+ Proxmark3`, `USB- M5Cardputer`).

Sur macOS l'inventaire vient de `ioreg` (nom = « USB Product Name », ex. « OBSBOT Tiny 3
Lite »), hubs et contrôleurs filtrés, scan toutes les 8 s. `system_profiler SPUSBDataType`
n'est **pas** utilisé : il renvoie un set vide sur certaines machines Apple Silicon.

## Prochain évènement (key SOC Agenda)

📅 heure + titre + délai relatif du prochain évènement du calendrier Apple (« dans 25 min »,
« demain »), l'heure passant en **orange** quand c'est imminent (< 15 min). Re-check toutes
les 60 s ; un **tap** force le rafraîchissement.

Lecture via **EventKit** exposé par `osascript -l JavaScript` (`backend/agenda.jxa.js`) :
osascript étant notarié Apple, il obtient l'accès Calendrier là où un binaire signé ad-hoc
échoue silencieusement, et la requête EventKit est quasi instantanée (~0,3 s). La **première**
exécution déclenche l'autorisation macOS (Réglages > Confidentialité > Calendriers) — à
accorder une fois. Tant que l'accès manque, la tuile affiche « Autoriser Calendrier ».

## Architecture

```
FlexDesigner (possède le lien USB-CDC + dessine l'AMOLED)
   ⇅ WebSocket
plugin.cjs  →  collectors.cjs (data)  +  render.cjs (@napi-rs/canvas → PNG)
```

## Le démon headless (Path B — fait ✅)

Le protocole série FlexDesigner↔barre a été rétro-conçu (voir [`PROTOCOL.md`](PROTOCOL.md)) et
un **démon autonome** pilote désormais la barre **sans FlexDesigner**, en affichant l'état d'un
cluster Proxmox. Voir [`daemon/`](daemon/) et [`daemon/DEPLOY.md`](daemon/DEPLOY.md).
