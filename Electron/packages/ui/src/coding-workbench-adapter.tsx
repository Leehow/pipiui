import { createContext, useContext, type ReactNode } from 'react'
import './builtin-panels'

import { Sidebar, type SidebarProps } from './Sidebar'
import { GitBranchMenu } from './GitBranchMenu'
import { registerHeaderAction } from './workbench/header-actions'
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
registerHeaderAction('coding-workbench', {
  id: 'coding.git.branch',
  render: context => <GitBranchMenu host={context.host} projectId={context.workspaceId} available={context.hostCapabilities.git} />,
})

export function CodingWorkbenchProvider({ sidebar, children }: { sidebar: SidebarProps; children: ReactNode }) {
  return <CodingSidebarContext.Provider value={sidebar}>{children}</CodingSidebarContext.Provider>
}
