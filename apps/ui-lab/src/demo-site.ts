/** Synthetic host layout. These controls never navigate to real sites or fetch records. */
export function mountDemoSite(
  root: HTMLElement,
  options: { vk: boolean; inConversation: boolean; aggregate: boolean },
) {
  const brand = options.vk ? 'VK' : 'ChatGPT'
  const product = options.vk ? 'VK Booster' : 'ChatGPT Booster'
  root.className = `demo-site ${options.vk ? 'demo-vk' : 'demo-chatgpt'}`
  const context = options.vk
    ? options.inConversation
      ? 'Сообщения · открытый диалог'
      : 'Лента · вне диалога'
    : 'Чат · план проекта'
  const sidebar = options.vk
    ? '<b>VK</b><span>Моя страница</span><span>Новости</span><span class="selected">Сообщения</span><span>Друзья</span><span>Сообщества</span>'
    : '<b>Рабочее пространство</b><span>Новый чат</span><span>Поиск чатов</span><b>Проекты</b><span>Разработка приложения</span><span class="selected">План нового проекта</span><span>Идеи и заметки</span>'
  const content = options.vk
    ? options.inConversation
      ? '<div class="demo-conversation-header"><span class="demo-avatar">А</span><div><b>Алексей · тестовая переписка</b><small>Диалог открыт — доступны инструменты сообщений</small></div></div><div class="demo-message">Привет! Посмотрим, как интерфейс выглядит поверх переписки?</div><div class="demo-message outgoing">Да. Открой боковое меню, архив или настройки.</div><div class="demo-message">Это тестовые сообщения. Реальный аккаунт не подключён.</div><div class="demo-composer">Написать сообщение…</div>'
      : '<div class="demo-feed-heading">Новости</div><article class="demo-post"><b>Команда проекта</b><small>Сегодня · тестовая публикация</small><p>Обновили интерфейс приложения. Здесь нет открытого диалога, поэтому инструменты текущей переписки не показываются.</p><span>Нравится · Комментировать · Поделиться</span></article><article class="demo-post"><b>Дизайн и разработка</b><p>Сравниваем обычную страницу и диалог. Настройки VK Booster доступны в обоих случаях.</p></article>'
    : '<div class="demo-conversation-header"><b>План нового проекта</b></div><div class="demo-message outgoing">Помоги составить план разработки приложения.</div><article class="demo-answer"><b>ChatGPT</b><p>Начнём с общих компонентов и понятных пользовательских сценариев.</p><ol><li>Общий каркас и настройки.</li><li>Инструменты для текущей страницы.</li><li>Адаптация к телефону, планшету и компьютеру.</li></ol><p>В этом стенде ответ синтетический. Можно проверить, как элементы расширения сочетаются с чатом.</p></article><div class="demo-composer">Спросите что-нибудь…</div>'
  root.innerHTML = `<div class="demo-banner">ЛОКАЛЬНЫЙ МАКЕТ · ТЕСТОВЫЕ ДАННЫЕ</div><header class="demo-site-header" data-browser-tools-host><b class="demo-wordmark">${brand}</b><span>${options.vk ? 'vk.com' : 'chatgpt.com'}</span></header><div class="demo-site-layout"><aside class="demo-site-sidebar">${sidebar}</aside><main class="demo-site-main"><section class="demo-preview-identity"><span>${options.aggregate ? 'All-in-one · ' : ''}Предпросмотр сайта ${brand}</span><h1>${product}</h1><p>${context}</p></section><section class="demo-site-content">${content}</section></main></div>`
}
