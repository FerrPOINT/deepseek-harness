/** English strings for the OpenRouter usage settings section. */
export const openRouterEn = {
  nav: 'Limits', title: 'OpenRouter', intro: 'Live spend and limits for the configured API key.',
  loading: 'Loading OpenRouter usage…', loadFailed: 'OpenRouter usage could not be loaded.', unsupported: 'The configured OpenRouter route does not expose usage.',
  refresh: 'Refresh', refreshing: 'Refreshing…', retry: 'Retry', refreshFailed: 'Refresh failed. Showing the last successful snapshot.',
  dailyUsage: 'Used today', weeklyUsage: 'Used this week', monthlyUsage: 'Used this month',
  remaining: 'Remaining', noLimit: 'No spending limit', ofLimit: 'of {limit}', limitUsed: 'Spending limit used',
  today: 'Today', week: 'This week', month: 'This month', allTime: 'All time', updated: 'Updated {time}',
  activity: 'Activity', keys: 'API keys', credits: 'Credits',
}

/** OpenRouter settings namespace key union. */
export type OpenRouterKey = keyof typeof openRouterEn

/** Chinese strings for the OpenRouter usage settings section. */
export const openRouterZh: { [Key in OpenRouterKey]: string } = {
  nav: '限额', title: 'OpenRouter', intro: '查看当前 API Key 的实时消费和限额。',
  loading: '正在加载 OpenRouter 用量…', loadFailed: '无法加载 OpenRouter 用量。', unsupported: '当前 OpenRouter 路由不提供用量信息。',
  refresh: '刷新', refreshing: '刷新中…', retry: '重试', refreshFailed: '刷新失败，正在显示上次成功的数据。',
  dailyUsage: '今日已用', weeklyUsage: '本周已用', monthlyUsage: '本月已用',
  remaining: '剩余', noLimit: '未设置消费限额', ofLimit: '共 {limit}', limitUsed: '已用消费限额',
  today: '今日', week: '本周', month: '本月', allTime: '累计', updated: '更新于 {time}',
  activity: '活动', keys: 'API Key', credits: '余额',
}
