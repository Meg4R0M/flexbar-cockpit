# Protocole série Flexbar (rétro-conçu pour le port Linux)

Décodé par capture du trafic FlexDesigner↔barre (shim serialport). But : piloter la barre
depuis un démon Linux headless, sans FlexDesigner. **Protocole non chiffré, en clair.**

## Transport
USB CDC serial (lib `serialport`). macOS : `/dev/tty.usbmodemXXXX`. Linux : `/dev/ttyACM0`.
(`@serialport/bindings-cpp` embarque déjà les binaires Linux glibc/musl x64+arm64.)

## Trame externe
```
MAGIC (32 o constants) : 5a0000a5 a9c4d1f2 2c8f3e6d 10f7bdac 43de9c5a 2fc3b7e1 d2b5e834 8c7a2d9f
en-tête (8 × uint32 LE):
  [0] 0x1000 (4096)  constant (MTU/chunk)
  [1] 1              constant
  [2] 1              constant
  [3] 0
  [4] payloadLen     longueur du payload
  [5] payloadLen     (identique -> pas de compression)
  [6] 0
  [7] type           8 = message JSON/données, 0 = petit contrôle binaire
payload (payloadLen octets)
```
Gros payloads découpés en écritures de 4095 o sur le fil (à ré-assembler).

## Payload type=8 (interne)
```
aafcfdfe          magic interne (4 o)
uint32 LE jsonLen longueur du JSON
uint32 LE binLen  longueur du binaire qui suit le JSON (0 si JSON pur)
uint32 LE total   16 + jsonLen + binLen
<JSON> (jsonLen)
<binaire> (binLen)   ex : PNG brut pour un dessin
```

## Commande de DESSIN (hôte→barre)
```
JSON : {"event":"$plugin-N","data":{"$cmd":"draw"}}
binaire : PNG brut (\x89PNG…IEND) aux dimensions de la key
```
`N` = index de la key plugin. Dimensions observées = largeurs de nos keys × 60 :
600×60 dashboard, 500×60 usb, 460×60 agenda, 400×60 uptime, 120×60 action.
→ **dessin PER-KEY, image = PNG** (ce que `@napi-rs/canvas` produit déjà).

## Événements (barre→hôte, type=8 JSON)
- **Tactile** : `{"$cid":"com.eniac.plugin","evt":"click","key":{…objet key complet…}}`
- **Handshake / device-state** (à la connexion) : `{… "serialNumber":"XXXXXXXXXXXX",
  "hw_ver":"v1.4.0","fw_ver":"2.2.3","config":{brightness,vibrate,deviceName…},
  "fixedBar":{left:{children:[…keys…]}, right:{…}} …}`  ← contient la disposition des keys
- Changement de page : `{"$cid":"com.eniac.sys.new_page","data":[…keys…]}`
- `{"event":"$connected","data":null}`

## Reste à cadrer pour le démon (dans la capture, à formaliser)
- **Séquence d'init / layout** : comment déclarer la disposition des keys à la barre quand on
  n'est pas FlexDesigner (le handshake `fixedBar` + `new_page` montrent le format ; il faut
  reproduire l'ordre d'échange à la connexion).
- **Contrôles binaires type=0** (≤189 o, ACK/heartbeat ?) et la commande **vibration**
  (`haptic`/`hapic.click`) à repérer dans un `$cmd`.
- **CRC/ACK** éventuel (chaînes "ACK timeout" vues dans le firmware ; à confirmer si requis).

## Fichiers de référence
Les captures brutes et décodeurs jetables (artefacts de rétro-ingénierie) ne sont **pas
inclus** dans le dépôt. Le format ci-dessus suffit à réimplémenter le codec : voir
`daemon/protocol.js` (encode/decode) et `daemon/png.js` (PNG RGB colortype 2).
