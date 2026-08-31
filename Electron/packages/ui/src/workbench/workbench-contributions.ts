import type { ReactNode } from 'react'

import { createContributionRegistry, useRegistrySnapshot, type Disposer } from '../contribution-registry'
import type { WorkbenchLocation } from './workbench-store'

export type WorkbenchContainerContribution = {
  id: string
  location: WorkbenchLocation
  title: string
  icon?: string
  order?: number
  extensionId: string
}

export type WorkbenchViewContribution = {
  id: string
  container: string
  extensionId: string
  render: (context: { active: boolean }) => ReactNode
}

const containerRegistry = createContributionRegistry<WorkbenchContainerContribution>()
const viewRegistry = createContributionRegistry<WorkbenchViewContribution>()
/** Internal registry owner for Kernel Workbench surfaces; never an Extension Package. */
const KERNEL_WORKBENCH_OWNER = '__pipiui-kernel-workbench__'

export function registerWorkbenchContainer(
  extensionId: string,
  contribution: Omit<WorkbenchContainerContribution, 'extensionId'>,
): Disposer {
  return containerRegistry.register(extensionId, { ...contribution, extensionId })
}

export function registerWorkbenchView(
  extensionId: string,
  contribution: Omit<WorkbenchViewContribution, 'extensionId'>,
): Disposer {
  return viewRegistry.register(extensionId, { ...contribution, extensionId })
}

/** Register a Kernel-owned Workbench surface without pretending it is a manageable extension. */
export function registerKernelWorkbenchContainer(
  contribution: Omit<WorkbenchContainerContribution, 'extensionId'>,
): Disposer {
  return registerWorkbenchContainer(KERNEL_WORKBENCH_OWNER, contribution)
}

/** Register a Kernel-owned Workbench view. It is selected only by an explicit Profile layout. */
export function registerKernelWorkbenchView(
  contribution: Omit<WorkbenchViewContribution, 'extensionId'>,
): Disposer {
  return registerWorkbenchView(KERNEL_WORKBENCH_OWNER, contribution)
}

export function listWorkbenchContainers(): readonly WorkbenchContainerContribution[] {
  return containerRegistry.list()
}

export function listWorkbenchViews(): readonly WorkbenchViewContribution[] {
  return viewRegistry.list()
}

export function useWorkbenchContainers(): readonly WorkbenchContainerContribution[] {
  return useRegistrySnapshot(containerRegistry)
}

export function useWorkbenchViews(): readonly WorkbenchViewContribution[] {
  return useRegistrySnapshot(viewRegistry)
}

export function disposeWorkbenchContributions(extensionId: string): void {
  containerRegistry.disposeExtension(extensionId)
  viewRegistry.disposeExtension(extensionId)
}
