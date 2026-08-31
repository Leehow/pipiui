import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import codingTools from "../../pipiui-coding-tools.ts";
import gitTools from "../../pipiui-git.ts";
import reload from "../../pipiui-reload.ts";

export default function codingRuntime(pi: ExtensionAPI): void {
  codingTools(pi);
  gitTools(pi);
  reload(pi);
}
