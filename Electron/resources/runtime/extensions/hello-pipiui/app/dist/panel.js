// ../../../Electron/resources/runtime/extensions/hello-pipiui/app/panel.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function Panel(props) {
  const api = props.api;
  return /* @__PURE__ */ jsxs("section", { children: [
    /* @__PURE__ */ jsx("h2", { children: "hello-pipiui" }),
    /* @__PURE__ */ jsx("p", { children: "Replace this panel. Call only injected services (settings / invoke / notify)." }),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        onClick: () => {
          void api?.invoke?.("hello", {});
        },
        children: "Ping agent"
      }
    )
  ] });
}
export {
  Panel as default
};
