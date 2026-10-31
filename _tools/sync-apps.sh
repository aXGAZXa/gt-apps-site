#!/usr/bin/env bash
# Copy each app's pages from its own repo into this site (see README).
# Usage: bash _tools/sync-apps.sh [slug[=git-ref] ...]
#   no arguments: every app in _tools/apps.txt, from each repo's HEAD
#   who-goes-first=site-studio-split: one app, from that branch or commit
# Copies committed files only (git archive), so nothing half-edited is published.
# Never deletes: files here that the app no longer has are listed for you to remove.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
manifest="$root/_tools/apps.txt"

declare -A want=()
for arg in "$@"; do want["${arg%%=*}"]="$( [[ $arg == *=* ]] && echo "${arg#*=}" || echo HEAD )"; done

found=0
while read -r slug repo dir; do
  dir="${dir%$'\r'}"  # tolerate a CRLF manifest
  [[ -z "${slug:-}" || $slug == \#* ]] && continue
  if (( $# )) && [[ -z "${want[$slug]+x}" ]]; then continue; fi
  found=1
  ref="${want[$slug]:-HEAD}"
  src="$root/$repo"
  git -C "$src" rev-parse --verify -q "$ref^{commit}" >/dev/null || { echo "!! $slug: no ref '$ref' in $src" >&2; exit 1; }
  commit="$(git -C "$src" rev-parse --short "$ref")"
  git -C "$src" cat-file -e "$ref:$dir" 2>/dev/null || { echo "!! $slug: '$dir' not found at $ref" >&2; exit 1; }
  depth="$(awk -F/ '{print NF}' <<<"${dir%/}")"
  mkdir -p "$root/$slug"
  git -C "$src" archive "$ref" "$dir" | tar -x -C "$root/$slug" --strip-components="$depth"
  wanted="$(git -C "$src" ls-tree -r --name-only "$ref" -- "$dir" | sed "s|^${dir%/}/||" | sort)"
  stale="$(cd "$root/$slug" && find . -type f | sed 's|^\./||' | sort | comm -23 - <(echo "$wanted") | sed "s|^|$slug/|")"
  echo "== $slug <- $(basename "$src")@$commit:$dir"
  if [[ -n "$stale" ]]; then echo "   no longer in the app (remove by hand, one at a time):"; echo "$stale" | sed 's/^/     /'; fi
done < "$manifest"
(( found )) || { echo "!! nothing matched in $manifest" >&2; exit 1; }
echo "Review with git status and git diff, then commit naming the source commit(s) above."
