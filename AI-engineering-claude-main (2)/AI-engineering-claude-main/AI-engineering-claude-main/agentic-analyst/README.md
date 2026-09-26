In this project, you are going to make a chatbot to scrape LLM Inference Serving websites to research costs of serving various LLMs. You will do this by writing an MCP Server that hooks up to Firecrawl's API and saving the data in a SQLite Database. You should use the following websites to scrape:

- "cloudrift": "https://www.cloudrift.ai/inference"
- "deepinfra": "https://deepinfra.com/pricing"
- "fireworks": "https://fireworks.ai/pricing#serverless-pricing"
- "groq": "https://groq.com/pricing"

1. Make a venv with uv
2. Sync venv with pyproject.toml (`uv sync`)
3. Make an API Key on Anthropic and Firecrawl
4. Complete the 2 tool calls in `starter_server.py`
5. Change the `server_config.json` to point to your server file
6. Complete any section in `starter_client.py` that has "#complete".
7. Test using any methods taught in the course
8. Use the following prompts in your chatbot but play around with all the LLM providers in the list above: 
    - "How much does cloudrift ai (https://www.cloudrift.ai/inference) charge for deepseek v3?"
    - "How much does deepinfra (https://deepinfra.com/pricing) charge for deepseek v3"
    - "Compare cloudrift ai and deepinfra's costs for deepseek v3"

---

## Implementation Notes (August 2026)

> **Status: complete — submitted and passed** (after one revision round addressing reviewer feedback on the `show data` table format and memory-first orchestration; both fixes are described under "Resubmission changes" below).

Environment: Windows 11, Python 3.12 (uv 0.12.5), Node.js v24.18.1, model `claude-sonnet-4-5-20250929`. The completed project works as specified, but current library and website versions required a few deviations from the literal instructions — each noted below.

### Required workarounds

1. **`mcp-server-sqlite` is incompatible with the current `mcp` 2.x library.** Running the pre-built SQLite server unpinned (`uvx mcp-server-sqlite`) crashes at startup with `AttributeError: 'Server' object has no attribute 'list_resources'`. Fix in `server_config.json`: pin the runtime dependency — `"args": ["--with", "mcp>=1.10.1,<2", "mcp-server-sqlite", "--db-path", "./test.db"]`.

2. **firecrawl-py 4.x removed the `success` field.** The instructions' check `scrape_result.get('success', False)` assumes the v1-style response; in firecrawl-py 4.37.1, `app.scrape(...).model_dump()` returns a Document with no `success` key (failures raise exceptions instead), so the literal check would mark every scrape as failed. `scrape_websites` therefore falls back to treating "content returned for a requested format" as success, while still honoring a `success` key if the SDK provides one.

3. **The prescribed SQL INSERT breaks on apostrophes — including on the project's own test prompt.** The f-string `INSERT` given in the instructions puts values in single-quoted literals, and the required query "Compare cloudrift ai and **deepinfra's** costs…" contains an apostrophe, producing `sqlite error: near "s": syntax error` on every insert. `DataExtractor.extract_and_store_data` keeps the specified statement and column order but escapes `'` → `''` in every interpolated value.

4. **`show data` result rows are not JSON.** The instructions' snippet parses `pricing.content[0]["text"]` with `json.loads`, but (a) MCP `TextContent` objects use attribute access (`.text`), not subscripting, and (b) `mcp-server-sqlite` returns rows as a Python-repr string (single quotes), which `json.loads` rejects. `show_stored_data` reads `.text` (with a dict fallback) and falls back to `ast.literal_eval` when JSON parsing fails.

### Instruction/rubric discrepancies

- The rubric's model example (`claude-3-5-sonnet-20240620`) is outdated; the instructions elsewhere specify `claude-sonnet-4-5-20250929`, which is what the code uses.
- When using a Udacity/Vocareum key, export `ANTHROPIC_BASE_URL=https://claude.vocareum.com` alongside `ANTHROPIC_API_KEY` — the Anthropic SDK picks it up from the environment with no code changes.

### Resubmission changes (reviewer feedback)

- **Memory-first orchestration** — the agent no longer re-scrapes on follow-up questions. A
  system prompt in `ChatSession.process_query` (`SYSTEM_PROMPT` in `starter_client.py`) directs
  it to consult stored data first (`extract_scraped_info`, `read_query` on `pricing_plans`) and
  to call `scrape_websites` only on an explicit scrape/refresh request or when a provider has no
  saved data; the tool descriptions in `starter_server.py` carry matching guidance. Verified: a
  full scrape → follow-up → comparison session contains exactly one `scrape_websites` call.
- **Clean `show data` table** — `DataExtractor.extract_and_store_data` skips plans whose
  `input_tokens` and `output_tokens` are both null (placeholders extracted from non-pricing
  responses such as scrape confirmations), so the table shows only real pricing rows in the
  rubric's format.
- **Windows console encoding** — model answers can contain non-cp1252 characters (e.g. ❌);
  run with `PYTHONUTF8=1` set to avoid `UnicodeEncodeError` in `print()` on Windows.

### Behavioral notes

- **The live websites have drifted from the course-era expectations.** As of August 2026, DeepInfra lists DeepSeek **V4** models (V3 is gone) and CloudRift's inference page no longer shows per-model pricing. The comparison answers in `evidence.md` honestly reflect the data actually scraped — this is correct behavior, not a defect.
- The `DataExtractor` runs after *every* query (per the given design), so non-pricing responses (e.g. the scrape confirmation) can store a placeholder row with `None` token prices. Harmless, and visible as one such row in the `show data` evidence.
- A transient Vocareum HTTP 500 occurred during testing and was absorbed by the `Server.execute_tool` retry loop (visible in Screenshot 2) — the 60-second read timeout and retry requirement doing real work.
