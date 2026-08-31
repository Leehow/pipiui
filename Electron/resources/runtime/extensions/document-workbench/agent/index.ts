import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import officeGate from "../../pipiui-office-doc-shot-gate.ts";
import anydoc from "../../pipiui-firecrawl-anydoc.ts";
import openDocuments from "../../pipiui-open-documents.ts";

export default function documentWorkbench(pi: ExtensionAPI): void {
  officeGate(pi);
  anydoc(pi);
  openDocuments(pi);
}
