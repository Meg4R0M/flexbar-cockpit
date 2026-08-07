# Flexbar Cockpit

Détourne la **[ENIAC Flexbar](https://eniacbox.com/)** (barre AMOLED tactile à base d'ESP32-S3)
en **cockpit de supervision d'un cluster Proxmox** — piloté par un **démon headless**, **sans
FlexDesigner**, directement depuis un nœud Linux.

![Cockpit](assets/cockpit.png)

*(Données de démonstration ci-dessus. Police [Orbitron](https://fonts.google.com/specimen/Orbitron),
emojis couleur, sparklines CPU/RAM et jauge disque rendus par le démon.)*

---

## Pourquoi

La Flexbar est vendue avec **FlexDesigner** (appli Electron macOS/Windows) : pratique, mais il
faut l'appli lancée en permanence, sur un poste avec interface graphique. Ici on **rétro-conçoit
le protocole série** (USB CDC, non chiffré) pour dessiner sur la barre depuis n'importe quelle
machine Linux — typiquement **un nœud du cluster qu'elle supervise**. La barre devient un écran
d'état permanent, autonome, à côté du rack.

## Deux artefacts

| Dossier | Quoi | Plateforme |
|---|---|---|
| **[`daemon/`](daemon/)** | ⭐ Le **démon headless** : lit l'API Proxmox et dessine le cockpit sur la barre, sans FlexDesigner. | Linux (nœud/LXC) |
| **[`backend/`](backend/)** + [`PLUGIN.md`](PLUGIN.md) | Le **plugin FlexDesigner** d'origine (métriques locales, uptime sites, USB, agenda…). | macOS + FlexDesigner |

Le protocole série rétro-conçu est documenté dans **[`PROTOCOL.md`](PROTOCOL.md)**.

## Le cockpit (démon) — 5 tuiles

1. **🛡 Marque** — logo / wordmark.
2. **🖥 Stats cluster** — nœuds en ligne, VMs actives, CPU %, RAM % (avec **sparklines** d'historique glissant sous CPU/RAM).
3. **🚨 Alertes** — dérivées de l'état du cluster : nœud hors-ligne, stockage ≥ 80 % (orange) / ≥ 90 % (rouge). ✅ **OK** sinon. Rotation si plusieurs.
4. **🐧/🖥 VMs** — rotation sur les invités (LXC/QEMU), **templates exclus**, nom + CPU/RAM % (ou *stoppé*).
5. **💾 Disque** — espace libre **agrégé sur tout le cluster** + jauge d'utilisation.

Le tout : emojis couleur en préfixe, code couleur par seuil (vert/orange/rouge), rendu en PNG.

## Comment ça marche

```
Nœud Proxmox (Linux)
  ├── proxmox.js   → API REST /cluster/resources (token lecture seule PVEAuditor)
  ├── metrics.js   → alertes + agrégat disque (dédup shared vs par-nœud)
  ├── render.js    → @napi-rs/canvas → PNG RGB (colortype 2)  [emoji + Orbitron]
  └── protocol.js  → trame série rétro-conçue  ──USB CDC──►  Flexbar (ESP32-S3, AMOLED)
```

- **Rendu** : [`@napi-rs/canvas`](https://github.com/Brooooooklyn/canvas) (Skia, prébuilts Linux) → PNG **RGB (colortype 2, pas RGBA)**, sinon la barre affiche des rayures.
- **Transport** : USB CDC (`serialport`). La barre se ré-énumère à la fermeture du port ; le démon se reconnecte tout seul.
- **Zéro écriture** sur le cluster : token **PVEAuditor** (lecture seule).

## Démarrage rapide (démon)

Recette complète (LXC privilégié + passthrough USB + service systemd) dans
**[`daemon/DEPLOY.md`](daemon/DEPLOY.md)**. En bref, sur le nœud Linux où la barre est branchée :

```bash
# Node 20 + polices (un LXC minimal n'a AUCUNE police → texte invisible !)
apt-get install -y nodejs fontconfig fonts-liberation fonts-dejavu-core fonts-noto-color-emoji

cd daemon && npm install --omit=dev
cp socbar-daemon.config.example.json socbar-daemon.config.json   # url + token Proxmox
node daemon.js --demo    # valide l'affichage (données fictives)
node daemon.js           # données réelles du cluster
```

> **Polices** : Orbitron (UI) est embarquée dans [`daemon/fonts/`](daemon/fonts/). Les emojis
> couleur exigent `fonts-noto-color-emoji` **+** un enregistrement explicite (Skia ne prend pas
> la police tout seul) — le démon le fait au chargement.

## Matériel

ENIAC Flexbar — ESP32-S3, écran AMOLED tactile, retour haptique, **USB CDC série**
(VID `0x303A` / PID `0x82BF`). Firmware d'usine conservé : on ne fait que parler son protocole.

## Structure

```
daemon/          le démon headless (Proxmox → barre)   ← commence ici
  DEPLOY.md      recette LXC + systemd
  fonts/         Orbitron (OFL)
backend/         le plugin FlexDesigner (macOS)
PLUGIN.md        doc du plugin
PROTOCOL.md      protocole série rétro-conçu
assets/          captures
```

## Polices & licence

- Code sous **[MIT](LICENSE)**.
- Police UI **Orbitron** sous **SIL OFL 1.1** (embarquée, cf. [`daemon/fonts/README.md`](daemon/fonts/README.md)).
- **Zekton** (la police d'ENIAC) est **commerciale** : non incluse. Si tu la possèdes, dépose
  `Zekton.ttf` dans `daemon/fonts/` et change la famille dans `render.js`.

## Avertissement

Projet indépendant, **non affilié à ENIAC**. Le protocole a été rétro-conçu à des fins
d'**interopérabilité**, sur du matériel possédé, à partir d'un flux **non chiffré**. Le firmware
d'usine n'est ni modifié ni redistribué. Fais-en un usage responsable.
