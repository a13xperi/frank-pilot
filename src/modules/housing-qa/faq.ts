/**
 * faq.ts — FAQ section index for the grounded housing Q&A agent.
 *
 * Ported from tools/housing-qa/faq.md. The 10 sections keep their stable
 * anchors (e.g. `#fees`, `#documents`) so the agent can cite them and the
 * retriever can keyword-match them. Mirrors retriever.py FAQ_SECTIONS.
 */

export interface FaqSection {
  id: string;
  title: string;
  /** Keyword triggers for retrieval matching. */
  keywords: string[];
}

export interface FaqMatch {
  id: string;
  title: string;
  anchor: string;
}

// Stable section ids -> (title, keyword triggers). Mirrors faq.md anchors.
export const FAQ_SECTIONS: FaqSection[] = [
  {
    id: "who-its-for",
    title: "Who affordable housing is for / AMI tiers",
    keywords: [
      "who", "qualify", "eligib", "ami", "income", "area median", "tier",
      "low income", "afford",
    ],
  },
  {
    id: "application-steps",
    title: "The application steps",
    keywords: [
      "step", "how do i apply", "how to apply", "process", "register", "verify",
      "magic link", "intent", "pick", "review", "confirm", "claim", "stages",
      "apply",
    ],
  },
  {
    id: "documents",
    title: "Documents you'll need",
    keywords: [
      "document", "paperwork", "id", "pay stub", "paystub", "proof of income",
      "ssn", "itin", "reference", "landlord", "bring", "need to apply", "upload",
    ],
  },
  {
    id: "fees",
    title: "Fees",
    keywords: [
      "fee", "cost", "pay", "price", "charge", "35", "$35", "refund",
      "non-refund", "money",
    ],
  },
  {
    id: "waitlists",
    title: "Waitlists & queue position + 120-day rule",
    keywords: [
      "waitlist", "queue", "position", "120", "spot", "wait", "how long",
      "active",
    ],
  },
  {
    id: "finding-a-unit",
    title:
      "Finding a unit (available-now vs statewide; search by BR/budget/move-in)",
    keywords: [
      "find", "available", "search", "unit", "bedroom", "br", "budget",
      "move-in", "move in", "vacancy", "open", "now", "list", "show me",
    ],
  },
  {
    id: "after-you-apply",
    title: "After you apply (PM review, recertification, next steps)",
    keywords: [
      "after", "next", "review", "property manager", "pm", "recertif", "recert",
      "lease", "docusign", "sign", "approved", "decision", "140%",
      "what happens",
    ],
  },
  {
    id: "rent-availability-caveat",
    title: "Rent & availability caveat",
    keywords: [
      "rent", "how much", "monthly", "price", "availability", "still available",
      "current",
    ],
  },
  {
    id: "accessibility",
    title: "Accessibility / senior / ADA",
    keywords: [
      "accessib", "ada", "senior", "elder", "disab", "wheelchair", "elevator",
      "55", "62",
    ],
  },
  {
    id: "contact",
    title: "Contacting a property / getting help",
    keywords: [
      "contact", "phone", "call", "email", "reach", "office hours", "help",
      "talk to", "speak", "manager", "get in touch",
    ],
  },
];

/**
 * Keyword-match FAQ sections against a question. Returns up to `cap` matches
 * (id/title/anchor), highest keyword-hit count first. Mirrors
 * retriever._match_faq_sections.
 */
export function matchFaqSections(question: string, cap = 3): FaqMatch[] {
  const q = question.toLowerCase();
  const scored: Array<{ hits: number; id: string; title: string }> = [];
  for (const s of FAQ_SECTIONS) {
    const hits = s.keywords.reduce(
      (acc, kw) => acc + (q.includes(kw) ? 1 : 0),
      0
    );
    if (hits > 0) {
      scored.push({ hits, id: s.id, title: s.title });
    }
  }
  // Sort by hits desc; preserve original section order for ties (stable sort).
  scored.sort((a, b) => b.hits - a.hits);
  return scored.slice(0, cap).map((s) => ({
    id: s.id,
    title: s.title,
    anchor: `faq.md#${s.id}`,
  }));
}
