# Module NixOS pour la console Flexbar « nœud d'attaque ».
#
# Importe-le dans ta configuration et active :
#
#   imports = [ ./flexbar-cockpit/nixos/flexbar-cockpit.nix ];
#   services.flexbar-cockpit = {
#     enable = true;
#     src = ./flexbar-cockpit/daemon;                 # le dossier daemon/ du dépôt
#     configFile = "/etc/flexbar/socbar-daemon.config.json";
#     device = "/dev/ttyACM0";
#   };
#
# Les modules natifs prébuild (@napi-rs/canvas / serialport) tournent via nix-ld ; les
# dépendances npm sont installées au premier démarrage dans le StateDirectory (impur mais
# simple). Pour du 100 % pur, remplace le preStart par un pkgs.buildNpmPackage (calcule
# npmDepsHash sur le nœud) — l'ExecStart reste identique.

{ config, lib, pkgs, ... }:

let
  cfg = config.services.flexbar-cockpit;
  configPath = if cfg.settings != null then "/etc/flexbar/socbar-daemon.config.json" else cfg.configFile;
in {
  options.services.flexbar-cockpit = {
    enable = lib.mkEnableOption "Console Flexbar (nœud d'attaque)";
    src = lib.mkOption {
      type = lib.types.either lib.types.path lib.types.str;
      description = "Chemin du dossier daemon/ (contient daemon-atk.js, package.json, fonts/). Accepte un chemin de store, ex. \"\${inputs.flexbar-cockpit}/daemon\".";
    };
    configFile = lib.mkOption {
      type = lib.types.str;
      default = "/etc/flexbar/socbar-daemon.config.json";
      description = "Chemin du fichier de config (voir socbar-daemon.config.atk.example.json). Utilisé si `settings` est null (ex. secret rendu par sops/agenix).";
    };
    settings = lib.mkOption {
      type = lib.types.nullOr (lib.types.attrsOf lib.types.anything);
      default = null;
      description = "Config écrite DÉCLARATIVEMENT en JSON dans /etc. Prime sur configFile. NE PAS y mettre de secret (store Nix lisible) — pour scope.apiKey, passer par sops/agenix + configFile.";
    };
    device = lib.mkOption {
      type = lib.types.str;
      default = "/dev/ttyACM0";
      description = "Port série de la Flexbar.";
    };
    nodejs = lib.mkOption {
      type = lib.types.package;
      default = pkgs.nodejs_22;
      description = "Paquet Node.js utilisé (nodejs_20 est EOL/insecure sur nixpkgs 26.05 ; le démon tourne sur Node ≥ 18).";
    };
  };

  config = lib.mkIf cfg.enable {
    # Polices requises par le rendu : Liberation (compatibles Arial) + emoji couleur.
    # (Orbitron est embarquée dans daemon/fonts/ et enregistrée par render.js.)
    fonts.packages = with pkgs; [ liberation_ttf noto-fonts-color-emoji ];
    fonts.fontconfig.enable = lib.mkDefault true;

    # Config déclarative (si fournie) écrite en JSON dans /etc (non secret).
    environment.etc = lib.mkIf (cfg.settings != null) {
      "flexbar/socbar-daemon.config.json".text = builtins.toJSON cfg.settings;
    };

    # nix-ld : permet d'exécuter les .node prébuild (générique Linux) sur NixOS.
    programs.nix-ld.enable = lib.mkDefault true;
    programs.nix-ld.libraries = with pkgs; [
      stdenv.cc.cc.lib  # libstdc++ / libgcc_s
      fontconfig.lib
      freetype
      zlib
    ];

    systemd.services.flexbar-cockpit = {
      description = "Console Flexbar (nœud d'attaque)";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];
      # bash = `sh` requis par les scripts d'install npm (serialport). Le reste =
      # outils lus par les collecteurs : iproute2/wireguard (egress), docker pour
      # le compte C2 dans l'Exegol de la mission. scope se lit dans un fichier
      # local (/srv/hx/missions/active.json), aucun binaire requis.
      path = with pkgs; [ cfg.nodejs bash iproute2 wireguard-tools nftables coreutils gnugrep docker ];
      environment = {
        SOCBAR_CONFIG = configPath;
        # fontconfig système (pour que canvas trouve Liberation + Noto emoji)
        FONTCONFIG_FILE = "/etc/fonts/fonts.conf";
      };
      serviceConfig = {
        Type = "simple";
        # Service root : nft/wg/ss et l'accès série le nécessitent sur un nœud d'attaque.
        User = "root";
        StateDirectory = "flexbar-cockpit";
        WorkingDirectory = "/var/lib/flexbar-cockpit";
        Restart = "always";
        RestartSec = 5;
        # Copie la source (lecture seule dans le store) vers le state dir, puis installe
        # les deps si le marqueur a changé.
        ExecStartPre = pkgs.writeShellScript "flexbar-cockpit-setup" ''
          set -eu
          dst=/var/lib/flexbar-cockpit
          ${pkgs.coreutils}/bin/cp -rT --no-preserve=mode ${cfg.src} "$dst"
          cd "$dst"
          if [ ! -d node_modules ] || [ package.json -nt node_modules/.stamp ]; then
            ${cfg.nodejs}/bin/npm install --omit=dev --no-audit --no-fund
            : > node_modules/.stamp
          fi
        '';
        ExecStart = "${cfg.nodejs}/bin/node /var/lib/flexbar-cockpit/daemon-atk.js";
        # Accès au port série de la barre.
        DeviceAllow = [ "${cfg.device} rw" ];
      };
    };
  };
}
