#!/usr/bin/env bash
set -euo pipefail
: "${1:?project root required}"
: "${2:?deploy public key file required}"
root=$(realpath "$1")
[[ "$root" =~ ^/[a-zA-Z0-9_./-]+$ ]]
[[ -f "$root/.env" && -f "$root/.deploy/access.txt" ]]
key=$(awk 'NR==1 {print $1 " " $2}' "$2")
[[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]]
script_dir=$(cd "$(dirname "$0")" && pwd)
sudo install -d -o root -g root -m 755 /usr/local/lib/ai-buddy-cd
for script in common.py dispatcher.py worker.py; do
  sudo install -o root -g root -m 644 "$script_dir/$script" "/usr/local/lib/ai-buddy-cd/$script"
done
install -d -m 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
entry="command=\"/usr/bin/python3 /usr/local/lib/ai-buddy-cd/dispatcher.py --root $root\",restrict $key ai-buddy-cd"
if grep -Fq "$key" "$HOME/.ssh/authorized_keys" && ! grep -Fxq "$entry" "$HOME/.ssh/authorized_keys"; then
  echo "Refusing to reuse a key with different SSH restrictions" >&2
  exit 1
fi
if ! grep -Fxq "$entry" "$HOME/.ssh/authorized_keys"; then
  printf '\n%s\n' "$entry" >> "$HOME/.ssh/authorized_keys"
fi
install -d -m 700 "$root/.deploy/cd"
printf 'Restricted deployment key installed\n'
