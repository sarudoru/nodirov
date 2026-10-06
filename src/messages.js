// Messages: the page sends them itself, through Web3Forms, which forwards
// each one to the inbox its access key belongs to. The key is made to be
// public; it can only deliver to that inbox. Until the key is set, nothing
// is sent and the message box says so.

export const MESSAGES = {
  key: "",
  endpoint: "https://api.web3forms.com/submit",
};

// Resolves once the message is accepted; throws with the reason otherwise.
export async function deliver(text, contact) {
  if (!MESSAGES.key) throw new Error("no Web3Forms access key in MESSAGES.key");
  const response = await fetch(MESSAGES.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      access_key: MESSAGES.key,
      subject: "From nodirov.com",
      from_name: contact || "A visitor to nodirov.com",
      // an address in the text becomes the reply-to
      ...(contact ? { email: contact } : {}),
      message: text,
    }),
    signal: AbortSignal.timeout?.(15000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) {
    throw new Error(result?.body?.message || result?.message || `HTTP ${response.status}`);
  }
}
