#!/usr/bin/env bash
# brings the server to origin's main and restarts it when the change needs it.
# run as root by burrow-update.timer; git itself runs as the server's user.
set -euo pipefail

dir=${BURROW_DIR:-/home/aj/ajc-private-server}
user=${BURROW_USER:-aj}
service=${BURROW_SERVICE:-burrow}
branch=${BURROW_BRANCH:-main}

git() { runuser -u "$user" -- git -C "$dir" "$@"; }

git fetch --quiet origin "$branch"
old=$(git rev-parse HEAD)
new=$(git rev-parse "origin/$branch")
[ "$old" != "$new" ] || exit 0

# only a fast-forward: a server that was edited by hand is left for a person
git merge --quiet --ff-only "origin/$branch"

# a file that does not parse would take the game down on restart
for file in $(git diff --name-only "$old" "$new" -- '*.js'); do
  if [ -f "$dir/$file" ] && ! runuser -u "$user" -- node --check "$dir/$file"; then
    git reset --quiet --hard "$old"
    echo "update to $new refused: $file does not parse; staying on $old" >&2
    exit 1
  fi
done

# public/ is read from disk on every request; the rest is loaded once, at start.
# the list is taken whole first: piped straight into grep -q, a long one (a
# push of many files) had git cut off mid-write ("Broken pipe"), which
# pipefail read as nothing to restart for.
changed=$(git diff --name-only "$old" "$new")
if grep -qvE '^(public/|client-updates/|test/|tools/|deploy/|[^/]+\.md$|\.gitignore$)' <<<"$changed"; then
  systemctl restart "$service"
  echo "updated $old -> $new, restarted $service"
else
  echo "updated $old -> $new, no restart needed"
fi
