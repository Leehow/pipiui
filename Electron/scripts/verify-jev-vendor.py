"""Offline candidate regression: execute the candidate policy against a deterministic browser."""
import json
import os
import sys

sys.path.insert(0, sys.argv[1])
from jev_ultrafast import Agent
from jev_ultrafast.model import choose, field_text

os.environ["TYPESAFE_API_KEY"] = "test-only"
os.environ["TEXT_MODEL_API_KEY"] = "test-only"


class Browser:
    text = ""
    selected = "Economy"
    closed = False

    def observe(self, screenshot=False):
        actions = [{"id": "text", "node": 1, "kind": "fill", "role": "textbox", "label": "Destination", "value": self.text}]
        if self.selected != "Business":
            actions.append({"id": "select", "node": 2, "kind": "select", "role": "combobox", "label": "Travel class → Business", "value": "business", "current_value": self.selected})
        actions.append({"id": "wait", "kind": "wait", "label": "Wait"})
        return {"actions": actions, "url": "https://fixture.invalid", "title": "Form", "text": f"Destination {self.text}; Travel class {self.selected}", "fingerprint": self.text + self.selected}

    def fresh(self, page, action=None):
        return page["fingerprint"] == self.observe()["fingerprint"]

    def act(self, action, page, text=None):
        assert self.fresh(page)
        if action["kind"] == "fill":
            self.text = text
        elif action["kind"] == "select":
            self.selected = "Business"
        else:
            raise AssertionError("Unexpected repeated/no-progress action")

    def close(self):
        self.closed = True


browser = Browser()


def decision(_url, _key, body):
    elements = body["state"]["elements"]
    field = next(e for e in elements if e["label"] == "Destination")
    operation = "TYPE_TEXT" if field["value"] != "Paris" else "SELECT" if browser.selected != "Business" else "DONE"
    selected = {"operation": operation, "type_text_target": field["index"]}
    if operation == "SELECT":
        dropdown = next(e for e in elements if e["role"] == "combobox")
        selected["select_target"] = dropdown["options"][0]["index"]
    answers = {}
    for name, question in body["questions"].items():
        ids = list(question["criteria"])
        chosen = selected.get(name, ids[0])
        answers[name] = {"type": "choice", "choice": chosen, "confidence": 1, "probabilities": {i: int(i == chosen) for i in ids}}
    return {"model": "test-only", "answers": answers, "usage": {"input_tokens": 10}}


def text_response(_url, _key, _body):
    return {"choices": [{"message": {"content": '{"text":"Paris"}'}}]}


agent = Agent(None, "Fill Destination with Paris and select Business; do not submit", browser=browser,
              choose_fn=lambda page, goal, history: choose(page, goal, history, request=decision),
              text_fn=lambda context: field_text(context, request=text_response))
try:
    for _ in range(5):
        agent.command("tick")
        if agent.state["status"] in {"done", "blocked"}:
            break
    assert agent.state["status"] == "done"
    assert browser.text == "Paris" and browser.selected == "Business"
    assert [h["operation"] for h in agent.state["history"]] == ["TYPE_TEXT", "SELECT"]
    assert len(agent.state["text_calls"]) == 1
finally:
    agent.close()
assert browser.closed
print(json.dumps({"ok": True, "decisions": len(agent.state["decisions"]), "actions": len(agent.state["history"])}))
