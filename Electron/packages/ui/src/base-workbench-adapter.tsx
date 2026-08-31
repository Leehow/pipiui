import { createContext, useContext, type ReactNode } from 'react'

import { Sidebar, type SidebarProps } from './Sidebar'
import { registerKernelWorkbenchContainer, registerKernelWorkbenchView } from './workbench/workbench-contributions'

const BaseSidebarContext = createContext<SidebarProps | null>(null)

function BaseSidebarView() {
  const props = useContext(BaseSidebarContext)
  return props ? <Sidebar {...props} /> : null
}

registerKernelWorkbenchContainer({
  id: 'pipi.sessions',
  location: 'primarySidebar',
  title: '工作区与会话',
  order: 10,
})
registerKernelWorkbenchView({
  id: 'pipi.sessions.tree',
  container: 'pipi.sessions',
  render: () => <BaseSidebarView />,
})

/** Generic project/workspace and Conversation navigation for the base product. */
export function BaseWorkbenchProvider({ sidebar, children }: { sidebar: SidebarProps; children: ReactNode }) {
  return <BaseSidebarContext.Provider value={sidebar}>{children}</BaseSidebarContext.Provider>
}
