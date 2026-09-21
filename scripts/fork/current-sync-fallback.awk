/^- Parent nightly: `/ {
  current = (index($0, "- Parent nightly: `" tag "`") == 1)
}
current && index($0, "fork-side fallback") {
  found = 1
}
END {
  exit found ? 0 : 1
}
