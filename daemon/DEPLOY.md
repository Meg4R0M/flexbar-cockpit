# Déploiement du démon Flexbar sur un nœud Proxmox (Debian, headless)

Pilote la barre **sans FlexDesigner**, en affichant l'état du cluster + des VMs.
Protocole série rétro-conçu (voir `../PROTOCOL.md`). Rendu = PNG RGB via `@napi-rs/canvas`.

## Recette retenue : LXC privilégié sur PVE1

Barre branchée en USB sur **PVE1**, démon dans un LXC privilégié. Remplace `CTID` (ex. 210)
et `PVE1_IP`.

### a) Sur l'hôte PVE1 — repérer la barre
```bash
lsusb | grep -i 303a ; dmesg | grep -i ttyACM | tail -2   # note /dev/ttyACMx (souvent ttyACM0)
```

### b) Créer le LXC privilégié (Debian) — ou réutiliser le tien
```bash
pveam update && pveam download local debian-12-standard_12.7-1_amd64.tar.zst   # si absent
pct create 210 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname flexbar --cores 1 --memory 512 --rootfs local-lvm:4 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp --unprivileged 0 --features nesting=1 --onboot 1
```

### c) Passthrough USB — sur l'hôte, ajouter à `/etc/pve/lxc/210.conf`
```
lxc.cgroup2.devices.allow: c 166:* rwm
lxc.mount.entry: /dev/ttyACM0 dev/ttyACM0 none bind,optional,create=file
```
puis `pct start 210` (ou `pct reboot 210`).

### d) Transférer le démon (depuis le Mac, SANS node_modules — binaires Linux réinstallés)
```bash
cd ~/work/flexbar-socbar && tar czf /tmp/flexbar-daemon.tgz --exclude node_modules --exclude package-lock.json daemon
scp /tmp/flexbar-daemon.tgz root@PVE1_IP:/tmp/
ssh root@PVE1_IP 'pct push 210 /tmp/flexbar-daemon.tgz /tmp/d.tgz && pct exec 210 -- bash -c "mkdir -p /opt && tar xzf /tmp/d.tgz -C /opt && mv /opt/daemon /opt/flexbar-daemon"'
```

### e) Dans le LXC — Node + deps + config
```bash
pct exec 210 -- bash
# IMPORTANT : polices — un LXC minimal n'en a AUCUNE → canvas rend les fonds sans texte
# (barre « vide »). fonts-liberation = compatibles Arial ; fonts-noto-color-emoji = emojis.
# NB : installer la police emoji NE SUFFIT PAS — Skia ne la prend qu'après un
# GlobalFonts.registerFromPath(...) explicite (render.js le fait au chargement).
apt-get update && apt-get install -y curl ca-certificates fontconfig fonts-liberation fonts-dejavu-core fonts-noto-color-emoji
fc-cache -f
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
cd /opt/flexbar-daemon && npm install --omit=dev
cp socbar-daemon.config.example.json socbar-daemon.config.json   # éditer url/token, serialPath=/dev/ttyACM0
node daemon.js --demo    # la barre doit afficher le cockpit démo
node daemon.js           # données Proxmox réelles
```

### f) Service systemd (dans le LXC)
```bash
cp flexbar-daemon.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now flexbar-daemon && journalctl -u flexbar-daemon -f
```

---

## 1. Pré-requis sur le nœud (ou le LXC)

```bash
# Node 20 (nodesource) si absent
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
```
`serialport`, `@napi-rs/canvas` et `pngjs` embarquent des binaires Linux x64 → **pas besoin
de build-essential** sur un nœud Proxmox x86_64.

## 2. Copier + installer

```bash
mkdir -p /opt/flexbar-daemon && cp -r daemon/* /opt/flexbar-daemon/ && cd /opt/flexbar-daemon
npm install --omit=dev
```

## 3. Configurer l'accès Proxmox

Créer un **token lecture seule** : *Datacenter → Permissions → API Tokens* (rôle `PVEAuditor`).
Puis :
```bash
cp socbar-daemon.config.example.json socbar-daemon.config.json
# éditer : proxmox.url (https://<nœud>:8006), proxmox.token (user@realm!id=uuid)
```

## 4. Passer la barre au système

La Flexbar apparaît en `/dev/ttyACM0` (CDC). Vérifier : `ls -l /dev/serial/by-id/ | grep -i eniac`.

**a) Sur l'hôte Proxmox directement** (le plus simple) : rien à faire de spécial, le démon
tourne en root et ouvre `/dev/ttyACM0`.

**b) Dans un LXC privilégié** (plus propre) — sur l'hôte, ajouter à `/etc/pve/lxc/<CTID>.conf` :
```
lxc.cgroup2.devices.allow: c 166:* rwm
lxc.mount.entry: /dev/ttyACM0 dev/ttyACM0 none bind,optional,create=file
```
puis `pct reboot <CTID>`. (166 = major des périphériques ACM.)

## 5. Tester puis lancer en service

```bash
node daemon.js --demo     # valide l'affichage barre avec des données fictives
node daemon.js            # données réelles Proxmox (config requise)
```
Service systemd :
```bash
cp flexbar-daemon.service /etc/systemd/system/
# adapter User / chemins dans le fichier si besoin
systemctl daemon-reload && systemctl enable --now flexbar-daemon
journalctl -u flexbar-daemon -f
```

## Notes

- **Disposition des keys** : la barre conserve la disposition (les slots `$plugin-N`) réglée
  par FlexDesigner. Garde le profil « SOC Bar » chargé dessus **avant** de la déplacer sur le
  nœud, sinon les slots `overview`/`detail` n'existent pas. (Init de layout autonome = évolution
  future, format connu dans `../PROTOCOL.md`.)
- **Police UI** : Orbitron (OFL) est **embarquée** dans `daemon/fonts/Orbitron.ttf` et voyage
  avec le tar de déploiement ; `render.js` l'enregistre tout seul (repli Arial/Liberation si
  absente). Les **emojis couleur** viennent de `fonts-noto-color-emoji` (système, cf. §e) et
  doivent être enregistrés explicitement — `render.js` le fait au chargement.
- **Reset au (dé)branchement** : couper l'accès série resette l'ESP32 (ré-énumération) ; le
  démon se reconnecte tout seul (`flexbar.js`).
- **Slots** : ajustables dans la config (`slots.overview`, `slots.detail`) selon ta disposition.
- **Sécurité** : `insecureTLS:true` accepte le certificat auto-signé de Proxmox ; le token est
  en lecture seule (`PVEAuditor`), aucun risque d'action sur le cluster.
