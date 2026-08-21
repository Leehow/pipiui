// ../../../Electron/resources/runtime/extensions/hello-pipiui/app/hello-card.tsx
import { jsx } from "react/jsx-runtime";
function HelloCard(props) {
  const text = typeof props.details === "object" && props.details !== null ? JSON.stringify(props.details) : props.content;
  return /* @__PURE__ */ jsx("pre", { children: text });
}
export {
  HelloCard as default
};
