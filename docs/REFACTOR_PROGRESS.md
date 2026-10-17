# Рефакторинг: объём цели и текущее подтверждение

## Release candidate — 2026-10-16

Владелец явно разрешил собрать и отправить всю накопленную работу для DEV/PROD,
Tampermonkey и Chromium MV3. Кандидаты: ChatGPT Booster 2.0.20, All-in-one
0.5.22, VK Booster 1.0.0 (закреплённая исходная версия). Публикация по-прежнему
проходит через независимое review/merge и CI на точном `main` commit; разрешение
выпуска не является доказательством установленного браузера или обновления
исторического VK 2.3.x до 1.0.0.

До подготовки этого кандидата прошли 708 тестов, строгие TypeScript/Vue проверки,
Biome и проверки сборок. В живом тестовом ChatGPT все 11 полученных сообщений
найдены в canonical DB; ручное подключение IAB сбрасывается после обновления.
RAM-first Reader также проверен при заблокированных DB catalog/chunk запросах.
Финальные проверки версии и артефактов выполняются повторно перед push;
локальные screenshots, live bundles и отладочные данные исключены из Git.

Источник — последняя цель владельца и замечания UI от 14 октября 2026 года.
Этот файл фиксирует рабочую итерацию, не заменяя профильные контракты.
Прежний запрет прогонов отменён последним указанием: локальные синтетические
проверки, отдельный браузерный профиль и loopback WebSocket теперь разрешены.
Source-review не доказывает работоспособность установленного расширения.

## Исправления после замечаний владельца — 2026-10-16

RAM-first контур восстановлен как экспортируемый `ConversationObservationGateway`:
исходные события/варианты сохраняются до проекции, с Map-индексами чатов и UUID.
Изменение политики повторно распределяет накопленное без повторного запуска
native lifecycle и триггеров. `ConversationArchiveWorkspace` показывает RAM при
выключенном сохранении, принимает DB-порции до 160 и проверяет отсутствующих
родителей. Чтение не увеличивает «Получено» и не запускает запись. Счётчики
«Получено сообщений»/«Сохранено сообщений» подписаны на изменение количества,
а не на каждый токен. Показаны загрузка/ошибка и явный повтор; непрерывные события
не откладывают обновление Reader на весь поток. Проверены 3000 UUID в 19 порциях,
off → on replay, source quarantine, remote queue admission dedup, owner fencing
и смена incarnation базы. Изолированный браузерный стенд подтвердил RAM-view,
включение записи, догрузку родителя и исчезновение loader; это не installed
ChatGPT acceptance. Семантика: [live contract](chatgpt-booster/LIVE_ARCHIVE_CONTRACT.md).

Позднее уточнение быстрого меню: статус стал двумя короткими строками вместо
повторяющихся уровней. Пустая очередь внешней доставки скрыта, активность и
ошибки сохранены. В IAB высота legend уменьшилась 113 → 51 px без overflow.
Последний source suite: 694 PASS / 0 FAIL, 4186 assertions; strict TypeScript/Vue,
Biome, DEV 46 всех продуктов и output validation прошли. Installed acceptance
по-прежнему не подменяется вручную подключённой IAB сборкой.
Следующее уплотнение меню оставляет один счётчик сообщений в архиве:
центральный блок 98 → 28 px; четыре registry Button size sm имеют высоту
32 px, одинаковый отступ 12 px и не обрезают подписи. Повторные gates прошли,
ручная IAB сборка обновлена без перезагрузки страницы.

- Удалено новое меню россыпи вызовов. Переиспользованы native строки и общий
  registry Dialog. Точное уникальное source название размещает представление;
  сами вызовы и результаты связываются только source ID/parent ID. Поддержаны
  фактически наблюдаемые `content.thoughts[].summary`, а не только reasoning_title.
- Нижний лоадер использует один существующий настраиваемый ticker: общая
  длительность, текущее действие, возраст последнего сетевого изменения,
  ожидание новой сводки и предыдущий интервал. Replay/старый run/chunks той
  же сводки не изображают новую сводку. Даты берутся из source createTime.
- Последнее canonical окно и bounded окна по показанным source ID восстанавливают
  метаданные после подключения. Это чтение owner-scoped originals, без запроса
  удалённой истории, миграции v3/v4, записи архива или создания lifecycle.
- Исправлены type-only импорт Button в Reader и закрытие shared popover тем же
  кликом. Открытие архива из проекта передаёт project scope в существующий Reader.
  Начало/конец видны раздельно; фрагменты при отсутствующих связях не называются
  ветками. В текущем проверенном архиве конец подтверждён, начало неизвестно.
- По следующему уточнению абсолютные даты/время скрыты внутрь информации по
  часам. Часы у user/assistant сообщений размещаются в одном native ряду
  с остальными действиями; снаружи остаётся только длительность/интервал.
- Strict TypeScript/Vue, Biome, полный source suite: **693 PASS / 0 FAIL**,
  4185 assertions, 127 файлов. Source gates не подменяют installed acceptance.
  DEV build ID остаётся 46; версии/physical schema не повышались.
  После browser-проверки plain-text/JSON-parts аргументы вызовов получили
  source fallback: targeted suite 59 PASS / 0 FAIL и повторный strict TypeScript.
  Наблюдаемая сводка получает дату и отдельный source ID; появились четыре
  инспектора текущего раскрытого хода, открытый inspector показал совпадающий ID. Это не доказывает
  наличие всех исходных результатов в неполном архиве.

Проверка в IAB использует вручную подключённый настоящий userscript и явно
отдельный local debug GM backend. Реальные accounts/catalog proofs сохраняют
owner fencing. Native history ранее вернула 429; повторные запросы прекращены.
Полнота всей удалённой истории и установка MV3/userscript manager этим не доказаны.

## Повторная проверка подключённого runtime — 2026-10-15–16

Последующие screenshots владельца воспроизведены в авторизованном IAB только
на отдельном синтетическом чате. Реальный собранный userscript подключён
вручную; это отдельная проверка от UI Lab, установки MV3 и userscript manager.

- Исправлен конфликт bundled Dexie с другой версией native host: сборка
  использует один собственный public core entry, не меняя singleton сайта.
- Декодер поддерживает подтверждённый native delta protocol, включая quoted
  JSON-заголовок `"v1"`, наследуемые envelope fields и явные patch operations.
  Неизвестные версии и неподтверждённые terminal events не угадываются.
- Source adapter v4 принимает только подтверждённые новые streaming metadata;
  опубликованные v1–v3 и физическая Dexie schema 1 сохранены. Независимый
  reviewer повторил 37 профильных тестов / 260 assertions.
- Проверенные cached native references и scope подключены явно к тестовому
  чату. Отправка и остановка получили native/network ACK; stream завершился
  без ошибки декодирования. Итоговый snapshot архива содержит 26 source records,
  включая 14 assistant records. Содержимое сохранённых final messages совпало
  с настоящим native history read этого же чата.
- Message-trigger запустил один настоящий AudioContext в состоянии running;
  после мелодии он закрылся. Basic sounds были временно выключены, поэтому
  результат не подменён звуком отправки/завершения. Временное правило удалено,
  обычные звуковые настройки восстановлены.
- Master OFF во время настоящего запроса удалил все provider injections,
  request-status и agent-activity; native Stop приложения ещё был виден.
  Команды выключенного runtime отклонены. После ON прежняя owner/binding
  authority не восстановилась; для продолжения использованы свежие proofs.
- Исправленный dock и collapse bar имеют одинаковую ширину 294px в live UI.
  Capture form сохраняет правило с persistence ACK, имеет собственные отступы
  и отдельные ошибки чтения/записи. Дополнительные Lab проверки:
  17/17 keyboard/AX/language/dock и 4/4 capture geometry replay.
- Телеметрия доступна: локальный технический журнал сохраняется между заменами
  runtime. В raw attachment без manager использован явно отдельный локальный
  debug storage adapter; shipping browser-origin fallback не добавлен.
  Внешняя отправка выключена, содержимое чатов и identities в журнал не входят.
- Через реальный wizard скачан Markdown тестового чата (2438 bytes); файл
  содержит проверочные ответы. Полнота удалённой истории из этого не следует.
  Исправлено отображение отсутствующих optional counters и неизвестной полноты,
  которые прежде ошибочно выглядели как ноль и пропуск. Реактивная подпись
  registry SelectValue использует тот же source target, что и CopyIdentity.

Итог source checkpoint: **658 PASS / 0 FAIL**, 3963 assertions, 124 файла;
strict TypeScript/Vue, Biome и output/catalog validation прошли. Оба DEV 46
delivery targets всех трёх продуктов пересобраны после последней коррекции
отображения; output validation повторён. Независимый reviewer повторил
7 UI-тестов / 31 assertion и Biome. Последний userscript подключён в IAB,
owner proof обновлён, сохранённые 26 записей доступны. При изменившемся
текущем маршруте guard отклонил привязку команд к прежнему тестовому чату;
финальные исправления сводки/подписи подтверждены SFC-тестами и review,
полный live export/audio replay относится к сборке непосредственно перед ними.
Временные Debugger breakpoints, probes, AudioContext wrapper и глобальные
debug references удалены; локальный Lab server остановлен.

Evidence остаётся в ignored `apps/ui-lab/.local/live-chatgpt/`; синтетические
тексты и пользовательские runtime identities в Git не записаны. Commit,
push, публикация и изменение схемы данных не выполнялись.

Ограничение: явные native bindings в этой отладке не являются автоматической
discovery в shipping composition. Continue/new-chat и native history pagination
остаются unsupported без отдельного проверенного HAL. Raw IAB attachment
исчезает после полной перезагрузки; это не installed MV3/Tampermonkey acceptance.

## Исправления по аудиту — 2026-10-15

Владелец разрешил исправления по трём направлениям и отдельно уточнил строгую
границу реакций ChatGPT. Эта запись описывает текущую локальную итерацию;
числа и открытые gates более ранних checkpoint ниже относятся к прежним snapshot.

- Platform: DOM/event/session/geometry Shell имеют отдельную delivery identity;
  существующие namespaces архива/настроек сохранены. FeatureRuntime сохраняет
  ресурсы неудавшегося cleanup для повтора и не изображает неудавшийся start
  успешным. Build impact учитывает реальных consumers runtime/background;
  application composition использует публичные delivery services/subpaths.
- Archive: application backup пишет sectioned manifest v2 и читает v1/v2.
  Большая логическая строка передаётся последовательными lossless-фрагментами
  с SHA256, bounded staging и контролем фактических UTF-8 bytes. Admission
  каждого canonical row проверяет portable budget до публикации; превышение
  явно отклоняется без удаления прежних originals. Пример с 32 stream-prefix
  originals и строкой 9.24 MB проходит round-trip. VK сравнивает исходные
  значения независимо от порядка object keys; изменения данных не скрываются.
- Reader: bounded LRU chronology plans и fingerprint cache устраняют повторные
  полные сканирования на соседних переходах. Revision вместе с incarnation
  защищает от stale cache при peer restore/delete/recreate. Optional UUID
  хранится в существующем payload; физическая Dexie schema 1 не изменена.
  Fresh explicit native project reassociation сохраняет provenance и originals.
- UI: QuickMenu использует общий registry Dialog и его focus/dismiss lifecycle;
  dock не наследует геометрию входной/выходной анимации. Switch/Slider имеют
  доступные имена. Формы показывают ошибки и подтверждают сохранение только
  после persistence ACK. Общий язык применяется к Shell/provider/widget captions
  и browser popup, с сохранением пользовательских названий и содержимого.
- ChatGPT: бизнес-факты, таймер и автоматизация получают подтверждения из
  fetch/XHR/SSE/WS либо явно подключённого native method. DOM/route polling,
  synthetic editor input, native clicks и scroll для загрузки удалены из этой
  authority. Legacy DOM rules сохранены выключенными. Source request/run/owner
  correlation не позволяет позднему или чужому terminal packet завершить run.
  Native command проверяет target до эффекта; History Loader повторяет failed
  или no-progress native read после backoff. Archive context и injected scope
  actions используют подтверждённые source IDs, без сопоставления DOM-названий.

Независимый read-only reviewer воспроизвёл и перепроверил исправления portable
row admission, fragment UTF-8 accounting, same-revision cache, native target,
history retry и двух DOM/source scope ошибок. Подтверждённых незакрытых findings
в этих проверенных участках не осталось; это не утверждение о полноте всего DDD
target или о совместимости с текущим установленным сайтом.

Общий итог после fan-in: **608 PASS / 0 FAIL**, 3664 assertions, 114 файлов;
root TypeScript/Vue, Lab typecheck, strict Biome, catalog/output validation и
сборки VK/ChatGPT/All-in-one для обоих delivery targets прошли. Biome сообщает
30 informational suggestions без warning/error. UI Lab build проходит с
предупреждением Vite о размере chunks.

Синтетическая Chromium-проверка на static loopback preview:

| Проверка | Результат и evidence в `apps/ui-lab/.local/review-fixes/` |
| --- | --- |
| Extended matrix после последнего fan-in и Lab rebuild | **288/288 PASS**, `browser-extended-accepted/matrix-extended.json`; десять screenshot replay имеют правильные размеры и ноль geometry warnings |
| Trusted keyboard, accessibility tree, English | **6/6 PASS**, `browser-accessibility-accepted/accessibility-ui.json`; Enter/Tab/Escape, focus return, outside pointer, module control names, backups/telemetry/menu captions |
| Формы автоматизации, архив/selection/branches/loading, Lab explorer после fan-in | **PASS**, `browser-targeted-accepted/`; explorer отдельно проверил 20 сценариев |
| History rail и export preparation | **19 PASS**, `browser-history-final/`; без финального download и реальных provider attachments |
| Composition и общий язык | **4 PASS**, `browser-correction-final/` |
| Реальная форма подключения против RAM loopback WS fixture | **7 PASS**, `browser-ws-final/`; синтетические token/account, persistence ACK и auth/ready |

History/correction/WS прогоны относятся к стабильному UI-build перед последними
исправлениями native preflight/history retry/source context; extended/targeted/AX
повторены после итогового rebuild. Full 1152 matrix не запускалась. Screenshot
runner теперь ждёт отсутствие surface animation, стабильный rect и чистые
geometry diagnostics, а не только наличие DOM-узла. Desktop/phone screenshots
просмотрены отдельно. Все browser profiles временные; пользовательские архивы
и профили эти проверки не открывали.

Обобщённые уроки добавлены в существующий внешний UI/layout skill и его
changelog; независимый reviewer проверил owner и отсутствие project-specific
данных. Прежние dirty edits обеих рабочих копий сохранены. Commit/push/release
и установка в пользовательский браузер не выполнялись.

Материальное ограничение: текущая composition не предоставляет проверенные
`nativeMethods`/`nativeHistory`. Поэтому send/stop/continue/new-chat и догрузка
неполной истории возвращают unsupported. Наблюдаемые native network reads и
streams продолжают обрабатываться; уже полная наблюдаемая история собирается
по coverage и commit ACK. Декоратор/порт не означает, что реальные методы
ChatGPT уже найдены и подключены. WS source capture не доказывает parity
generation lifecycle всех WS-протоколов. Installed-browser/data, реальные
native bindings и release acceptance остаются отдельными проверками.

## Новые замечания после локального checkpoint — 2026-10-14

Владелец обнаружил ошибки, не покрытые прежними проверками: язык был в
провайдере, standalone показывал aggregate-management, Automation имела лишний
уровень, desktop Reader не заполнял окно и перекрывал toolbar. Прежние PASS
ниже остаются evidence предыдущего snapshot, а не приёмкой этих требований.
Новая корректирующая итерация фиксируется в UI-30–UI-33 и проверяет также
native capture completion отдельно от геометрии синтетического Reader.

Корректировка подтверждена локально, без установки или публикации:

- Unit: **535 PASS / 0 FAIL**, 3199 assertions, 106 файлов. Сюда входят 205
  записей одной native страницы, 180 страниц при raw-буфере 96, отказ от
  усечённого replay, пустая история, missing-parent и каталог 1000 чатов без
  чтения originals. После изменения UI отдельно повторены 7 SFC/source checks.
- TypeScript/Vue основного проекта, UI и Lab прошли; strict Biome — 625 файлов,
  0 errors/warnings. Shared packages и текущий Lab собраны. Доставка расширений
  в этом corrective batch не пересобиралась и установленная версия не менялась.
- Compiled browser: language/composition для четырёх продуктов/хостов,
  автоматизация с прямыми мобильными разделами, архив standalone/aggregate/VK —
  PASS. Reader заполняет остаток окна при 1063×1173, 1365×780, 820×1180 и
  390×844; проверены отсутствие перекрытий, диапазоны, полный выбранный путь,
  sibling IDs 7/9, два пути и закрепление версии сообщения 8 при прокрутке.
- Evidence: `apps/ui-lab/.local/correction-unit-final.log`,
  `correction-catalog/correction-ui.json`, `correction-automation/ui-automation-ui.json`,
  `correction-archive/ui-archive-ui.json` и `correction-archive/archive-ui.json`
  внутри `apps/ui-lab/.local/`. Исторические failed screenshots сохранены;
  текущий итог задают последние pass reports.

Полнота относится наблюдаемым native страницам и сохранённым связям. Все ещё
не загруженные альтернативные ветки ChatGPT, действительный аккаунт и
installed-protocol parity этим синтетическим слоем не доказаны. Для уже
вытесненного до Collect начала истории требуется явно заново открыть диалог.

## Предыдущий локальный checkpoint — 2026-10-14

Этот checkpoint предшествует новым замечаниям владельца.
Ветка `codex/local-development`, base `96b809fd0469f94e9c1032f1adb8d770f46ca7c3`;
изменения остаются локальными, без commit/push/установки/публикации.

- Полный unit gate: **518 PASS / 0 FAIL**, 3133 assertions, 103 файла.
- Полный TypeScript/Vue gate и отдельный UI Lab typecheck: PASS.
- Строгий Biome охватывает теперь и ChatGPT: **619 файлов**, 0 errors/warnings;
  46 информационных рекомендаций useTemplate не отключены.
- Все три продукта собраны для DEV, userscript + MV3 + ZIP; встроенная
  `validate --built --channel=dev --build-number=1` проверка прошла.
  Build исправляет порядок archive→adapters и declaration aliases, использует
  Vite для Vue/CSS popup и объявляет прямые workspace dependencies.
  Публичные automation/status порты принадлежат core; UI не импортирует features.
- Собранный Lab: **288/288 Chromium extended PASS**. Финальная пересборка даёт
  побайтно одинаковые файлы с проверенным snapshot, SHA-256 differences = 0.
  Отчёт: `apps/ui-lab/.local/final-extended/matrix-extended.json`.
- Built targeted UI: automation, archive обоих провайдеров/aggregate и
  Explorer **20/20 PASS**; отдельная форма WebSocket **7/7 PASS**.
  Отчёты: `.local/targeted-built-final/ui-targeted-ui.json` и
  `.local/final-ws/ws-ui.json` внутри `apps/ui-lab/`.
- Phone Reader standalone/aggregate использует 779 из 844 px; при открытом
  таймлайне остаётся 275 px для сообщений. Внешние content/Reader/main/reading
  имеют scrollWidth = clientWidth. Общий Shell принимает только универсальный
  presentation marker; provider CSS не управляет каталогом Shell.
- Независимое локальное source review проверило normalized authority, raw policy
  и recovery. Обнаруженная потеря native source variants исправлена и повторно
  принята: codec-aware dedup различает Map/Set/Blob/binary/BigInt и missing/undefined,
  неизвестные channel/recipient сохраняются как варианты без исключения.

Крупные JS chunks Lab остаются предупреждением сборщика, а не доказательством
оптимизации общей памяти. Большие реальные архивы, квоты/приостановка браузера,
авторизация действительных сайтов и installed DEV/PROD coexistence требуют
следующего отдельного этапа. Обычный Chrome недоступен через текущий UI connector:
отключение ранее установленного расширения не подтверждено. Все текущие browser
checks используют одноразовые синтетические профили; пользовательские данные
и ранее установленные расширения ими не изменялись.

## Расширенная цель и текущее доказательство

Актуальная цель: общий модульный каркас, дизайн/интерактивные формы и архивы,
полнота цепочки и версии, переиспользуемые Markdown/JSON экспорты выбранной
области отдельно от бэкапа, нормализованные сообщения с версией формата,
согласованный raw/normalized remote режим и общий сервис телеметрии.
Проверка подключения должна предшествовать сохранению адреса/токена; удаление
показывается только для уже сохранённых значений. Все интерактивные примитивы
берутся из общего shadcn-vue registry. Локальные gates завершены выше;
installed-browser и release приёмка остаются отдельными.

Фактический короткий Chromium replay обнаружил две независимые причины UI:
Tailwind `@property` из ShadowRoot не задавал начальные значения utility vars
(Card/Switch получали `0px none`), а fullscreen overlay с внешним MAX z-index
перекрывал внутренний Dialog z50. Общая тема задаёт локальные utility defaults,
overlay теперь z40. Дополнительный provider CSS повторно задавал MAX z-index
для того же overlay после загрузки ChatGPT; конфликтующий override удалён.
Повторный replay показывает мобильные настройки 390×844, включая звуки,
триггеры и remote, и видимые границы Card; это не доказывает всю матрицу. Первый полный smoke
сбрасывался HMR во время изменений и не считается итоговым прогоном.

Принципы композиции/внедрения зависимостей сверены с официальными
[FastAPI bigger applications](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
и [dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/): отдельные
модули и явная сборка приложения применяются к существующим TypeScript ports.
Отдельный Python backend в этой итерации не создаётся.

После уточнения владельца источник найден через MCP GitLab HappyKids:
[`web_report/frontend`, develop](https://git.happykids.ru/web_report/frontend/-/tree/develop),
commit `8481c9bc4ffc299e964b47638e195f2a0cc234dd`. Сравнение модулей telemetry
и принятые отличия записаны в [контракте телеметрии](shared/TELEMETRY.md).
Журнал/доставка/настройки/экспорт переиспользуют общий принцип композиции;
append-time ротация и тексты исключений не перенесены, поскольку владелец требует
периодический batch, а сообщения/stack могут раскрыть личные данные.

Подтверждение текущей локальной итерации:

- Собранный UI Lab: `bun run ui:lab:build` прошёл. Chromium smoke на static
  `127.0.0.1:4173`: 96/96 PASS, отчёт
  `apps/ui-lab/.local/settled-review/matrix-smoke.json`. Это проверка синтетических
  геометрии/переходов, а не полноты данных и не всей матрицы 288/1152.
- Короткий `--inspect`: телефон 390×844 действительно рисуется поверх overlay;
  Checkbox меняется false→true с видимой SVG-галочкой и границей 1px; VK
  quick menu → settings остаётся внутри viewport после завершения перехода.
- `--ws-ui`: семь проверок реальной формы против loopback fixture прошли:
  Save скрыт до проверки/после неверного токена, auth/ready разрешает сохранение,
  затем режим remote-only, включение и online. Токен только синтетический и RAM.
- Восстановление TAR.GZ зависало при `sourceStamp()` внутри write-транзакции:
  async iterator/WebCrypto теряли неявный контекст Dexie и открывали заблокированную
  read-транзакцию. Явная привязка таблиц к текущей Transaction устранила зависание;
  все пять portable-тестов прошли, включая owner/corruption, 137 сообщений
  и staged reader с асинхронными обращениями к отдельной базе.
- Staged application recovery: 14 focused tests / 114 assertions PASS:
  выбор раздела, чужой owner, checksum, UTF-8 запись >4 MiB, rollback после
  частичной записи/отмены, неудачный rollback и явный retry, quota до primary
  writes, final validation до publication. Три теста используют fake IndexedDB
  с реальным Dexie: закрытие/повторное открытие, 260 строк, sealed/duplicate
  batches и изоляция владельца/установки. Это не installed-browser quota proof.
  Зависание `.rejects` в Bun после async-итерации оказалось ошибкой matcher;
  прямой awaited try/catch проходит. Production deadlock здесь не установлен.
- Общий unit checkpoint: 460 PASS / 0 FAIL, 2652 assertions / 95 files;
  последующие изменения требуют нового combined gate. Полный typecheck и
  strict Biome также проходили перед последней серией изменений. Итоговый
  общий unit/lint/type/build gate ещё не принят.
- Общая модель: 30 focused tests / 439 assertions PASS для `ArchiveMessageV1`,
  legacy lazy adaptation, opaque/unknown content, local/export authority и обеих
  portable backup suites. Remote integration: 12 tests / 98 assertions PASS,
  включая фактические синтетические WS-пакеты, preferred/variants, legacy project,
  owner/session fences, raw consent и очередь без head-of-line блокировки.
  Это scoped evidence; combined gates после lint cleanup ещё впереди.
- Удалён blanket Biome ignore для ChatGPT. Прежний общий lint не охватывал этот
  продукт; теперь обычный root lint проверяет и его. Форматирование приведено
  к общему конфигу, предупреждения исправляются без отключения правил.

Последующие изменения не покрываются более ранней сборкой автоматически.

| Требование | Изменённые источники / подтверждение | Что ещё должно быть доказано |
| --- | --- | --- |
| Общий каркас, конфигурируемые меню и модули | Core Feature.settings/modules/backup, Shell SettingsCatalog, display preferences; архив VK переведён в child module; session/capture/reader/backup разделены за единым VK service | Полная проверка lifecycle, cross-tab flags, remaining provider-specific reusable fragments |
| Мобильный fullscreen, tablet density, dock/drop, каталоги | Общий Shell/UI и Lab; версии из application descriptor, All-in-one components отдельно; иерархия групп/веток, единый rect для render/drag, исправлен registry translate и Select bounds. UI-23: `$attrs` с координатами передаются внутреннему DialogContent, а не Portal/Teleport без DOM-узла; раньше drag менял значения, которые окно не получало | Визуальная приёмка всех поверхностей/viewport и действительных сайтов; старые диагностические ожидания требуют обновления после серии правок |
| Сохранение представления при замене сайта/продукта | Lab allowlist + scoped session UI; данные/операции не переносятся | Browser route/category/disabled-menu matrix |
| Общий injector | Schema-driven createSiteInjector используется native site entry | Реальные dynamic headers, cleanup и модульные ChatGPT rendering mounts |
| API/SSE/WebSocket lifecycle ChatGPT | Provider observer/capture/decorators source changes | Реальные сетевые протоколы, concurrent generations, reconnect и финальные статусы |
| Звуки как optional module | ChatGPT sounds category and lifecycle, user send default off | Browser audio activation, завершение/ошибка/context end без ложных сигналов |
| Сохранность ответов/варианты | ChatGPT immutable observations, preferred enrichment, snapshot variants | Stale reload, conflict, truncated request и независимые ветки без потери source data |
| Одна нормализованная модель | Shared `ArchiveMessageV1`: snapshot.normalized у VK/ChatGPT, source refs вместо копии raw, legacy read adaptation без записи; старые projection/element rows — индекс/render cache. Ordinary exports и ChatGPT live/sync используют эту же authority; модель проверяет версии, identity, source compatibility и element cycles | Combined type/unit/build gate, независимое source review и installed-data acceptance; fixed schema tables/indexes не изменены |
| Полнота цепочки и ветвление | Provider graph evidence + branch/version navigation | Графы с пропущенным началом/концом/parent, variants, selectable export integrity |
| Событийный Reader | Shared archive feed + provider commit subscriptions and coalesced updates | Cross-tab same-owner updates, owner/peer switch fences и сохранение scroll |
| Общая off-by-default telemetry | Controller, журнал, worker/GM bridge, настройки, scopes, export, batching/retry | Permissions/consent, offline/restart delivery, isolation и rotation в браузере |
| Раздельный backup/restore | Core registry, sectioned TAR.GZ, immutable staged input/rollback в отдельной scoped Dexie DB, provider staged graph validation/transactions, durable attempted/completed journal, явный retry/discard; streaming File System Access output и compressed Blob fallback 128 MiB; Lab использует только память | Round-trip/bad scope/hash/rollback/concurrent mutation, quota и длинные транзакции/worker suspension; origin Web Lock не обеспечивает cross-GM/cross-backend atomicity; installed-data приёмка не проведена |
| Общая автоматизация и управляемые события | Shared typed event hub, contains/exact rules, CRUD, serial commands и feedback guards; ChatGPT публикует source-confirmed API/message/conflict/limit/completion. DOM timing отменён последней директивой. Native commands требуют verified binding, preflight target и source confirmation. Иерархические настройки, source status/queue UI и отдельный scoped token; восстановление настроек выключает правила и соединение | Реальные native bindings и installed protocol acceptance отсутствуют; default commands unsupported. Произвольный JS не поддерживается. Актуальная граница описана в [ChatGPT contract](chatgpt-booster/LIVE_ARCHIVE_CONTRACT.md) |
| WebSocket remote и режимы хранения | Общий клиент/outbox, auth/hello, SHA256 logical fragmentation и ACK, retry/dead letters, scope/destination binding, TTL/capability command guards. ChatGPT local-and-remote публикует после commit; remote-only обходит будущие canonical writes, очередь volatile. Явный syncArchive/cancelSync читает пять canonical owner stores без изменений и без загрузки истории сайта: sync-start/row/end, rolling SHA256, online backpressure, abort/timeout и финальный persisted snapshot guard; queuedRows не означает доставку. [Точный протокол](shared/AUTOMATION_AND_REMOTE.md) | Loopback fixture подтверждает auth/ready, ACK, reconnect, large command result и форму подключения; PROD сервер не создан. Offline/quota, долговременная command recovery, staging/активация полной выгрузки и отсутствие потерь требуют широкой приёмки. По умолчанию Lab без сокетов; только явный wsFixture=1 использует синтетический RAM control. Уже начатый enqueue не отзывается отменой |
| Полный перенос reusable элементов | Shared catalog, injector, telemetry/recovery, archive widgets and feeds; registry Popover/Tooltip вместо manual popup, общий conversation list и backup controls на shadcn | Audit оставшихся active provider implementations; исторические источники/DB сохраняются |
| Локальная работа и GitHub | Локальная ветка codex/local-development, существующая авторизация; изменения не закоммичены/не отправлены | Review после разрешённой итоговой проверки; публикация/установка не выполнены |

Открытые ограничения нельзя считать выполнением цели. После окончания серии
правок требуется согласовать актуальные проверки с новым поведением и провести
unit/type/build/UI gates, затем отдельную installed-browser/data приёмку.

Последняя серия правок резервных копий сохраняет busy guard, reset file Input
через remount и rollback также для раздела, который завершился ошибкой после
частичной записи. Старый общий лимит распакованного TAR/rollback 128 MiB заменён
staged storage; сохранены export record/chunk/manifest bounds 4 MiB и TAR entry
bound 8 MiB. Дополнительный нулевой хвост TAR ограничен 1 MiB, включая файл без
manifest. После final validation файл публикуется через commit; prepared и
completed различаются, а cleanup-only ошибка не отменяет известный committed
результат. Синтетический round-trip и failure/recovery сценарии проверены;
большие настоящие архивы и установленное расширение ещё не проверены.

Ограничения глубины remote JSON и canonical hashing теперь выводятся из самого
archive codec: 150 логических уровней дают до 451 уровня tagged JSON, а оболочка
sync-row — 452. Прежний предел 200 отвергал допустимые архивные значения. Предел
кодека и формат не изменены; вынесены общие константы. Предельный round-trip
защищён focused tests; итоговый combined gate после последних изменений ещё нужен.
Прежний запрет запуска DEV в обычных окнах отменён владельцем 2026-10-17:
entrypoints и фоновые обработчики принимают обычные и private contexts по
валидному installation scope. Текущая политика и границы сохранения данных
принадлежат [environment contract](shared/ENVIRONMENTS_AND_STORAGE.md).

## 2026-10-17 — VK collection, startup and Reader correction checkpoint

Owning decisions are [UI-55–UI-59](shared/UI_DECISIONS.md), the
[VK archive contract](vk-booster/ARCHIVE.md) and the
[Lab-first UI workflow](shared/UI_ACCEPTANCE.md#lab-first-interface-workflow).
DEV startup accepts normal/private supported contexts while preserving channel
identity. Repeat capture retains the covered baseline and separates actual
source reads from reused history. Reader handles nested post files, targets the
message card, aligns selection checkboxes, separates message cards and actions,
and previews verified names, message text and source dates without message IDs.
Fixed Dexie schema 1 and source product versions remain unchanged.

Current local evidence after these corrections:

- Root strict typecheck/Biome/tests/source validation passed: 720 tests across
  132 files, 4360 assertions. Final strict typecheck also passed after public
  widget declaration alignment; both channel output validation gates passed.
- Frozen Laboratory UI build passed extended 288/288 with no failed cases.
  Four VK standalone/aggregate desktop/phone Reader cases measure 12px card
  separation, checkbox alignment, panel insets, consistent action heights,
  themed dated previews, nested attachment controls and reused progress.
  History checks passed 19 hover/keyboard/touch/layout/export scenarios.
  Synthetic evidence is in ignored `.local/vk-spacing-final-20261017/` and
  `.local/vk-history-final-20261017/` under `apps/ui-lab/`.
- All products built for userscript/MV3 in PROD and DEV build 51; source versions
  remain unchanged. PROD candidates are retained under `dist/local-candidates/`.
- The authorized authenticated VK session previously completed capture and a
  repeated run stopped after 26 source reads, reusing 4613 covered records.
  A nested post photo downloaded and decoded in the Reader. These observations
  are live integration evidence, not synthetic fixtures or archive guarantees.
- The new authorized browser MCP session exposes page, console and network
  diagnostics. Browser-target CDP attachment is refused by that server; full
  debugger privileges have not been established.

The local browser preview is open for owner review. The authenticated page used
a temporary DEV bundle injection; persistent Tampermonkey/MV3 installation and
automatic startup after updating it remain separate acceptance. Local candidate
artifacts are not a published release, protected-branch merge or independent
review approval.

## 2026-10-17 — shared Reader and export correction

[UI-60–UI-62](shared/UI_DECISIONS.md) correct full-width borders, replace manual
VK pagination with bounded bidirectional loading, and reuse shared reading
anchors/navigation and export selection in both products. Export now offers
calendar dates, latest N and searched inline message selection alongside the
format. Provider owner/revision guards remain in place; storage schema and
product source versions are unchanged.

Synthetic Laboratory evidence: 8 scrolling cases passed, including traversal
of all 3000 saved VK records and reverse loading; 4 VK layout cases and 19
history cases passed. The final export build passed 8 desktop/phone cases for
both standalone/aggregate providers, including prepared latest-50 JSON content,
inclusive calendar filtering and inline selection. Reports are ignored under
`apps/ui-lab/.local/reader-scroll-20261017/` and `export-scope-20261017/`.
Strict typecheck and Biome passed. Root tests reported 725 passing and two
obsolete source-string assertions requiring the removed 80-record pagination;
those assertions were updated for the shared Reader ports. At the owner's
request, no further test runs were started. This checkpoint does not claim a
fresh all-green combined gate, installed-browser acceptance or publication.
All three products subsequently built successfully for userscript and MV3 in
DEV build 52. The shared widgets package now declares its archive dependency;
local build artifacts are available under `dist/`. No installed extension was
updated and no release was published.
PR #45's first CI run passed all 727 tests and the browser UI matrix, then
rejected missing product source-version increments. The follow-up advances
ChatGPT to 2.0.21 and All-in-one to 0.5.23, including private workspace/runtime
metadata and the lockfile; VK's pre-first-PROD source remains frozen at 1.0.0.
The owner also permits direct delivery to unprotected `main`, with live branch
protection/ruleset verification and the existing validation gates retained.
The subsequent owner directive removes the VK source freeze tied to first PROD:
VK advances to 1.1.0 for this functional update; minor versions add functionality,
patches fix bugs, and major versions represent fundamental changes. The common
version planner and CI now treat VK like other affected products. Canonical
schema stays 1; historical archives and separate publication approval are intact.
