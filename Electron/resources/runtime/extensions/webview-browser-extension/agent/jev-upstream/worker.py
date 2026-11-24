"""One bounded upstream Agent run. All I/O and credentials stay with the host."""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).with_name("vendor")))
from jev_ultrafast import Agent, Browser
from jev_ultrafast import model


def emit(value):
    print(json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)


sequence = 0
active_agent = None


def rpc(operation, value):
    global sequence
    sequence += 1
    emit({"type": "request", "id": sequence, "operation": operation, "value": value})
    raw = sys.stdin.readline()
    if not raw:
        raise RuntimeError("host-disconnected")
    response = json.loads(raw)
    if response.get("id") != sequence:
        raise RuntimeError("invalid-host-response")
    if not response.get("ok"):
        raise RuntimeError(response.get("code", "host-request-failed"))
    return response.get("value")


def summary(agent):
    state = agent.state
    reported_text = [t.get("usage", {}) for t in state["text_calls"]
                     if isinstance(t.get("usage", {}).get("prompt_tokens"), int)
                     and isinstance(t.get("usage", {}).get("completion_tokens"), int)]
    return {
        "status": state["status"], "decisions": len(state["decisions"]),
        "steps": [{"operation": h["operation"], "outcome": "executed", "pageChanged": h["page_changed"]}
                  for h in state["history"]],
        "textModelCalls": len(state["text_calls"]),
        "textModelUsage": {"reportedResponses": len(reported_text),
                           "inputTokens": sum(t["prompt_tokens"] for t in reported_text),
                           "outputTokens": sum(t["completion_tokens"] for t in reported_text)},
        "observationsTruncated": bool(state["page"].get("omitted_actions", 0)),
        "inputTokens": sum(d.get("usage", {}).get("input_tokens", 0) for d in state["decisions"]),
        "elapsedMs": state["elapsed_ms"],
    }


def main():
    global active_agent
    config = json.loads(sys.stdin.readline())
    # Upstream consumes these names; they are routing sentinels, never credentials.
    os.environ["TYPESAFE_API_KEY"] = "host-owned"
    os.environ["TEXT_MODEL_API_KEY"] = "host-owned"
    os.environ["TEXT_MODEL"] = "session-model"
    class HostBrowser(Browser):
        def observe(self, screenshot=False):
            page = super().observe(screenshot)
            page["actions"] = [a for a in page["actions"] if not re.search(
                r"password|passwd|api.?key|secret|token|card.?number|security.?code|one.?time|密码|密钥|验证码|卡号",
                a.get("label", ""), re.I)]
            return page

        def act(self, action, page, text=None):
            if re.search(r"\b(delete|purchase|pay|send|publish|confirm order)\b|删除|付款|支付|购买|发送|发布|确认订单",
                         action.get("label", ""), re.I):
                raise RuntimeError("consequential-action-handoff")
            return super().act(action, page, text)

    browser = HostBrowser(None, transport=lambda method, params: rpc("cdp", {"method": method, "params": params}))
    agent = Agent(None, config["goal"], browser=browser,
                  choose_fn=lambda page, goal, history: model.choose(page, goal, history,
                      request=lambda url, key, body: rpc("jev", body)),
                  text_fn=lambda context: model.field_text(context,
                      request=lambda url, key, body: rpc("text", body)))
    active_agent = agent
    try:
        for _ in range(config["maxSteps"]):
            agent.command("tick")
            emit({"type": "progress", "value": summary(agent)})
            if agent.state["status"] in {"done", "blocked"}:
                break
        emit({"type": "result", "value": summary(agent)})
    finally:
        agent.close()


try:
    main()
except Exception as error:
    # The host supplies stable error codes. Never serialize request/response bodies,
    # text values, exception tracebacks or credentials into the tool transcript.
    message = str(error)
    code = message if message and len(message) < 80 and all(c.islower() or c.isdigit() or c == "-" for c in message) else "upstream-control-failed"
    if active_agent is not None:
        emit({"type": "progress", "value": summary(active_agent)})
    emit({"type": "error", "code": code})
    sys.exit(1)
