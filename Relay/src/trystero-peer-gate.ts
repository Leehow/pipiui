export class OneTimePeerGate {
  #acceptedPeerID: string | null = null;
  #consumed = false;

  reserveBrowser(peerID: string, remote: unknown): void {
    const value = remote as { v?: unknown; role?: unknown } | null;
    // Validate the remote role before consuming the one-time capability.
    if (value?.v !== 1 || value.role !== "browser") {
      throw new Error("rejected non-browser peer");
    }
    // JavaScript runs this check-and-set synchronously after the handshake
    // await, so two completed handshakes cannot both reserve the link.
    if (this.#consumed) throw new Error("one-time link already used");
    this.#acceptedPeerID = peerID;
    this.#consumed = true;
  }

  accepts(peerID: string): boolean {
    return this.#acceptedPeerID === peerID;
  }

  expire(peerID: string): boolean {
    if (this.#acceptedPeerID !== peerID) return false;
    this.#acceptedPeerID = null;
    return true;
  }
}
