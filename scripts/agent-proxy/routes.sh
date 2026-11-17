# Пути моста ИИ — общий список для tunnel.sh и bridge.py. Подключается через `.`.
# Все пути выходят в интернет с одного IP (NEO3_AGENT_EXPECTED_IP, 45.86.61.144):
#   mitya   — прямо на сервер Мити, он и есть выход (основной, с 16.11.2026);
#   vps-ts  — на свой VPS через Tailscale, там мост neo3-agent-hysteria → тот же выход;
#   vps-pub — на свой VPS по публичному адресу (если Tailscale лёг).
# Переехал VPS — поменять адрес в routes.local рядом (его установщик не трогает):
#   NEO3_BRIDGE_VPS_PUBLIC=1.2.3.4
NEO3_BRIDGE_MITYA_SSH="${NEO3_BRIDGE_MITYA_SSH:-mitya-vps}"
NEO3_BRIDGE_VPS_TAILSCALE="${NEO3_BRIDGE_VPS_TAILSCALE:-100.75.69.57}"
NEO3_BRIDGE_VPS_PUBLIC="${NEO3_BRIDGE_VPS_PUBLIC:-92.118.233.67}"
NEO3_BRIDGE_VPS_KEY="${NEO3_BRIDGE_VPS_KEY:-$HOME/.ssh/id_brand_vps}"
# Ключ хоста VPS переехал вместе с системой — ssh сверяет его под старым именем.
NEO3_BRIDGE_VPS_HOSTKEY="${NEO3_BRIDGE_VPS_HOSTKEY:-185.166.154.209}"
_routes_dir="$(cd "$(dirname "${NEO3_BRIDGE_ROUTES_FILE:-$0}")" 2>/dev/null && pwd)"
[ -n "$_routes_dir" ] && [ -f "$_routes_dir/routes.local" ] && . "$_routes_dir/routes.local"

# Порядок путей для режима: auto | mitya | vps.
route_order() {
  case "$1" in
    mitya) echo "mitya" ;;
    vps) echo "vps-ts vps-pub" ;;
    *) echo "mitya vps-ts vps-pub" ;;
  esac
}

# Человеческое имя пути.
route_title() {
  case "$1" in
    mitya) echo "сервер Мити" ;;
    vps-ts) echo "мой VPS (Tailscale)" ;;
    vps-pub) echo "мой VPS (публичный адрес)" ;;
    none) echo "нет пути" ;;
    *) echo "$1" ;;
  esac
}

# Аргументы ssh до адресата для пути (после общих -o). Печатает по одному в строке.
route_ssh_target() {
  case "$1" in
    mitya) printf '%s\n' "$NEO3_BRIDGE_MITYA_SSH" ;;
    vps-ts) printf '%s\n' -i "$NEO3_BRIDGE_VPS_KEY" -o "HostKeyAlias=$NEO3_BRIDGE_VPS_HOSTKEY" "root@$NEO3_BRIDGE_VPS_TAILSCALE" ;;
    vps-pub) printf '%s\n' -i "$NEO3_BRIDGE_VPS_KEY" -o "HostKeyAlias=$NEO3_BRIDGE_VPS_HOSTKEY" "root@$NEO3_BRIDGE_VPS_PUBLIC" ;;
    *) return 1 ;;
  esac
}
