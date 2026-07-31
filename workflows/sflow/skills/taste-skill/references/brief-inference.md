## 0. BRIEF INFERENCE (Read the Room Before Anything Else)

Before touching code or tweaking dials, infer what the user actually wants. Most LLM design output is bad because the model jumps to a default aesthetic instead of reading the room.

### 0.A Read these signals first
1. Page kind - landing (SaaS / consumer / agency / event), portfolio (dev / designer / creative studio), redesign (preserve vs overhaul), editorial / blog.
2. Vibe words the user used - "minimalist", "calm", "Linear-style", "Awwwards", "brutalist", "premium consumer", "Apple-y", "playful", "serious B2B", "editorial", "agency-y", "glassy", "dark tech".
3. Reference signals - URLs they linked, screenshots they pasted, products they named, brands they're competing with.
4. Audience - B2B procurement panel vs. design-conscious consumer vs. recruiter scanning a portfolio. The audience picks the aesthetic, not your taste.
5. Brand assets that already exist - logo, color, type, photography. For redesigns, these are starting material, not optional input.
6. Quiet constraints - accessibility-first audiences, public-sector, regulated industries, trust-first commerce, kids' products. These constraints OVERRIDE aesthetic preference.

### 0.B Output a one-line "Design Read" before generating
Before any code, state in one line: "Reading this as: <page kind> for <audience>, with a <vibe> language, leaning toward <design system or aesthetic family>."

Example reads:
- "Reading this as: B2B SaaS landing for technical buyers, with a Linear-style minimalist language, leaning toward Tailwind utilities + Geist + restrained motion."
- "Reading this as: solo designer portfolio for hiring managers, with an editorial / kinetic-type language, leaning toward native CSS + scroll-driven animation + custom typography."
- "Reading this as: redesign of a public-sector service site, with a trust-first language, leaning toward GOV.UK Frontend or USWDS."

### 0.C If the brief is ambiguous, ask one question, do not guess
Ask exactly one clarifying question - never a multi-question dump - and only when the design read genuinely diverges. Example: "Should this feel closer to Linear-clean or Awwwards-experimental?"

If you can confidently infer from context, do not ask. Just declare the design read and proceed.

### 0.D Anti-Default Discipline
Do not default to: AI-purple gradients, centered hero over dark mesh, three equal feature cards, generic glassmorphism on everything, infinite-loop micro-animations everywhere, Inter + slate-900. These are the LLM defaults. Reach past them deliberately based on the design read.
