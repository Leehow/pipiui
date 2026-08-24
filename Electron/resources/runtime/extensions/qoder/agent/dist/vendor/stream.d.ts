import type { Api, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
export declare function streamQoder(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
