#!/bin/sh
# Refuse to commit a scene that carries live RSG tokens.
#
# RemoteServiceGatewayCredentials stores its three tokens in Assets/Scene.scene.
# They are short-lived, but a public repository is forever. Regenerate them
# locally after cloning (Window -> Remote Service Gateway Token) and never let
# them into a commit: run this from a pre-commit hook.
#
#   ln -sf ../../tools/check-no-tokens.sh .git/hooks/pre-commit
#
if git diff --cached --name-only | grep -q '^Assets/Scene.scene$'; then
  if git show :Assets/Scene.scene | grep -E '^\s+(openAIToken|googleToken|snapToken): [^"]' >/dev/null; then
    echo "refusing to commit: Assets/Scene.scene contains RSG tokens." >&2
    echo "blank them first:  sed -i '' -E 's/^(      (openAIToken|googleToken|snapToken): ).*$/\\1\"\"/' Assets/Scene.scene" >&2
    exit 1
  fi
fi
exit 0
