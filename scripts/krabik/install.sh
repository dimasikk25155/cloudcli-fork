#!/bin/sh
# Install support files only; switching the running engine is a separate command.
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
install -d -m 755 /usr/local/lib/neo3-krabik
if [ -f /usr/local/bin/krabik-ensure ] && [ ! -f /usr/local/lib/neo3-krabik/legacy-ensure ]; then
  cp /usr/local/bin/krabik-ensure /usr/local/lib/neo3-krabik/legacy-ensure
fi
install -m 755 "$source_dir/runtime.py" /usr/local/lib/neo3-krabik/runtime.py
for action in ensure transcript; do
  printf '#!/bin/sh\nexec /usr/local/lib/neo3-krabik/runtime.py %s "$@"\n' "$action" > "/usr/local/bin/krabik-$action"
  chmod 755 "/usr/local/bin/krabik-$action"
done
if [ ! -e /home/agents/krabik/AGENTS.md ]; then
  install -o agents -g agents -m 644 "$source_dir/AGENTS.md" /home/agents/krabik/AGENTS.md
fi
printf '%s\n' 'Installed; provider and running session unchanged.'
