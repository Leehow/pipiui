export type TerminalBrokerRequest =
  | { operation: "read"; path: string; maxBytes: number }
  | { operation: "write"; path: string; content: string }
  | { operation: "status"; path: string }
  | { operation: "execute"; argv: string[] };

export type TerminalBrokerResult =
  | { operation: "read"; artifactId: string; digest: string; byteLength: number; truncated: boolean }
  | { operation: "write"; artifactId: string; digest: string; byteLength: number; written: true }
  | { operation: "status"; artifactId: string; exists: boolean; kind?: "file" | "directory" | "other"; byteLength?: number; digest?: string }
  | { operation: "execute"; artifactId: string; exitCode: number; stdoutDigest?: string; stderrDigest?: string; truncated: boolean };

export type TerminalBrokerTransport = (input: {
  endpoint: string;
  token: string;
  request: TerminalBrokerRequest;
  signal?: AbortSignal;
}) => Promise<TerminalBrokerResult>;
