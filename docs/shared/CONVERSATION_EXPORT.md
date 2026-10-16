# Saved conversation export

## Ownership and purpose

Ordinary export produces a selected saved conversation for reading or exchange.
It is separate from [application backup and restore](BACKUP_AND_RESTORE.md): it
does not restore application settings, rebuild every IndexedDB table or migrate
historical archives. It does not fetch absent remote history while formatting.

`packages/archive` owns shared JSON/Markdown/text formatting, inclusive range
resolution, graph/linear integrity semantics, portable source values and ZIP
packaging. Providers supply their verified owner, records, source relationships,
capture evidence, policy and stability checks. ChatGPT contributes turn grouping,
branch/version evidence and technical profiles; VK contributes source history
scan proof, original snapshots and attachment receipts. UI chooses a selection
and invokes these ports rather than reading a provider database itself.

This composition applies the modular ownership and explicit dependency assembly
described by the official [FastAPI larger-applications guide](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
and [dependencies guide](https://fastapi.tiangolo.com/tutorial/dependencies/) to
the existing TypeScript ports. It does not add a Python backend or route layer.

## Evidence before output

Start, end and chain are independent states. The common graph check uses
explicit parent IDs and parent-observed flags; it reports missing parents,
cycles, duplicate identities, disconnected roots and missing heads. An unknown
parent is unknown evidence, not an invented relationship. It retains branches
and first/last anchors. Graph working memory contains relationship facts rather
than a second copy of message content elements.

VK uses observed boundary/count/stable-page evidence. Nonadjacent numeric IDs
are valid and never establish a gap. Its scan proof is scoped current-session
memory; reload or invalidation returns coverage to unknown without deleting
saved data. A complete stable scan does not freeze the remote server forever.

Both providers resolve inclusive ranges from actual saved IDs, including
reversed endpoints and endpoints selected on different Reader pages. Missing
endpoints reject resolution. An explicit missing selected record rejects
export rather than silently shrinking the requested set. A deliberate subset
remains partial even when the saved conversation has verified whole-chain proof.

ChatGPT pins its header revision before initial graph/count inspection and
checks it again after extraction and packaging. It validates scanned count,
ascending source-ID pages and the preferred snapshot's message ID. Owner and
cancellation checks run after asynchronous final inspection and before release
of the prepared file. VK checks owner/peer/snapshot identity, ascending pages,
count and its session archive revision; its outer service re-verifies the
authenticated owner before returning. A concurrent source change rejects output.
These checks do not create a cross-tab database lock or immutable remote snapshot.

Completeness and attachment availability remain distinct. ChatGPT's result
requires verified chain, full saved selection and no missing requested assets;
it still explicitly reports `binaryAttachmentsIncluded: false`. VK's manifest
reports chain evidence, full-saved selection and attachment statuses separately.
Neither label promises a full offline archive when binary bytes were excluded.

## Source, versions and normalized context

ChatGPT's primary canonical model remains version 1 and its five-table Dexie
schema stays 1. `chatgpt-source-context.v1` is a computed sidecar for observed
request/turn/model/status fields, not a storage migration. Full ordinary JSON
preserves preferred original messages, branches and source variants. Original
JSON stays in its familiar shape when lossless; native clone values use the
explicit `archive-clone-v1` marker and value. Source-version maps safely retain
all legal identities, including JavaScript prototype-property names.

VK retains its own fixed version-1 projection and original snapshot. JSON ZIP
chunks always preserve portable originals; Markdown/text is an additional
readable view. Standalone JSON, Markdown and text use the same saved normalized
messages; standalone readable formats include portable originals only when
requested. A readable rendering is not the recovery representation of every
technical source field. Source-native values must use the portable codec before
JSON serialization; binary, Map, undefined and numeric edge cases must not be
silently erased by a renderer.

Both providers now use `ArchiveMessageV1` from
`packages/archive/src/message-model.ts`: `schema: "koba.message"`,
`modelVersion: 1`, with a collision-safe identity containing provider, owner,
conversation and message. It includes author, time in milliseconds, observed
parent/reply/thread links, request/turn/model context, typed or opaque content
elements, per-message terminal evidence and source references. Unknown facts
remain null/unknown; a VK reply is never invented as a chronological parent.
Hierarchy validation is iterative and rejects duplicate/missing/cyclic parents.
The shared format imposes no narrower native identity-length admission limit;
physical provider/query/backup limits remain the owning port's responsibility.

New schema-1 snapshots persist this DTO in the additive `normalized` field;
ChatGPT versions also persist their own DTO. It is the authority for local
Reader presentation, ordinary JSON exports and normalized remote messages.
Earlier provider projections/index rows remain compatibility caches. Raw native
messages/events remain separate lossless companions; no full raw copy is put
inside the DTO. `source.snapshotKey` references the existing provider snapshot,
and `variantIndex` is null for the preferred slot or an index in its version
list. That reference does not itself assert whole-conversation completeness.

`readChatGptArchiveMessage` and `readVkArchiveMessage` check stored identity and
source compatibility before returning the stored authority. A legacy missing
envelope adapts in memory without a write, physical migration or table/index
change. Legacy ChatGPT project context comes from its guarded conversation
header lookup rather than guessed metadata. Malformed or unsupported DTOs
fail explicitly while the underlying raw rows remain intact. Recovery preflight
performs the same optional-envelope checks; legacy absence remains valid.

ChatGPT capture publishes the exact stored DTO after an actual append/variant
commit. A deduplicated observation emits no new commit DTO. Remote-only uses the
same adapter in RAM, and normalized archive resend consumes the stored DTO or
the same guarded legacy adapter. Raw companions require their separate local
and server consent; they are not telemetry. Full ChatGPT JSON records and
versions, and VK source JSON chunks, carry this common normalized model beside
their explicitly selected original representation.

## Chunking and remaining memory bounds

`serializeArchiveExportChunks` emits the same pretty JSON document or readable
format incrementally. Readable records are iterable; JSON does not first create
an unused readable projection. Tokens coalesce around 64 KiB of characters,
without splitting a string token across independent UTF-8 encoders. A single
large string or full readable original can exceed that chunk target; it is not
a record-size or total-file truncation limit. Code-fence sizing scans markers
iteratively instead of spreading an unbounded match list into `Math.max`.

ChatGPT built-ins consume chunks directly. GZIP compresses the byte iterator;
plain output creates bounded Blob pieces, and ZIP reuses Blob entries with
64 KiB CRC reads instead of another full-document Uint8Array. Optional external
format providers can supply chunk serializers; older providers retain their
single-string fallback. VK extracts bounded pages and JSON chunks of 100 or
500 rows and uses the same readable formatter and Blob-backed ZIP writer.
Its optional abort signal is checked during extraction, hashing and packaging.

This is **not end-to-end constant-memory export**. ChatGPT retains selected
source records, turn grouping and variant evidence, and output Blob storage
still scales with file size. Whole-graph checking and explicit selected IDs also
scale with saved/selected count. A fully bounded source plan and user-selected
streaming file sink remain separate work; application backup's staged sink does
not establish ordinary export's behavior.

VK attachment links are saved source references unless a ZIP entry has an
explicitly downloaded provider receipt. Formatting and preview never fetch
external bytes. Export links accept HTTP(S) without credentials or safe archive
relative paths; unsupported URLs remain in the original source, rather than
becoming active links. An explicit attachment action uses saved HTTPS choices,
omits credentials, rejects redirects, validates bounded content and rechecks
owner, peer, cancellation and archive revision after asynchronous work. ZIP
media inclusion is a separate opt-in and accepts only current provider-issued
receipts. Manifests distinguish included, excluded, unavailable and undownloaded
files; reference traversal limits do not imply full attachment coverage.

One Bun 1.4.2 synthetic formatter profile used 6,000 records, producing exactly
31,006,941 UTF-8 bytes in both paths. Whole-document JSON used a 27,934,941-character
string; chunking used 401 chunks with a maximum of 69,840 characters. The measured
run took 89 ms versus 188 ms; sampled end RSS increased by 146 versus 150 MiB.
These are one-process-per-mode samples, not peak-memory, Chromium or throughput
acceptance. They establish bounded serialization units, not a claimed reduction
in total working memory or universal speed improvement.

## Verification boundary

The earlier export corrective pass ran 30 focused synthetic tests across shared formatting,
integrity, media/ZIP and provider export/Reader cases. They cover distant ranges,
branches/variants, native-source round-trip, UTF-8, initial mutation and final
owner-change rejection, prototype-name IDs, cancellation and foreign VK peers.
Shared archive/VK export Biome checks passed. No user archive or real provider
authorization was used. The full combined-source checks, large real archives,
browser quotas/suspension and installed-product acceptance remain separate gates.

The common-model pass adds six focused tests: real schema-1 persistence in both
fake IndexedDB providers; legacy reads without rewrite; preferred/variant/export
authority equality and dedup; lossless unknown native values; preflight rejection
of tampered metadata; identity separation/long IDs; and iterative 20,000-element
hierarchy validation. This local evidence is distinct from combined-source and
installed-browser acceptance.
