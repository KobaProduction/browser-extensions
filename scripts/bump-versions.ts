/** Retired manual writer. CI owns published versions in dev:release-versions.json. */
if (import.meta.main)
  throw Error('Manual version bumps are disabled. Push source; CI assigns the version.')
