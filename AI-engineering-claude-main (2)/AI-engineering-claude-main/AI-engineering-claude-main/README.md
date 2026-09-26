# \# Claude AI Engineer — Evaluation \& Observability

# 

# This repository contains the official modules for the \*\*Claude AI Engineer: Evaluation and Observability\*\* course (`cd15552`). The course teaches how to design dependable Claude‑powered extraction and investigation pipelines. You’ll learn to build schemas that separate “explicitly stated” from “not mentioned,” implement retry loops that distinguish recoverable from futile errors, add independent review passes, route tasks through deterministic human‑in‑the‑loop processes, and synthesize information across multiple sources with resilience.

# 

# Each top‑level directory is a project module developed through cumulative, test‑driven exercises. Every exercise includes a `starter/` package (with `# TODO:` markers) and a fully implemented `solution/`. The `starter/` of one exercise is identical to the `solution/` of the previous one, so progress builds continuously until the final working system.

# 

# \---

# 

# \## Project Modules

# 

# \### Build a Resilient Mortgage Document Extraction System

# 

# As the lead AI engineer at Meridian Home Lending, you’ll design a mortgage‑document extractor. The JSON Schema must encode underwriting rules: nullable unions, enums with “other” spillovers, and per‑document required fields. You’ll then orchestrate a two‑step classify‑then‑extract pipeline with forced `tool\_choice`, craft the extractor system prompt, and validate mathematical consistency across extracted values.

# 

# \- `01-design-resilient-extraction-schema/` — Build the resilient JSON Schema and tools (`pytest tests/test\_us01\_schema.py`).

# \- `02-orchestrate-two-pass-tool-choice/` — Implement classify‑then‑extract with forced tool choice (`pytest tests/test\_us02\_pipeline.py`).

# \- `03-write-extractor-system-prompt/` — Write the extractor system prompt (`pytest tests/test\_us03\_prompts.py`).

# \- `04-validate-mathematical-consistency/` — Add cross‑field mathematical consistency checks (`pytest tests/test\_us04\_validator.py`).

# 

# \---

# 

# \### Build a Validated, Routed Insurance Policy Extraction Pipeline

# 

# This project ingests insurance policy renewal documents, validates them, and routes each case either to auto‑approval or human review. You’ll implement a retry loop that separates recoverableHere’s the rewritten \*\*README.md\*\* file content, plagiarism‑free but with all the original details preserved. You can copy this directly into your `README.md` file:

# 

# ```markdown

# \# Claude AI Engineer — Evaluation \& Observability

# 

# This repository contains the official modules for the \*\*Claude AI Engineer: Evaluation and Observability\*\* course (`cd15552`). The course teaches how to build dependable Claude‑powered extraction and investigation pipelines. You’ll design schemas that clearly separate “explicitly stated” from “not mentioned,” implement retry loops that distinguish recoverable from futile errors, add independent review passes, route tasks through deterministic human‑in‑the‑loop processes, and synthesize information across multiple sources with resilience.

# 

# Each top‑level directory is a self‑contained project module, developed step by step through cumulative, test‑driven exercises. Every exercise includes a `starter/` package (with `# TODO:` markers) and a fully implemented `solution/`. The `starter/` of one exercise is identical to the `solution/` of the previous one, so progress builds continuously until you reach the final working system.

# 

# \---

# 

# \## Project Modules

# 

# \### Build a Resilient Mortgage Document Extraction System

# 

# As the lead AI engineer at Meridian Home Lending, you’ll design a mortgage‑document extractor. The JSON Schema must encode underwriting rules: nullable unions, enums with “other” spillovers, and per‑document required fields. You’ll then orchestrate a two‑step classify‑then‑extract pipeline with forced `tool\_choice`, craft the extractor system prompt, and validate mathematical consistency across extracted values.

# 

# \- `01-design-resilient-extraction-schema/` — Build the resilient JSON Schema and tools (`pytest tests/test\_us01\_schema.py`).

# \- `02-orchestrate-two-pass-tool-choice/` — Implement classify‑then‑extract with forced tool choice (`pytest tests/test\_us02\_pipeline.py`).

# \- `03-write-extractor-system-prompt/` — Write the extractor system prompt (`pytest tests/test\_us03\_prompts.py`).

# \- `04-validate-mathematical-consistency/` — Add cross‑field mathematical consistency checks (`pytest tests/test\_us04\_validator.py`).

# 

# \---

# 

# \### Build a Validated, Routed Insurance Policy Extraction Pipeline

# 

# This project ingests insurance policy renewal documents, validates them, and routes each case either to auto‑approval or human review. You’ll implement a retry loop that separates recoverable errors (`format` / `consistency`) from irrecoverable ones (`missing\_source`), add SLA‑driven batch submission, create an independent reviewer with within‑policy integration, and build deterministic HITL routing with stratified sampling and calibration.

# 

# \- `01-retry-with-error-feedback/` — Retry with error feedback and escalation (`pytest tests/test\_us01\_retry.py`).

# \- `02-batch-and-sla/` — SLA‑driven batch submission (`pytest tests/test\_us02\_batch.py`).

# \- `03-independent-review/` — Independent review and integration pass (`pytest tests/test\_us03\_review.py`).

# \- `04-hitl-routing/` — HITL routing with stratified sampling and calibration (`pytest tests/`).

# 

# \---

# 

# \### Investigate Supply Chain Risk with Multi‑Source Synthesis

# 

# Here you’ll build a supply‑chain risk investigator over the Meridian corpus. Each source maps into a `Claim` shape, with four source readers feeding into a shared vector store. You’ll then generate synthesis briefings that remain faithful to what the sources support (and what they don’t). Finally, you’ll make the coordinator resilient to source outages via a timeout path.

# 

# \- `01-claim-readers/` — Define the `Claim` model and source readers (`pytest tests/test\_readers.py`).

# \- `02-memory-briefing/` — Shared vector store and synthesis briefing (`pytest tests/test\_memory.py tests/test\_synthesis.py`).

# \- `03-resilient-coordinator/` — Timeout handling and resilient coordinator (`pytest tests/`).

# 

# \---

# 

# \## Repository Layout

# 

# Each exercise pairs starter code with a solution, both carrying their own `README.md`:

# 

# ```bash

# <project>/

# └── <NN-exercise-name>/        # numbered, cumulative step

# &#x20;   ├── starter/               # Python package with TODO blocks

# &#x20;   │   ├── README.md          # instructions and verify command

# &#x20;   │   ├── pyproject.toml

# &#x20;   │   ├── <package>/         # source code to complete

# &#x20;   │   ├── fixtures/ or data/ # offline corpus + recorded API responses

# &#x20;   │   └── tests/             # acceptance tests

# &#x20;   └── solution/              # identical to next exercise’s starter



