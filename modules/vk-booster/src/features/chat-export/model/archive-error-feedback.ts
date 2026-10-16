/** Return a bounded user-safe explanation without exposing source payloads. */
export function vkArchiveErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
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
  return 'Причина пока не установлена. Сохранённые записи не удалены.'
}
