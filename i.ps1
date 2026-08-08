# Short bootstrap so the install command fits in a tweet without X truncating
# the URL mid-string. Served via GitHub Pages at graemevip.github.io/token-atlas/i.ps1
# and does nothing but fetch and run the real installer.
irm https://raw.githubusercontent.com/graemevip/token-atlas/main/install.ps1 | iex
