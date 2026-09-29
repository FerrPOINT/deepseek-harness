/** Russian translations retained from the FerrPOINT Web language pack. */
export const ruPro: Record<string, Record<string, string>> = {
  pluginManager: {
    panel: 'Дополнения', title: 'Дополнения', intro: 'Установка, включение и настройка дополнений',
    officialTitle: 'Официальные', bundlesTitle: 'Установленные', statusBeta: 'Экспериментальное',
  },
  'schedule.manager': {
    panel: 'Автоматизация', title: 'Задачи автоматизации', 'new.action': 'Новая',
    'list.label': 'Список задач', 'list.loading': 'Загрузка задач…',
    'list.error': 'Не удалось загрузить задачи.', 'list.retry': 'Повторить',
    'list.empty': 'Задач пока нет. Создайте задачу в любой сессии.',
    'search.label': 'Поиск задач', 'search.placeholder': 'Поиск задач автоматизации',
    'search.clear': 'Очистить поиск', 'statusFilter.label': 'Статус задачи',
    'statusFilter.all': 'Все', 'status.active': 'Включена', 'status.inactive': 'Неактивна',
  },
  chat: {
    'message.turnProcess.worked': 'Выполнено', 'message.turnProcess.took': 'Заняло {duration}',
    'message.turnProcess.failed': 'Завершено с ошибкой', 'message.turnUsage.consumed': 'Использовано {total}',
    'chat.deepDivingFor': 'Глубокое погружение {duration}…',
  },
  'open-in-app': {
    'open.title': 'Открыть в {app}', 'open.tooltip': 'Открыть локально',
    'path.open': 'Открыть', 'path.more': 'Другие способы открытия', 'path.reveal': 'Показать расположение файла',
    'app.explorer': 'Проводник', 'app.filemanager': 'Файлы', 'app.terminal': 'Терминал',
  },
  sidebarRight: {
    'chrome.expand': 'Открыть боковую панель', 'chrome.expandAria': 'Открыть правую боковую панель',
    'chrome.collapse': 'Свернуть боковую панель', 'chrome.collapseAria': 'Свернуть правую боковую панель',
  },
  'session-log-download': { 'header.more': 'Другие действия' },
  'permission.access': {
    mode: 'Режим доступа, текущий: {name}', close: 'Закрыть',
    'preset.readOnly': 'Только чтение', 'preset.workspaceWrite': 'Запись в рабочей папке',
    'preset.fullAccess': 'Полный доступ',
  },
  'settings.openrouter': {
    nav: 'Лимиты', title: 'OpenRouter', intro: 'Текущие траты и лимиты настроенного API-ключа.',
    loading: 'Загружаю данные OpenRouter…', loadFailed: 'Не удалось загрузить данные OpenRouter.',
    unsupported: 'Настроенный маршрут OpenRouter не предоставляет данные о расходах.',
    refresh: 'Обновить', refreshing: 'Обновляю…', retry: 'Повторить',
    refreshFailed: 'Обновление не удалось. Показаны последние успешно загруженные данные.',
    dailyUsage: 'Потрачено сегодня', weeklyUsage: 'Потрачено за неделю', monthlyUsage: 'Потрачено за месяц',
    remaining: 'Осталось', noLimit: 'Лимит расходов не задан', ofLimit: 'из {limit}',
    limitUsed: 'Использовано лимита', today: 'Сегодня', week: 'За неделю', month: 'За месяц',
    allTime: 'За всё время', updated: 'Обновлено в {time}', activity: 'История', keys: 'API-ключи', credits: 'Баланс',
  },
}
