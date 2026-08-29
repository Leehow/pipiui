import type { ExtensionAPI, InputEvent, InputEventResult } from "@earendil-works/pi-coding-agent";

// Deliberately duplicated from @pipi/host-api: the embedded runtime cannot assume that
// workspace package is resolvable. The interoperability test locks these values together.
const INTENT_PREFIX = "[[PIPIUI_UPDATE_EVALUATION_INTENT]]";

function handleInput(event: InputEvent): InputEventResult {
  if (!event.text.startsWith(INTENT_PREFIX)) return { action: "continue" };
  return {
    action: "transform",
    text: "更新功能已关闭，已拒绝处理。不要执行更新、修改文件、安装依赖或任何发布操作。",
    images: event.images,
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("input", event => handleInput(event));
}
