/** Return a bounded user-safe explanation without exposing source payloads. */
export function vkArchiveErrorMessage(error: unknown): string {
  const record =
    error && typeof error === 'object' ? (error as { message?: unknown; name?: unknown }) : undefined
  const message = typeof record?.message === 'string' ? record.message : ''
  const name = typeof record?.name === 'string' ? record.name : ''
  if (/QuotaExceededError/.test(name))
    return 'Не хватает места в хранилище браузера. Освободи место и повтори сбор; сохранённые записи остаются в архиве.'
  if (/SecurityError|InvalidStateError|VersionError/.test(name))
    return 'Браузер не разрешил открыть архив IndexedDB. Проверь доступ к хранилищу и повтори операцию.'
  if (/^(UnknownError|TransactionInactiveError|ConstraintError|DataError|DataCloneError)$/.test(name))
    return 'Не удалось записать сообщение в IndexedDB. Уже сохранённые записи остаются в архиве; повтори сбор.'
  if (/AbortError|TimeoutError/.test(name) || /VK request timed out/.test(message))
    return 'VK не ответил вовремя. Повтори сбор — уже сохранённые сообщения будут учтены.'
  if (/VK network unavailable|Failed to fetch|fetch failed|Load failed|NetworkError/i.test(message))
    return 'Не удалось связаться с VK. Проверь соединение и повтори сбор.'
  if (/history paging made no progress|history order changed/.test(message))
    return 'VK повторяет или меняет страницы истории. Сохранённые сообщения оставлены; повтори сбор.'
  if (/stopped returning history|Неверный ответ истории|Invalid VK history/.test(message))
    return 'VK вернул неполную или неподдерживаемую страницу истории. Сохранённые сообщения оставлены; повтори сбор.'
  if (/No saved VK messages/.test(message))
    return 'В этом диалоге ещё нет сохранённых сообщений. Сначала запусти сбор.'
  if (/archive changed|export source changed|source cursor changed/.test(message))
    return 'Архив изменился во время подготовки файла. Заверши сбор и подготовь экспорт повторно.'
  if (
    /message changed|explicit source revision|Unknown VK message direction|source revision|source identity|projection/.test(
      message,
    )
  )
    return 'Не удалось проверить исходную запись VK. Прежние версии сохранены; выгрузка не объявлена полной.'
  if (/VK HTTP 429|VK HTTP 5\d\d|VK API 6/.test(message))
    return 'VK временно ограничил запросы. Подожди и попробуй снова.'
  if (/VK API (5|1116)(?:\b|$)/.test(message))
    return 'VK не принимает токен для этого метода. Проверь авторизацию и доступ приложения к истории.'
  if (/VK HTTP 401|VK HTTP 403|VK API (7|15|27|30)/.test(message))
    return 'VK отклонил доступ к истории. Проверь авторизацию.'
  if (/peer changed|conversation changed|different conversation|другой диалог/i.test(message))
    return 'Активная переписка изменилась. Вернись в нужный диалог.'
  if (/authoriz|authenticat|access unavailable|авторизац/i.test(message))
    return 'Авторизация VK не подтверждена. Открой переписку и повтори операцию.'
  if (/Selected VK messages are no longer saved/.test(message))
    return 'Часть выбранных сообщений больше не найдена в сохранённой переписке. Обнови Reader и проверь выбор; неполный ZIP не создан.'
  if (/Invalid VK export selection/.test(message))
    return 'Выбери хотя бы одно сохранённое сообщение для выборочного экспорта.'
  const apiCode = /^VK (API|HTTP) ([0-9]{1,4})$/.exec(message)
  if (apiCode)
    return `VK отклонил запрос (${apiCode[1]} ${apiCode[2]}). Сохранённые записи оставлены; повтори операцию.`
  return 'Причина пока не установлена. Сохранённые записи не удалены.'
}
