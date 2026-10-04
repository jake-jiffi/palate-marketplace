# Source from a package script. Exit only when that legacy entry has been handled/refused.
palate_route_workflow() {
  local palate_route_code
  if node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/workflow-route.mjs" "$@"; then
    return 0
  else
    palate_route_code=$?
    [ "$palate_route_code" -eq 10 ] && exit 0
    exit "$palate_route_code"
  fi
}
