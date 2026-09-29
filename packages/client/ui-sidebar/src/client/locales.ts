/** `sidebar` namespace dictionaries for shell controls and global panels. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'session.new': '新会话',
  'session.new.label': '新建会话',
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
  'panels.label': '全局面板',
  'instance.switch': '切换 DSH 实例',
  'instance.add': '连接新的 DSH',
  'instance.dialog.title': '连接 DSH 实例',
  'instance.dialog.description': '输入 DSH 地址或一次性登录链接。',
  'instance.name': '实例名称',
  'instance.url': 'DSH 地址或登录链接',
  'instance.url.placeholder': 'https://dsh.example.com 或带 token 的链接',
  'instance.submit': '连接并打开',
  'instance.cancel': '取消',
  'instance.local': '本地 DSH',
  'instance.error.required': '请输入 DSH 地址或登录链接。',
  'instance.error.invalid': '请输入有效的 DSH 地址。',
  'instance.error.credentials': '地址中不能包含用户名或密码。',
  'instance.error.path': '请使用 DSH 根地址；登录链接只能包含 token。',
  'instance.error.query': '登录链接必须只包含一个非空 token。',
  'instance.error.insecure': '远程 DSH 必须使用 HTTPS。',
  'instance.error.name': '实例名称不能超过 48 个字符。',
  'instance.error.limit': '最多可保存 32 个实例。',
  'instance.error.storage': '无法保存实例列表。',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
  'panels.label': 'Global panels',
  'instance.switch': 'Switch DSH instance',
  'instance.add': 'Connect new DSH',
  'instance.dialog.title': 'Connect DSH instance',
  'instance.dialog.description': 'Enter a DSH address or a one-time sign-in link.',
  'instance.name': 'Instance name',
  'instance.url': 'DSH address or sign-in link',
  'instance.url.placeholder': 'https://dsh.example.com or a link with token',
  'instance.submit': 'Connect and open',
  'instance.cancel': 'Cancel',
  'instance.local': 'Local DSH',
  'instance.error.required': 'Enter a DSH address or sign-in link.',
  'instance.error.invalid': 'Enter a valid DSH address.',
  'instance.error.credentials': 'The address cannot contain a username or password.',
  'instance.error.path': 'Use the DSH root address; sign-in links may only contain token.',
  'instance.error.query': 'The sign-in link must contain only one non-empty token.',
  'instance.error.insecure': 'Remote DSH instances must use HTTPS.',
  'instance.error.name': 'The instance name must be 48 characters or fewer.',
  'instance.error.limit': 'You can save up to 32 instances.',
  'instance.error.storage': 'The instance list could not be saved.',
} satisfies Record<SidebarKey, string>
