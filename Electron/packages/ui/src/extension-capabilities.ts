import type { ExtensionSource } from '@pipi/host-api'

/** Spec D8 L1 capability set. Anything else is L2 host privilege (spec D11). */
export const L1_CAPABILITIES = [
  'settings.read',
  'settings.write',
  'bridge.emit',
  'invoke.agent',
  'stream.render',
  'terminal.read',
  'notifications',
] as const

export type L1Capability = (typeof L1_CAPABILITIES)[number]

const L1_SET = new Set<string>(L1_CAPABILITIES)

export const L2_CAPABILITY_HINT = '该能力仅官方内置可用'

export const CAPABILITY_LABELS: Record<L1Capability, string> = {
  'settings.read': '读取本扩展设置',
  'settings.write': '写入本扩展设置（经宿主校验）',
  'bridge.emit': '允许功能半向界面发送事件',
  'invoke.agent': '调用本扩展的代理方法',
  'stream.render': '自定义工具输出卡片',
  'terminal.read': '读取终端快照（只读）',
  notifications: '发送桌面通知',
}

export const EXTENSION_SOURCE_LABEL: Record<ExtensionSource, string> = {
  builtin: '内置',
  app: 'App',
  project: '项目',
}

export const EXTENSION_STATE_LABEL = {
  discovered: '已发现',
  loaded: '已加载',
  enabled: '已启用',
  disabled: '已禁用',
  unloaded: '已卸载',
  error: '错误',
} as const

export function isL2Capability(capability: string): boolean {
  return !L1_SET.has(capability)
}

export function capabilityLabel(capability: string): string {
  if (capability in CAPABILITY_LABELS) return CAPABILITY_LABELS[capability as L1Capability]
  return L2_CAPABILITY_HINT
}

/** Third-party L2 packages cannot be enabled (spec D11: first ship, official builtins only). */
export function blocksEnableForL2(source: ExtensionSource, capabilities: readonly string[]): boolean {
  return source !== 'builtin' && capabilities.some(isL2Capability)
}

/** Confirm when any requested capability is not already granted (first grant or set grew). */
export function grantNeedsConfirmation(requested: readonly string[], granted: readonly string[]): boolean {
  if (requested.length === 0) return false
  const grantedSet = new Set(granted)
  return requested.some(capability => !grantedSet.has(capability))
}
