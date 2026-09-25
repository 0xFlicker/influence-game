export class GenerationAdmissionError extends Error {
  constructor(public code: string, message: string, public status: 400 | 403 | 404 | 409 | 429 | 503 = 409) { super(message); }
}
export const generationContacts = {
 discord: "https://discord.gg/XfsmWr26xW", email: "mailto:support@falsefloor.ai", x: "https://x.com/0xflick",
};
