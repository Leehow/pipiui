import type { Api, AssistantMessageEventStream, TranscriptContext, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
export declare function streamQoder(model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions): AssistantMessageEventStream;
