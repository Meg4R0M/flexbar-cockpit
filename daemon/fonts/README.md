# Polices embarquées

- **Orbitron.ttf** — police UI du cockpit (look techno / sci-fi, choisie en remplacement
  de **Zekton** qui est commerciale et ne peut pas être redistribuée). Licence
  **SIL Open Font License 1.1** (redistribuable). Source : Google Fonts —
  https://github.com/google/fonts/tree/main/ofl/orbitron
  Enregistrée automatiquement par `render.js` (`GlobalFonts.registerFromPath`, famille
  `Orbitron`, repli `Arial` / Liberation ; les glyphes accentués absents d'Orbitron
  retombent aussi sur Arial).

Les polices **texte** (Liberation / DejaVu) et **emoji couleur** (Noto Color Emoji) sont
installées au niveau **système** du conteneur (voir `../DEPLOY.md`), pas ici.

> Si tu obtiens le fichier **Zekton** (`.ttf`/`.otf`), dépose-le ici sous `Zekton.ttf` et
> change la famille dans `render.js` (bloc `registerUi`) — rendu identique à ENIAC.
