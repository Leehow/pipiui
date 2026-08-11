declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    on(event: string, handler: (...args: any[]) => unknown): void;
    registerTool(tool: any): void;
    registerCommand?(name: string, command: any): void;
    [key: string]: any;
  }
}

declare module "typebox" {
  export const Type: any;
}
