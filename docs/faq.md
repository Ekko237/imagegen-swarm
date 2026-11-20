# Common questions

[English](faq.md) | [简体中文](faq.zh-CN.md)

**Do I need every engine logged in?**

No. One is enough, and each engine you add speeds up generation. Set up only the ones you want. Run `node skills/imagegen-swarm/scripts/check.mjs` to see which engines are ready. Any engine without a login shuts down and returns its job to the queue.

**Is my login safe?**

The skill contains no accounts or keys. Each engine stores its login in its own local folder—do not bundle those folders if you share the skill. Put Lovart's AK/SK in `~/.lovart/env` with mode `600`, never in chat or git. All credential paths are listed in [SETUP.md](../skills/imagegen-swarm/SETUP.md).

**Will styles stay consistent across models?**

Not by default. Each job carries its own `prompt`, an optional `ref` list, and an optional `aspect`, and a free lane that can take the job runs it, so one batch is often split across models.

For the same character, the same brand, or a cover series, use [series mode](series-mode.md).

Jimeng takes up to 10 references, Gemini up to 3, and Grok one. Gemini may rewrite the prompt; its result then has `prompt_verbatim: false`.

**What happens when a quota runs out?**

When an engine reports exhausted quota, no login, or no install, it shuts down and puts its current image back in the queue. A standard rate limit (429) backs off and only shuts the engine down after three consecutive rate-limit failures. Failed images retry on another untried engine, up to `--tries` engines (default 3). If you configured the pay-per-image api line, it takes over from there until its budget is used. If every engine runs out of quota, generate in the ChatGPT, Gemini, or Grok web app in a new tab, download and check the image, then close the tab. An engine error is not an empty quota. If the engine you named fails, the skill reports that error.

**Do I need an API key?**

Not for most engines. Codex and Jimeng use the accounts you already have. Grok, Gemini, and Muse use their own account logins. Only Lovart requires its official AK/SK, stored on your machine. The optional pay-per-image line uses your own OpenAI or Gemini API key; see [SETUP.md](../skills/imagegen-swarm/SETUP.md).

**Which agents does this run in?**

Claude Code and Codex.
