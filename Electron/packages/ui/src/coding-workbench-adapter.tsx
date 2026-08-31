import { createContext, useContext, type ReactNode } from 'react'
import './builtin-panels'

import { Sidebar, type SidebarProps } from './Sidebar'
import { registerWorkbenchContainer, registerWorkbenchView } from './workbench/workbench-contributions'

const CodingSidebarContext = createContext<SidebarProps | null>(null)

function CodingSidebarView() {
  const props = useContext(CodingSidebarContext)
  return props ? <Sidebar {...props} /> : null
}

registerWorkbenchContainer('coding-workbench', {
  id: 'coding.sessions',
  location: 'primarySidebar',
  title: '项目与会话',
  order: 10,
})
registerWorkbenchView('coding-workbench', {
  id: 'coding.sessions.tree',
  container: 'coding.sessions',
  render: () => <CodingSidebarView />,
})
export function CodingWorkbenchProvider({ sidebar, children }: { sidebar: SidebarProps; children: ReactNode }) {
  return <CodingSidebarContext.Provider value={sidebar}>{children}</CodingSidebarContext.Provider>
}
