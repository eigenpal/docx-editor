#!/usr/bin/env bash
# Installs Playwright's Chromium on a CI runner.
#
# The runner image already has Chromium's shared libraries. `--with-deps` also runs apt,
# which adds only fallback fonts and package upgrades and took up to eight minutes on a
# slow mirror. So the system dependencies install only when a headless launch fails, for
# example after a Playwright update that needs a library the image does not have.
set -euo pipefail

bunx playwright install chromium
if ! node --input-type=module -e "
  const { chromium } = await import('@playwright/test');
  await (await chromium.launch()).close();
"; then
  echo 'Chromium cannot start on this runner. Installing its system dependencies.'
  bunx playwright install-deps chromium
fi
