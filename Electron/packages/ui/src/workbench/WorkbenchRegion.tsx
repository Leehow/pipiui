import { Fragment, useSyncExternalStore } from 'react'

import { useWorkbenchContainers, useWorkbenchViews } from './workbench-contributions'
import type { WorkbenchLocation, WorkbenchStore } from './workbench-store'

function selectedContainer(
  location: WorkbenchLocation,
  layout: ReturnType<WorkbenchStore['snapshot']>['layout'],
): string | undefined {
  if (location === 'primarySidebar') return layout.primarySidebar
  if (location === 'center') return layout.center
  if (location === 'auxiliarySidebar') return layout.auxiliarySidebar
  return undefined
}

export function WorkbenchRegion({ store, location }: { store: WorkbenchStore; location: WorkbenchLocation }) {
  const plan = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot)
  const registeredContainers = useWorkbenchContainers()
  const registeredViews = useWorkbenchViews()
  const plannedContainers = plan.containers
    .filter(container => container.location === location)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
  const requested = selectedContainer(location, plan.layout)
  const activeId = requested && plannedContainers.some(item => item.id === requested)
    ? requested
    : plannedContainers[0]?.id
  if (!activeId || !registeredContainers.some(item => item.id === activeId)) return null
  const plannedViewIds = new Set(plan.views.filter(view => view.container === activeId).map(view => view.id))
  const views = registeredViews.filter(view => view.container === activeId && plannedViewIds.has(view.id))
  return (
    <div data-workbench-location={location} data-workbench-container={activeId} style={{ display: 'contents' }}>
      {views.map(view => <Fragment key={view.id}>{view.render({ active: true })}</Fragment>)}
    </div>
  )
}
