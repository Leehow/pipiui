export function createMenuNavigator(start) {
    const stack = [start];
    const selections = new Map();
    let closed = false;
    let closeReason;
    return {
        get current() {
            const current = stack.at(-1);
            if (current === undefined)
                throw new Error("Menu is closed");
            return current;
        },
        get closed() {
            return closed;
        },
        get closeReason() {
            return closeReason;
        },
        apply(transition) {
            if (closed)
                return "closed";
            switch (transition.kind) {
                case "stay":
                    break;
                case "to":
                    stack.push(transition.screen);
                    break;
                case "back":
                    if (stack.length > 1)
                        stack.pop();
                    else {
                        closed = true;
                        closeReason = "back";
                    }
                    break;
                case "close":
                    closed = true;
                    closeReason = "close";
                    break;
            }
            return closed ? "closed" : "active";
        },
        rememberSelection(screen, itemId) {
            selections.set(screen, itemId);
        },
        selectionFor(screen, availableItemIds) {
            if (availableItemIds.length === 0)
                return undefined;
            const remembered = selections.get(screen);
            if (remembered && availableItemIds.includes(remembered))
                return remembered;
            const fallback = availableItemIds[0];
            if (fallback !== undefined)
                selections.set(screen, fallback);
            return fallback;
        },
    };
}
