# Extension 2 acceptance report

Date: 2026-10-04

Tested implementation ref: `dd253b2f60aa029009833d882e9a7762daeae057` (`dev`).
Rolling Dev run: `37207665052`, conclusion `success`.

## Validation levels

### Source / build

- Rolling Dev completed successfully on the exact tested ref, including repository checks, tests and browser-target builds.
- Archive/export regressions relevant to the final asset changes passed 31/31 locally before the green rolling run.
- Observer, features and UI TypeScript checks passed after the final implementation changes.
- ZIP structure was independently checked with `unzip -t`.

### Chromium extension runtime

The rolling extension artifact reported `version_name=0.6.1-gdd253b2f` and was loaded into the persistent Chromium profile for live ChatGPT acceptance.

Observed on real ChatGPT:

- right-edge 44x44 dock toggle remained anchored when expanded;
- the integrated shell expanded inward without changing ChatGPT main geometry;
- Escape closed the shell and returned focus to the toggle;
- resize kept the toggle inside the viewport;
- SPA navigation updated project/chat capture controls without duplicate controls;
- scoped capture controls opened Booster settings without changing the ChatGPT URL or opening the native menu;
- conversation overrides could be created and then removed by returning to inheritance;
- default-deny kept an unselected chat out of the persistent archive while retaining only current-chat preload pages;
- manual collection on a real long chat completed with a fresh two-page cursor chain, `completeAtLastRead=true`, 12 visible messages, 5 internal records and 17 persisted records;
- the read-only archive opened after collection and exposed search only, with no composer/edit/send surface;
- full export produced a `.zip` ready download and custom Markdown produced a `.md` ready download;
- export format/level/category preferences persisted through dialog reopen and storage roundtrip.

The live long-chat client contract was also verified directly: normal ChatGPT scrolling issued a real `messages?before=<cursor>&num_turns=10` continuation request, and Booster stored initial + continuation pages under one read ID with a linked cursor chain ending at `has_previous_page=false`. No private history request was synthesized by Booster.

### Userscript runtimes

Chrome Web Store refuses Tampermonkey installation in this Chromium build, so an official temporary Violentmonkey 2.49.0 MV3 installation was used as a compatible userscript manager. Chromium's required `Allow user scripts` permission was enabled for that temporary manager.

The Chromium extension target was removed from the browser process while userscripts were tested, so the results were not produced by the extension target.

Production userscript:

- exact build metadata included `@booster-build 0.6.1-gdd253b2f`;
- installed and enabled independently;
- mounted the Booster host, 44x44 dock, integrated shell and scoped capture control on real ChatGPT.

Development userscript:

- exact rolling version `0.6.1.18-gdd253b2f` / `@booster-build 0.6.1-gdd253b2f`;
- production userscript was disabled before this run;
- mounted the Booster host, dock, integrated shell and scoped capture control independently on real ChatGPT.

### Error / isolation coverage

The existing real-Chromium synthetic fixture remains the acceptance evidence for destructive or hard-to-induce cases: Stop/navigation late callbacks, background-tab pause/resume, scoped auth/storage errors, pagination gaps and default-deny persistence. The 429 retry policy is covered by unit tests. These cases were not re-induced against the user's live ChatGPT account by intentionally breaking authentication, storage or networking.

## Cleanup

- temporary Violentmonkey installation removed;
- temporary userscript HTTP job cancelled;
- temporary QA directories removed;
- test tabs closed;
- original unpacked ChatGPT Booster `0.6.1` restored;
- original extension settings restored;
- user profile/archive data was not deleted.

## Result

ACCEPTED for the Extension 2 implementation at `dd253b2f60aa029009833d882e9a7762daeae057`, with source/build and runtime evidence kept distinct. Independent review was separately waived by the user in issue #25; this report does not claim that an independent reviewer run occurred.
