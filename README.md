# Yara chat on Cloudflare: setup guide

This replaces the Dify app on your PC. Same prompt, same rules, same five knowledge files, same live prices. It runs on Cloudflare's free plan, answers in a few seconds, and works when your PC is off.

What's in this folder:

| File | What it is |
|---|---|
| `worker.js` | The whole chatbot in one file. This is what you paste into Cloudflare. |
| `knowledge/` | Your five knowledge files (taken from your Dify backup). Add them to your repo's `knowledge/` folder too. |
| `tools/build_worker.py` | Rebuilds `worker.js` after you change a knowledge file. |
| `src/worker.template.js` | The chatbot's code without the knowledge. Only for future changes. |

The chatbot does not save chats anywhere.

## Part 1: Put the chatbot online (about 10 minutes)

1. Go to **dash.cloudflare.com** and sign up for a free account. Confirm your email.
2. In the left menu, open **Workers & Pages** (it may sit under **Compute**). Click **Create**, then **Create Worker** (or **Start with Hello World**).
3. Name it `yara-chat` and click **Deploy**. Cloudflare shows your Worker's address, something like `https://yara-chat.your-name.workers.dev`. Copy it into Notepad.
4. Click **Edit code**. Click inside the code, press **Ctrl + A**, then **Delete**.
5. Open `worker.js` from this folder in Notepad. Press **Ctrl + A**, then **Ctrl + C**. Go back to Cloudflare, click inside the empty editor and press **Ctrl + V**. Click **Deploy**.
6. Go back to the Worker's page and open **Settings → Bindings → Add binding**. Choose **Workers AI**. For the variable name type exactly `AI`. Save, and deploy again if Cloudflare asks.
7. Test it: open your Worker's address in the browser. You should see a line starting with `{"ok":true,"name":"Yara chat"`. Send me a screenshot if you see anything else.

## Part 2: Connect the website

1. Open the new homepage's `index.html` in Notepad.
2. Press **Ctrl + F** and search for `YARA_CHAT_URL`.
3. On that line, put your Worker's address between the two quotes, with no `/` at the end:
   `const YARA_CHAT_URL = window.YARA_CHAT_URL || 'https://yara-chat.your-name.workers.dev';`
4. Save, then **Commit** and **Push origin** in GitHub Desktop.
5. Open your site, tap the sprout in the corner and ask «بكم العدس في بنده؟».

The chat only works from your GitHub site. It won't work inside the claude.ai preview, because claude.ai blocks pages from calling other sites.

## Settings you can change (optional)

In Cloudflare: your Worker → **Settings → Variables and Secrets → Add** (type: Text).

| Name | When to use it |
|---|---|
| `ALLOWED_ORIGINS` | If your site moves to another address. The site address only, no path, e.g. `https://amallusion.github.io`. Several addresses: separate with commas. |
| `MODEL` | To try another Workers AI model. Default: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Pick from Cloudflare's model list; smaller models answer more questions a day but are weaker in Arabic. |
| `PRICES_URL` | Only if the price list moves. Default: `https://amallusion.github.io/yara/data/prices.csv`. |

## The free daily allowance

Cloudflare gives every account 10,000 "neurons" of AI a day for free. It resets at 00:00 UTC, which is 3 am in Saudi. With the default model that is roughly a few dozen answers a day, depending on how long they are. When it runs out, Yara says she's resting until tomorrow instead of breaking.

For more answers, upgrade to the Workers Paid plan (about $5 a month plus a small cost per extra answer), or set `MODEL` to a smaller model. Check Cloudflare's pricing page for the current numbers.

## Updating Yara

- **Prices:** nothing to do. The chatbot reads `data/prices.csv` from your website on each price question (cached for 10 minutes).
- **Knowledge files:** replace the file in `knowledge/`, then in PowerShell inside this folder run `python tools/build_worker.py`. Paste the new `worker.js` into Cloudflare (Part 1, steps 4 and 5) and click **Deploy**.

## When something goes wrong

| What you see | What it means | Fix |
|---|---|---|
| The sprout still says "getting an upgrade" | The website has no Worker address | Part 2, step 3 |
| "This site is not allowed to use Yara." | Your site's address isn't on the allowed list | Add `ALLOWED_ORIGINS` (see Settings) |
| "The Workers AI binding called AI is missing." | Step 6 was skipped or the name isn't exactly `AI` | Part 1, step 6 |
| "Yara is resting for today" | The free daily allowance is used up | Wait until 3 am Saudi time, or upgrade |
| "Yara is a little busy" | One visitor sent more than 25 messages in 10 minutes | Wait a few minutes |
| A price answer is wrong | The product isn't in `prices.csv` or has a different name | Check the CSV; add the product or a clearer name |

## What changed from Dify

- **Search:** Dify used embeddings. This uses keyword search over the same `###` sections, tuned so your four Retrieval Testing questions still find the right section first. It also understands Arabizi food words like *3ads*, *7ommos* and *foul*.
- **Prices:** the CODE node's rules are copied line for line. One improvement: follow-ups like "and at Panda?" reuse the food from the earlier message, so the query-rewrite model (LLM 3) isn't needed anymore.
- **Your PC:** you can stop running Dify. Keep the backup file and the `.yml` safe anyway.
