/** Office FileViewer layout + Shadow DOM toolbar overrides. Injected by the renderer. */
export const OFFICE_RENDERER_CSS = `.document-office-preview{width:100%;height:100%;min-width:0;min-height:360px}
.document-office-preview>.document-file-viewer{display:block;width:100%;height:100%;min-width:0;min-height:0}
.document-file-viewer::part(shell){width:100%;max-width:100%;min-width:0}
.document-file-viewer::part(toolbar){display:flex;width:100%;max-width:100%;min-width:0;box-sizing:border-box;justify-content:space-between;flex-wrap:wrap;overflow-x:auto;overflow-y:hidden}
.document-file-viewer::part(toolbar-group){min-width:0;max-width:100%;flex:0 1 auto}
.document-file-viewer::part(input){width:auto;min-width:0;max-width:100%;flex:1 1 72px}
`
