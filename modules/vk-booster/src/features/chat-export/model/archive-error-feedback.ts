/** Return a bounded user-safe explanation without exposing source payloads. */
export function vkArchiveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/VK HTTP 429|VK HTTP 5\d\d|VK API 6/.test(message))
    return 'VK временно ограничил запросы. Подожди и попробуй снова.'
  if (/VK HTTP 401|VK HTTP 403|VK API (7|15|27|30)/.test(message))
    return 'VK отклонил доступ к истории. Проверь авторизацию.'
  if (/peer changed|conversation changed|different conversation|другой диалог/i.test(message))
    return 'Активная переписка изменилась. Вернись в нужный диалог.'
  if (/authoriz|authenticat|access unavailable|авторизац/i.test(message))
    return 'Авторизация VK не подтверждена. Открой переписку и повтори операцию.'
  return 'Причина пока не установлена. Сохранённые записи не удалены.'
}
